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

'''
@app.route('/song-list')
def list_songs():
    return encoding.encode(load('song_list', []))

@app.route('/submit-new-song', methods=['POST'])
def submit_new_song():
    song_list = load('song_list', [])

    payload = encoding.decode(request.data)

    song_list.append(payload)

    save('song_list', song_list)

    return encoding.encode({'success': True})
'''

if __name__ == '__main__':
    # This is used when running locally only. When deploying to Google App
    # Engine, a webserver process such as Gunicorn will serve the app. This
    # can be configured by adding an `entrypoint` to app.yaml.
    app.run(host='127.0.0.1', port=8080, debug=True)
# [END gae_python37_app]
