# Copyright 2018 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# [START gae_python37_app]
from flask import Flask, url_for, request
import os
import json
import encoding
import redis
import random

from pydub import AudioSegment
from io import BytesIO

r = redis.from_url(os.environ.get("REDIS_URL"))

def generate_id():
    return hex(random.getrandbits(128))[2:]

# If `entrypoint` is not defined in app.yaml, App Engine will look for an app
# called `app` in `main.py`.
app = Flask(__name__)

@app.route('/')
def index():
    with open('static/index.html') as f:
        return f.read()

static_files = {
    'jquery.js': 'static/jquery.js',
    'bootstrap.js': 'static/bootstrap/js/bootstrap.min.js',
    'bootstrap.css': 'static/bootstrap/css/bootstrap.min.css',
    'bootstrap.min.css.map': 'static/bootstrap/css/bootstrap.min.css.map',
    'encoding.js': 'static/encoding.js',
    'index.js': 'static/index.js'
}

@app.route('/static-x/<path:path>')
def test1(path):
    with open(static_files[path]) as f:
        return f.read()

@app.route('/song-list')
def list_songs():
    last_song_id = r.get('GLOBAL:last-song-id')
    if last_song_id is None:
        last_song_id = 0
    else:
        last_song_id = int(last_song_id)

    return encoding.encode([
        {
            'id': i,
            'name': r.get('SONG-NAME:%d' % i).decode('utf-8')
        } for i in range(last_song_id)
    ])

@app.route('/submit-new-song', methods=['POST'])
def submit_new_song():
    payload = encoding.decode(request.data)

    last_id = r.get('GLOBAL:last-song-id')

    if last_id is None:
        last_id = 0
    else:
        last_id = int(last_id)

    payload['id'] = last_id

    r.set('SONG-NAME:%d' % last_id, payload['name'])
    r.set('SONG-DATA:%d' % last_id, payload['sound']) # TODO respect start/end times

    r.set('GLOBAL:last-song-id', last_id + 1)

    return encoding.encode({'success': True, 'id': last_id})

@app.route('/song-list')
def song_list():
    last_id = r.get('GLOBAL:last-song-id')

    result = []
    for i in range(last_id):
        result.append({
            'name': r.get('SONG-NAME:%d' % i),
            'id': i
        })

    return encoding.encode(result)

def read_opus(data):
    return AudioSegment.from_file(
            BytesIO(data),
            codec = 'opus'
    )
def as_mp3(audio_segment):
    buf = BytesIO()
    audio_segment.export(buf, format='mp3')
    return buf.getvalue()

@app.route('/create-room/<int:song_id>/<string:room_id>')
def create_room(song_id, room_id):
    room = r.get('ROOM-SONG:%s' % room_id)

    if room is not None:
        return encoding.encode({'success': False, 'reason': 'Already exists.'})

    # Every room has three things:
    # a list of users, a song, and a current tick.

    #r.set('ROOM-USERS:%s' % room_id, []) # Created implicitly
    r.set('ROOM-SONG:%s' % room_id, song_id)
    r.set('ROOM-TICK:%s' % room_id, 0)

    return encoding.encode({'success': True})

@app.route('/get-mixed/<string:room_id>')
def get_mixed(room_id):
    song = r.get('ROOM-SONG:%s' % room_id)

    if song is None:
        return encoding.encode({'success': False, 'reason': 'No such room.'})
    else:
        song = int(song)

    song_data = r.get('SONG-DATA:%d' % song)

    segment = read_opus(song_data)

    return encoding.encode(as_mp3(segment))

@app.route('/join-room/<string:room_id>')
def join_room(room_id):
    user_id = generate_id()

    r.rpush('ROOM-USERS:%s' % room_id, user_id)
    r.set('USER-ROOM:%s' % user_id, room_id)
    
    return encoding.encode({'user_id': user_id})

@app.route('/submit-audio/<string:user_id>/<int:tick>', methods=['POST'])
def submit_audio(user_id, tick):
    payload = encoding.decode(request.data)

    r.set('USER-MOST-RECENT-AUDIO:%s' % user_id, payload['sound'])

    return encoding.encode({'success': True})

if __name__ == '__main__':
    # This is used when running locally only. When deploying to Google App
    # Engine, a webserver process such as Gunicorn will serve the app. This
    # can be configured by adding an `entrypoint` to app.yaml.
    app.run(host='127.0.0.1', port=8080, debug=True)
# [END gae_python37_app]
