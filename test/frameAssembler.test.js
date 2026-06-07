"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FrameAssembler } = require("../lib/loxone/protocol/FrameAssembler");
const { TYPES } = require("../lib/loxone/protocol/MessageHeader");

function header(type, infoByte, len) {
	const b = Buffer.alloc(8);
	b[0] = 0x03; b[1] = type; b[2] = infoByte; b.writeUInt32LE(len, 4);
	return b;
}

test("pairs a value header with its payload", () => {
	const msgs = [];
	const fa = new FrameAssembler({ onText: () => {}, onMessage: (t, p) => msgs.push([t, p]) });
	fa.push(header(TYPES.VALUE, 0, 24), true);
	const payload = Buffer.alloc(24, 5);
	fa.push(payload, true);
	assert.equal(msgs.length, 1);
	assert.equal(msgs[0][0], TYPES.VALUE);
	assert.equal(msgs[0][1].length, 24);
});

test("emits zero-length messages (keepalive) immediately", () => {
	const msgs = [];
	const fa = new FrameAssembler({ onText: () => {}, onMessage: (t, p) => msgs.push([t, p]) });
	fa.push(header(TYPES.KEEPALIVE, 0, 0), true);
	assert.deepEqual(msgs.map((m) => m[0]), [TYPES.KEEPALIVE]);
	assert.equal(msgs[0][1].length, 0);
});

test("drops an estimated header and uses the following exact header", () => {
	const msgs = [];
	const fa = new FrameAssembler({ onText: () => {}, onMessage: (t, p) => msgs.push([t, p]) });
	fa.push(header(TYPES.VALUE, 0x01, 999), true); // estimated -> ignored
	fa.push(header(TYPES.VALUE, 0x00, 24), true);  // exact
	fa.push(Buffer.alloc(24, 1), true);
	assert.equal(msgs.length, 1);
	assert.equal(msgs[0][1].length, 24);
});

test("routes a text frame and clears any pending text header", () => {
	const texts = [];
	const fa = new FrameAssembler({ onText: (s) => texts.push(s), onMessage: () => {} });
	fa.push(header(TYPES.TEXT, 0, 13), true); // announces a text message
	fa.push(Buffer.from("{\"LL\":\"ok\"}"), false);
	assert.deepEqual(texts, ["{\"LL\":\"ok\"}"]);
});
