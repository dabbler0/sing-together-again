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
from flask import Flask, url_for, request, Response
import os
import json
import encoding
import redis
import random
import time

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
    'style.css': 'static/style.css',
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
    
    segment = read_arbitrary(payload['sound'], format=payload['format'])
    sound = as_mp3(segment)

    r.set('SONG-NAME:%d' % last_id, payload['name'])
    r.set('SONG-DATA-0:%d' % last_id, as_mp3(segment[:len(segment) // 2]))
    r.set('SONG-DATA-1:%d' % last_id, as_mp3(segment[len(segment) // 2:]))

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

def read_arbitrary(data, format):
    return AudioSegment.from_file(
            BytesIO(data),
            format = format
    )

def read_opus(data):
    return AudioSegment.from_file(
            BytesIO(data),
            codec = 'opus'
    )

def read_mp3(data):
    return AudioSegment.from_file(
            BytesIO(data),
            format = 'mp3'
    )

def as_mp3(audio_segment):
    buf = BytesIO()
    audio_segment.export(buf, format='mp3')
    return buf.getvalue()

@app.route('/create-room', methods=['POST'])
def create_room():
    bulletin = encoding.decode(request.data)

    room_id = generate_id();

    # Every room has three things:
    # a list of users, a song, and a current tick.

    #r.set('ROOM-USERS:%s' % room_id, []) # Created implicitly
    r.set('ROOM-BULLETIN:%s' % room_id, encoding.encode(bulletin))
    r.set('ROOM-INDEX:%s' % room_id, -1)

    return encoding.encode({'room_id': room_id})

@app.route('/get-mixed/<string:room_id>/<string:user_id>/<int:tick>')
def get_mixed(room_id, user_id, tick):
    song = r.get('ROOM-SONG:%s' % room_id)

    index = r.get('ROOM-INDEX:%s' % room_id)

    r.set('USER-LAST-ACTIVE:%s' % user_id, int(time.time()))

    if index is None:
        return encoding.encode({'sucess': False, 'reason': 'NO_SUCH_ROOM'})

    users = [user.decode('utf-8') for user in r.lrange('ROOM-USERS:%s' % room_id, 0, -1)]

    user_names = [r.get('USER-NAME:%s' % user).decode('utf-8') for user in users]
    current_time = time.time()

    if song is None:
        #TODO handle disconnection
        for user in users:
            last_time = int(r.get('USER-LAST-ACTIVE:%s' % user_id))

            # As user that has been gone for 10 seconds
            # has probably disconnected.
            if current_time - last_time > 10:
                r.lrem('ROOM-USERS:%s' % room_id, 0, user)
                r.delete('USER-AUDIO-0:%s' % user)
                r.delete('USER-AUDIO-1:%s' % user)

        return encoding.encode({'success': False,
            'users': user_names,
            'index': index.decode('utf-8'),
            'reason': 'NO_SONG_PLAYING'})

    song = int(song)

    song_data = r.get('SONG-DATA-%d:%d' % (tick % 2, song))

    segment = read_mp3(song_data)

    # Dynamically overlay.
    for user in users:
        user_audio = r.get('USER-AUDIO-%d:%s' % (tick % 2, user))

        if user_audio is not None:

            last_time = int(r.get('USER-LAST-ACTIVE:%s' % user))

            # A user who has been absent for an entire repetition
            # is considered disconnected.
            if current_time - last_time > len(segment) // 500:
                r.lrem('ROOM-USERS:%s' % room_id, 0, user)
                r.delete('USER-AUDIO-0:%s' % user)
                r.delete('USER-AUDIO-1:%s' % user)

            user_audio = encoding.decode(user_audio)

            sound = user_audio['sound']
            offset = user_audio['offset']

            try:
                user_segment = read_mp3(sound)
            except Exception:
                r.delete('USER-AUDIO-%d:%s' % (tick % 2, user))
                continue

            segment = segment.overlay(user_segment, offset)

    return encoding.encode({
        'success': True,
        'index': index.decode('utf-8'),
        'users': user_names,
        'sound': as_mp3(segment)
    })

@app.route('/get-bulletin/<string:room_id>')
def get_bulletin(room_id):
    bulletin = encoding.decode(r.get('ROOM-BULLETIN:%s' % room_id))
    index = r.get('ROOM-INDEX:%s' % room_id)

    if bulletin is None:
        return encoding.encode({'success': False})
    
    return encoding.encode({
        'index': index,
        'bulletin': bulletin
    })

@app.route('/stop-song/<string:room_id>')
def stop_song(room_id):
    users = r.lrange('ROOM-USERS:%s' % room_id, 0, -1)

    if users is None:
        return encoding.encode({'success': False})

    # Stop playing this song
    r.delete('ROOM-SONG:%s' % room_id)

    # Delete everyone's audio
    for user in users:
        r.delete('USER-AUDIO-0:%s' % user.decode('utf-8'))
        r.delete('USER-AUDIO-1:%s' % user.decode('utf-8'))

    return encoding.encode({'success': True})

@app.route('/set-song/<string:room_id>/<int:song_id>')
def set_song(room_id, song_id):
    r.set('ROOM-SONG:%s' % room_id, song_id)
    
    return encoding.encode({'success': True})

@app.route('/set-index/<string:room_id>/<int:index>')
def set_index(room_id, index):
    r.set('ROOM-INDEX:%s' % room_id, index)
    
    return encoding.encode({'success': True})

@app.route('/join-room/<string:room_id>')
def join_room(room_id):
    user_id = generate_id()

    # TODO grab user name as well

    r.rpush('ROOM-USERS:%s' % room_id, user_id)
    r.set('USER-ROOM:%s' % user_id, room_id)
    r.set('USER-NAME:%s' % user_id, request.args.get('name'))
    r.set('USER-LAST-ACTIVE:%s' % user_id, int(time.time()))
    
    return encoding.encode({'user_id': user_id})

@app.route('/download-audio/<int:song_id>')
def download_audio(song_id):
    segment_0 = read_mp3(r.get('SONG-DATA-0:%d' % song_id))
    segment_1 = read_mp3(r.get('SONG-DATA-1:%d' % song_id))

    return Response(as_mp3(segment_0 + segment_1), mimetype='audio/mpeg')

@app.route('/submit-audio/<string:user_id>/<int:index>/<int:tick>', methods=['POST'])
def submit_audio(user_id, index, tick):
    payload = encoding.decode(request.data)

    segment = read_opus(payload['sound'])
    offset = payload['offset']
    offset_sign = payload['offset-sign']

    room_id = r.get('USER-ROOM:%s' % user_id).decode('utf-8')
    room_index = int(r.get('ROOM-INDEX:%s' % room_id))

    room_song = r.get('ROOM-SONG:%s' % room_id)

    if room_index != index or room_song is None:
        return encoding.encode({
            'success': False,
            'reason': 'Desynced with the bulletin'
        })

    if not offset_sign:
        segment = segment[offset:]
        offset = 0

    r.set('USER-AUDIO-%d:%s' % (tick % 2, user_id), encoding.encode(
        {
            'offset': offset,
            'sound': as_mp3(segment)
        })
    )
    r.set('USER-LAST-ACTIVE:%s' % user_id, int(time.time()))

    return encoding.encode({'success': True})

if __name__ == '__main__':
    # This is used when running locally only. When deploying to Google App
    # Engine, a webserver process such as Gunicorn will serve the app. This
    # can be configured by adding an `entrypoint` to app.yaml.
    app.run(host='127.0.0.1', port=8080, debug=True)
# [END gae_python37_app]
