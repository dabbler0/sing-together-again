INT = 0
BYTES = 1
STRING = 2
BOOL = 3
ARRAY = 4
DICT = 5

B_INT = b'\x00'
B_BYTES = b'\x01'
B_STRING = b'\x02'
B_BOOL = b'\x03'
B_ARRAY = b'\x04'
B_DICT = b'\x05'

def encode_int(n):
    if n == 0:
        return b'\x00'
    else:
        return bytes([n % 256]) + encode_int(n // 256)

def consume_int(index, bstring):
    result = 0
    factor = 1
    while bstring[index] != 0:
        result += bstring[index] * factor
        factor *= 256
        index += 1
    return index + 1, result

def encode_bytes(string):
    return encode_int(len(string)) + string

def consume_bytes(index, bstring):
    index, length = consume_int(index, bstring)
    result = bstring[index : index + length]

    return index + length, result

def encode_string(string):
    return encode_int(len(string)) + string.encode()

def consume_string(index, bstring):
    index, bstr = consume_bytes(index, bstring)
    return index, bstr.decode()

def encode_bool(b):
    return b'\x01' if b else b'\x00'

def consume_bool(index, bstring):
    return index + 1, (bstring[index] == 1)

def encode_array(array):
    return encode_int(len(array)) + b''.join(encode_any(obj) for obj in array)

def consume_array(index, bstring):
    index, length = consume_int(index, bstring)
    arr = []

    for i in range(length):
        index, item = consume_any(index, bstring)
        arr.append(item)

    return index, arr

def encode_dict(d):
    result = b''
    result += encode_int(len(d))
    for key in d:
        result += encode_string(key)
        result += encode_any(d[key])
    return result

def consume_dict(index, bstring):
    index, length = consume_int(index, bstring)

    result = {}
    for i in range(length):
        index, key = consume_string(index, bstring)
        index, value = consume_any(index, bstring)
        result[key] = value

    return index, result

def encode_any(data):
    if type(data) == int:
        return B_INT + encode_int(data)
    elif type(data) == bytes:
        return B_BYTES + encode_bytes(data)
    elif type(data) == bool:
        return B_BOOL + encode_bool(data)
    elif type(data) == str:
        return B_STRING + encode_string(data)
    elif type(data) == list:
        return B_ARRAY + encode_array(data)
    elif type(data) == dict:
        return B_DICT + encode_dict(data)

def consume_any(index, bstring):
    if bstring[index] == INT:
        return consume_int(index + 1, bstring)
    elif bstring[index] == BYTES:
        return consume_bytes(index + 1, bstring)
    elif bstring[index] == STRING:
        return consume_string(index + 1, bstring)
    elif bstring[index] == BOOL:
        return consume_bool(index + 1, bstring)
    elif bstring[index] == ARRAY:
        return consume_array(index + 1, bstring)
    elif bstring[index] == DICT:
        return consume_dict(index + 1, bstring)

def encode(obj):
    return encode_any(obj)

def decode(bstring):
    _, result = consume_any(0, bstring)
    return result
