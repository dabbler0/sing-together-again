(function(global) {
	const INT = 0;
	const BYTES = 1;
	const STRING = 2;
	const BOOL = 3;
	const ARRAY = 4;
	const DICT = 5;

	class AppendableUint8Array {
		constructor() {
			this.underlying = new Uint8Array(1);
			this.length = 0;
		}

		extend() {
			const new_underlying = new Uint8Array(this.underlying.length * 2);
			new_underlying.subarray(0, this.underlying.length)
				.set(this.underlying);
			this.underlying = new_underlying;
		}

		appendInt(x) {
			if (this.length + 1 >= this.underlying.length) {
				this.extend()
			}
			this.underlying[this.length] = x;
			this.length += 1;
		}

		appendArray(array) {
			while (this.length + array.length >= this.underlying.length) {
				this.extend()
			}
			this.underlying.subarray(this.length, this.length + array.length)
				.set(array);

			this.length += array.length;
		}

		extract() {
			return this.underlying.slice(0, this.length);
		}
	}


	function encodeInt(n, appendable) {
		if (n == 0) {
			appendable.appendInt(0);
		} else {
			appendable.appendInt(n % 256);
			encodeInt(n >> 8, appendable);
		}
	}

	function consumeInt(index, array) {
		let result = 0;
		let factor = 0;
		while (array[index] != 0) {
			result = result + (array[index] << 8 * factor);
			factor += 1;
			index += 1;
		}
		return [index + 1, result];
	}

	function encodeBytes(array, appendable) {
		encodeInt(array.length, appendable);
		appendable.appendArray(array);
	}

	function consumeBytes(index, array) {
		let length;
		[index, length] = consumeInt(index, array);
		return [index + length, array.subarray(index, index + length)];
	}

	const enc = new TextEncoder('utf-8');
	const dec = new TextDecoder('utf-8');

	function encodeString(string, appendable) {
		return encodeBytes(enc.encode(string), appendable);
	}

	function consumeString(index, array) {
		let bytes;
		[index, bytes] = consumeBytes(index, array);
		return [index, dec.decode(bytes)];
	}

	function encodeBool(bool, appendable) {
		if (bool) {
			appendable.appendInt(1);
		} else {
			appendable.appendInt(0);
		}
	}

	function consumeBool(index, array) {
		return [index + 1, array[index] == 1];
	}

	function encodeArray(array, appendable) {
		encodeInt(array.length, appendable);
		for (let i = 0; i < array.length; i++) {
			encodeAny(array[i], appendable);
		}
	}

	function consumeArray(index, array) {
		let length, item;
		const result = [];

		[index, length] = consumeInt(index, array);
		for (let i = 0; i < length; i++) {
			[index, item] = consumeAny(index, array);
			result.push(item);
		}
		return [index, result];
	}

	function encodeDict(dict, appendable) {
		// Get number of keys
		let nKeys = 0;
		for (key in dict) {
			if (dict.hasOwnProperty(key)) {
				nKeys += 1;
			}
		}

		encodeInt(nKeys, appendable);

		for (key in dict) {
			if (dict.hasOwnProperty(key)) {
				encodeString(key, appendable);
				encodeAny(dict[key], appendable);
			}
		}
	}

	function consumeDict(index, array) {
		let nKeys, key, value;
		const result = {};

		[index, nKeys] = consumeInt(index, array);
		for (let i = 0; i < nKeys; i++) {
			[index, key] = consumeString(index, array);
			[index, value] = consumeAny(index, array);

			result[key] = value;
		}

		return [index, result];
	}

	function encodeAny(object, appendable) {
		if (typeof object == 'number') {
			appendable.appendInt(INT);
			encodeInt(object, appendable);
		} else if (typeof object == 'string') {
			appendable.appendInt(STRING);
			encodeString(object, appendable);
		} else if (typeof object == 'boolean') {
			appendable.appendInt(BOOL);
			encodeBool(object, appendable);
		} else if (object instanceof ArrayBuffer) {
			object = new Uint8Array(object);
			appendable.appendInt(BYTES);
			encodeBytes(object, appendable);
		} else if (object instanceof Uint8Array) {
			appendable.appendInt(BYTES);
			encodeBytes(object, appendable);
		} else if (object instanceof Array) {
			appendable.appendInt(ARRAY);
			encodeArray(object, appendable);
		} else if (object instanceof Object) {
			appendable.appendInt(DICT);
			encodeDict(object, appendable);
		}
	}

	function consumeAny(index, array) {
		if (array[index] == INT) {
			return consumeInt(index + 1, array);
		} else if (array[index] == BYTES) {
			return consumeBytes(index + 1, array);
		} else if (array[index] == STRING) {
			return consumeString(index + 1, array);
		} else if (array[index] == BOOL) {
			return consumeBool(index + 1, array);
		} else if (array[index] == ARRAY) {
			return consumeArray(index + 1, array);
		} else if (array[index] == DICT) {
			return consumeDict(index + 1, array);
		} else {
			throw new Error('invalid type ' + array[index]);
		}
	}

	function encode(dict) {
		appendable = new AppendableUint8Array();
		encodeAny(dict, appendable);
		return appendable.extract();
	}

	function decode(array) {
		let index = 0, result;

		[index, result] = consumeAny(index, array);

		return result;
	}

	global.encoder = {
		encode: encode,
		decode: decode
	};

}(window));
