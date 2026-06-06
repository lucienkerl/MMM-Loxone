"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseHeader, TYPES } = require("../lib/loxone/protocol/MessageHeader");

function header(type, infoByte, len) {
	const b = Buffer.alloc(8);
	b[0] = 0x03;
	b[1] = type;
	b[2] = infoByte;
	b.writeUInt32LE(len, 4);
	return b;
}

test("parseHeader reads type, estimated flag, and LE length", () => {
	const h = parseHeader(header(TYPES.VALUE, 0x00, 240));
	assert.deepEqual(h, { type: 2, estimated: false, length: 240 });
});

test("parseHeader detects the estimated bit", () => {
	assert.equal(parseHeader(header(TYPES.TEXTSTATE, 0x01, 10)).estimated, true);
});

test("parseHeader returns null when first byte is not 0x03", () => {
	const b = header(TYPES.VALUE, 0, 24);
	b[0] = 0x00;
	assert.equal(parseHeader(b), null);
});

test("TYPES enumerates the eight message types", () => {
	assert.deepEqual(TYPES, { TEXT: 0, BINFILE: 1, VALUE: 2, TEXTSTATE: 3, DAYTIMER: 4, OOS: 5, KEEPALIVE: 6, WEATHER: 7 });
});
