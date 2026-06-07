"use strict";
const TYPES = { TEXT: 0, BINFILE: 1, VALUE: 2, TEXTSTATE: 3, DAYTIMER: 4, OOS: 5, KEEPALIVE: 6, WEATHER: 7 };
const HEADER_BYTES = 8;

function parseHeader(buf) {
	if (!buf || buf.length < HEADER_BYTES || buf[0] !== 0x03) {
		return null;
	}
	return {
		type: buf[1],
		estimated: (buf[2] & 0x01) === 1,
		length: buf.readUInt32LE(4)
	};
}

module.exports = { parseHeader, TYPES, HEADER_BYTES };
