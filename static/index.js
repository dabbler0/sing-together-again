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
		makeAudioBuffer(response.buffer, (buffer) => {
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
						console.log('room created successfully')
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

/*
 * --- PRIMARY UI ---
 */
$('#create-room').click(() => {
	showSecondary();
});

/*
 * --- SECONDARY UI ---
 */
$('#new-song').click(() => {
	showRecording();
});

/*
 * --- RECORDING UI ---
 */

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

	if (callback)
		q.addEventListener('load', callback);

	q.send(new Blob([encoder.encode(data).buffer]));
}

/*
 * HAS-RECORDED UI
 */
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
$('#record-retry').click(() => {
	showRecording();
});
