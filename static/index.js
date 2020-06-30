/*
 * ----- Recording stuff -----
 */

// Get permissions and access to the micrphone.
let mediaStream;

navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(handleSuccess);

function handleSuccess(stream) {
	mediaStream = stream;
}

const context = new AudioContext();

// Record media

function recordMedia(callback) {
	// Clone the stream, in case this is helpful?
	const ourStream = mediaStream.clone();

	const options = {mimeType: 'audio/webm'};
	const mediaRecorder = new MediaRecorder(ourStream, options);

	const data = [];

	mediaRecorder.addEventListener('dataavailable', (e) => {
		if (e.data.size > 0) {
			data.push(e.data);
		}
	});

	mediaRecorder.addEventListener('stop', (e) => {
		callback(data);
	});

	mediaRecorder.start();

	return {
		stop: (() => mediaRecorder.stop())
	};
}

// Encoded data to buffer
function makeAudioBuffer(response, callback) {
	context.decodeAudioData(response, (buffer) => {
		callback(buffer);
	});
}

// Play buffer
function playAudioBuffer(buffer, time) {
	const bufferSource = context.createBufferSource();
	bufferSource.buffer = buffer;
	bufferSource.connect(context.destination);

	if (time < context.currentTime) {
		bufferSource.start(0, context.currentTime - time);
	} else {
		bufferSource.start(time);
	}
}

function recordAtTime(start_time, end_time, user_id, tick) {
	console.log('I got a request to record at time', start_time);
	function kickoffTimeCheck() {
		if (start_time - context.currentTime < 0.5) {
			beginActualRecording(start_time - context.currentTime);
		} else {
			setTimeout(kickoffTimeCheck, 100);
		} 
	}

	function beginActualRecording(offset) {
		console.log('beginning actual recording at time', context.currentTime, 'for time', start_time, 'with offset', offset);
		const stop = recordMedia((data) => {
			new Response(data[0]).arrayBuffer().then((buffer) => {
				post(
					'/submit-audio/' + user_id + '/' + tick,
					{'sound': buffer, 'offset':
						Math.abs(Math.round(
						offset * 1000)
						),
					'offset-sign': (offset < 0)}
					// no callback I guess
				);
			});
		}).stop;

		setTimeout(
			stop,
			(end_time - context.currentTime) * 1000 + 50 // 50 ms buffer
		);
	}

	kickoffTimeCheck();
}

function scheduleNext(tick, nextTime, room_id_string, user_id) {
	// trivial
	get('/get-mixed/' + room_id_string + '/' + tick, {}, (response) => {
		populateUsers(response.users);

		selectSong(Number(response.index));

		if (response.success === false) {
			setTimeout((() => {
				scheduleNext(0, context.currentTime, room_id_string, user_id);
			}), 1000);
			return;
		}

		makeAudioBuffer(response.sound.buffer, (buffer) => {
			playAudioBuffer(buffer, nextTime);
			recordAtTime(nextTime, nextTime + buffer.duration, user_id, tick)

			setTimeout((() => {
				scheduleNext(
					tick + 1,
					nextTime + buffer.duration,
					room_id_string,
					user_id);
			}),
			(nextTime + buffer.duration
			 - context.currentTime) * 1000 - 2000);
		});
	});
}

function beginPlaying(user_id, room_id_string) {
	scheduleNext(0, context.currentTime, room_id_string, user_id);
}

/*
 * ----- UI stuff -----
 **/

const views = {
	'welcome': $('#welcome'),
	'joining': $('#joining'),
	'creating': $('#creating'),
	'singing': $('#singing'),
	'recording': $('#recording'),
	'submitting': $('#submitting')
}

function showView(view) {
	for (key in views) {
		views[key].hide();
	}
	views[view].show();
}

let CURRENT_USER_ID = null;
let CURRENT_ROOM_ID = null;

/*
 * VIEW 1: WELCOME
 *
 * Welcome contains two buttons: #join and #create.
 */
$('#join').click(() => {
	showView('joining');
});

$('#create').click(() => {
	refetchSongs(rerenderBulletin);
	showView('creating');
});

/*
 * VIEW 2: JOINING
 *
 * Joining contains an input for the service code (#room),
 * an input for one's own name (#name), and a join button (#join-service).
 */

$('#join-service').click(() => {
	CURRENT_ROOM_ID = $('#room').val();

	get('/join-room/' + $('#room').val(), {'name': $('#name').val()}, (response) => {
		CURRENT_USER_ID = response.user_id;

		populateSinging(() => {
			beginPlaying(CURRENT_USER_ID, CURRENT_ROOM_ID);
			showView('singing');
		});
	});
});

$('#cancel-join').click(() => {
	showView('welcome');
});

/*
 * VIEW 3: CREATING
 *
 * Creating contains a panel of songs (#songs),
 * a button to record or upload a new song (#new-song),
 * a list of the order of service (#creating-bulletin),
 * an input for the name the leader will have (#leader-name),
 * and a button to create the service (#create-service).
 */

let CURRENT_BULLETIN = [];
let KNOWN_SONGS = [];

function refetchSongs(callback) {
	get('/song-list', {}, (data) => {
		KNOWN_SONGS = data;
		callback && callback();
	});
}

function rerenderBulletin() {
	$('#existing-bulletin').html('');
	CURRENT_BULLETIN.forEach((item, i) => {
		const new_element = document.createElement('div');
		new_element.className = 'list-group-item';

		const name_input = document.createElement('input');
		name_input.placeholder = 'Name of section';
		name_input.className = 'form-control';

		name_input.value = item.name;

		name_input.addEventListener('change', () => {
			item.name = name_input.value;
		});

		const description_input = document.createElement('textarea');
		description_input.placeholder = 'Other text for this section';
		description_input.className = 'form-control';

		description_input.addEventListener('change', () => {
			item.description = description_input.value;
		});

		description_input.value = item.description;

		const song_selection = document.createElement('select');
		song_selection.className = 'form-control';

		song_selection.addEventListener('change', () => {
			const value = Number(song_selection.value);
			item.song = value;
			if (value >= 0) {
				name_input.value = KNOWN_SONGS[value].name;
				item.name = KNOWN_SONGS[value].name;
			}
		});

		const null_option = document.createElement('option');
		null_option.value = '-1';
		null_option.innerText = 'No song';
		song_selection.appendChild(null_option);

		KNOWN_SONGS.forEach((song) => {
			const option = document.createElement('option');
			option.innerText = song.name;
			option.value = song.id;
			song_selection.appendChild(option);
		});

		song_selection.value = item.song;

		function createDiv(className, contents) {
			const div = document.createElement('div');
			div.className = className;
			contents.forEach((x) => div.appendChild(x));

			return div;
		}

		const top_row = createDiv(
			'form-group row',
			[
				createDiv('col-sm-3', [song_selection]),
				createDiv('col-sm-9', [name_input])
			]
		);

		const header_div = document.createElement('div');
		header_div.innerText = 'Section ' + (i + 1);

		new_element.appendChild(header_div);
		new_element.appendChild(top_row);
		new_element.appendChild(description_input);

		$('#existing-bulletin').append(new_element);
	});
}

$('#new-section').click(() => {
	CURRENT_BULLETIN.push({name: '', description: '', song: -1});
	rerenderBulletin();
});

$('#new-song').click(() => {
	showView('recording');
});

$('#create-service').click(() => {
	post('/create-room', CURRENT_BULLETIN.map((x) => (x.song == -1 ? {name: x.name, description: x.description} : x)), (response) => {
		$('#room').val(response.room_id);

		showView('joining');
	});
});

$('#cancel-create').click(() => {
	showView('welcome');
});

// TODO lots of fancy stuff.

/*
 * VIEW 3: SINGING
 * TODO
 */

/*
 * VIEW 4: RECORDING
 * Recording has a start recording (#record-start-stop),
 * an upload button (#upload), and a cancel (#cancel-recording) button.
 */

let CURRENTLY_RECORDING = false;
let MOST_RECENT_STOP_FUNCTION = null;
let MOST_RECENT_RECORDED_DATA = [];

$('#record-start-stop').click(() => {
	if (CURRENTLY_RECORDING) {
		// Stop the most recent recording.
		MOST_RECENT_STOP_FUNCTION();

		$('#record-start-stop').text('Record');

		CURRENTLY_RECORDING = false;
	} else {
		MOST_RECENT_STOP_FUNCTION = recordMedia((data) => {
			MOST_RECENT_RECORDED_DATA = data;
			FILE_FORMAT = 'webm';

			showView('submitting');
			populateSubmittedAudio();

		}).stop;

		$('#record-start-stop').text('Stop recording');

		CURRENTLY_RECORDING = true;
	}
});

let FILE_FORMAT = 'webm';

$('#upload').click(() => {
	const el = document.getElementById('file-upload');
	MOST_RECENT_RECORDED_DATA = el.files;

	FILE_FORMAT = el.value.substr(el.value.lastIndexOf('.') + 1)

	showView('submitting');
	populateSubmittedAudio();
});

/*
 * VIEW 5: SUBMITTING
 *
 * Submitting has a text input for the name of the song (#song-name)
 * and a "submit" button (#submit).
 */

$('#submit').click(() => {
	new Response(MOST_RECENT_RECORDED_DATA[0]).arrayBuffer().then((buffer) => {
		post('/submit-new-song', {
			'name': $('#song-name').val(),
			'format': FILE_FORMAT,
			'sound': buffer
		}, () => {
			refetchSongs(rerenderBulletin);
			document.getElementById('playback').pause();
			showView('creating');
		});
	});
});

$('#retry').click(() => {
	document.getElementById('playback').pause();
	showView('recording');
});

function populateSubmittedAudio() {
	const data = MOST_RECENT_RECORDED_DATA[0];

	const url = URL.createObjectURL(data);

	$('#playback').attr('src', url);
}

/*
 * VIEW 5: SINGING
 *
 */

function populateUsers(users) {
	$('#people-present').html('');
	users.forEach((user) => {
		const new_element = document.createElement('div');
		new_element.innerText = user;
		new_element.className = 'list-group-item';

		$('#people-present').append(new_element);
	});
}

let WRAPPER_DIVS = [];

function selectSong(index) {
	WRAPPER_DIVS.forEach((x) => $(x).removeClass('bulletin-current'));
	if (index >= 0)
		$(WRAPPER_DIVS[index]).addClass('bulletin-current');
}

function populateSinging(callback) {
	$('#room-id-display').text(CURRENT_ROOM_ID);

	$('#singing-bulletin').html('');

	WRAPPER_DIVS = [];

	get('/get-bulletin/' + CURRENT_ROOM_ID, {}, (response, i) => {

		if (Number(response.index) == -1) {
			$('#advance').text('');
		}

		response.bulletin.forEach((item, i) => {
			const new_div = document.createElement('div');
			const new_header = document.createElement('div');
			const new_desc = document.createElement('div');
			const jump_button = document.createElement('button');

			WRAPPER_DIVS.push(new_div);

			new_div.className = 'bulletin-element';

			if (i == Number(response.index)) {
				new_div.className += ' bulletin-current';
			}

			new_header.className = 'bulletin-header';
			new_desc.className = 'bulletin-desc';

			const jump_button_wrapper = document.createElement('div');
			jump_button_wrapper.appendChild(jump_button);

			jump_button.className = 'btn btn-secondary';
			jump_button.innerText = 'jump to this song';

			new_div.appendChild(new_header);
			new_div.appendChild(new_desc);

			new_div.appendChild(jump_button);
			jump_button.addEventListener('click', () => {
				get('/stop-song/' + CURRENT_ROOM_ID, {}, () => {
					if (item.hasOwnProperty('song')) {
						get('/set-song/' + CURRENT_ROOM_ID + '/' + item.song, {});
					}
					get('/set-index/' + CURRENT_ROOM_ID + '/' + i, {});
				});
			});

			new_header.innerText = (i + 1) + '. ' + item.name;
			new_desc.innerText = item.description;

			$('#singing-bulletin').append(new_div);
		});

		callback && callback();
	});
}

/*
const views = [$('#initial'), $('#secondary'), $('#recording'), $('#has-recorded'), $('#joined')];

function showPrimary() {
	views.forEach((x) => x.hide());
	$('#initial').show();
}

function showSecondary() {
	views.forEach((x) => x.hide());
	$('#secondary').show();

	$('#song-list').html('');

	get('/song-list', {}, (data) => {
		for (let i = 0; i < data.length; i++) {
			let new_button = document.createElement('button');
			new_button.innerText = data[i].name;
			new_button.className = 'song list-group-item list-group-item-action';

			(function() {
				const room_id_string = $('#room-id').val();
				$(new_button).click(() => {
					get('/create-room/' + data[i].id + '/' + room_id_string,
						{}, (response) => {
						get('/join-room/' + room_id_string, {}, (response) => {
							showJoined();
							beginPlaying(response.user_id, room_id_string);
						});
					});
				});
			}());

			$('#song-list').append(new_button);
		}
	});
}

$('#join').click(() => {
	const room_id_string = $('#room-id').val();
	get('/join-room/' + room_id_string, {}, (response) => {
		showJoined();
		beginPlaying(response.user_id, room_id_string);
	});
});

function showJoined() {
	views.forEach((x) => x.hide());
	$('#joined').show();
}

function showRecording() {
	views.forEach((x) => x.hide());
	$('#recording').show();
}

function showHasRecorded() {
	views.forEach((x) => x.hide());
	$('#has-recorded').show();
}
*/

/*
 * --- PRIMARY UI ---
 */
/*
$('#create-room').click(() => {
	showSecondary();
});
*/

/*
 * --- SECONDARY UI ---
 */
/*
$('#new-song').click(() => {
	showRecording();
});
*/

/*
 * --- RECORDING UI ---
 */

/*
let currentlyRecording = false;
let mostRecentStopFunction = null;
let mostRecentData = [];

$('#record-start-stop').click(() => {
	console.log('hello');
	if (currentlyRecording) {
		// Stop the most recent recording.
		mostRecentStopFunction();

		$('#record-start-stop').text('Start recording');
		currentlyRecording = false;
	} else {
		mostRecentStopFunction = recordMedia((data) => {
			mostRecentData = data;

			// For now, assume that there is only one. TODO.
			data = data[0];

			const url = URL.createObjectURL(data);

			$('#playback').attr('src', url);

			showHasRecorded();
		}).stop;
		$('#record-start-stop').text('Stop recording');
		currentlyRecording = true;
	}
});
*/

function get(url, params, callback) {
	const request = new XMLHttpRequest();

	const components = []

	for (key in params) {
		components.push(key + '=' + encodeURIComponent(params[key]));
	}

	const queryString = '?' + components.join('&');
	request.open('GET', url + queryString, true);
	request.responseType = 'arraybuffer';

	if (callback)
		request.addEventListener('load', () => {
			callback(encoder.decode(new Uint8Array(request.response)));
		});

	request.send();
}

function post(url, data, callback) {
	const q = new XMLHttpRequest();
	q.open('POST', url, true);
	q.responseType = 'arraybuffer';

	if (callback)
		q.addEventListener('load', () => {
			callback(encoder.decode(new Uint8Array(q.response)));
		});

	q.send(new Blob([encoder.encode(data).buffer]));
}

/*
 * HAS-RECORDED UI
 */
/*
$('#record-submit').click(() => {
	new Response(mostRecentData[0]).arrayBuffer().then((buffer) => {
		console.log('hello');
		post('/submit-new-song', {
			'name': $('#new-name').val(),
			'start': Number($('#new-start').val()),
			'end': Number($('#new-end').val()),
			'sound': buffer
		}, () => {
			showPrimary();
		});
	});
});
*/
/*
$('#record-retry').click(() => {
	showRecording();
});*/
