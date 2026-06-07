"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseValueEvents, parseTextEvents } = require("../lib/loxone/protocol/EventParser");

function uuidBytes(d1) {
	const b = Buffer.alloc(16);
	b.writeUInt32LE(d1, 0);
	return b;
}

test("parseValueEvents decodes 24-byte {uuid, double} records", () => {
	const rec = Buffer.concat([uuidBytes(0x11), Buffer.alloc(8)]);
	rec.writeDoubleLE(21.5, 16);
	const rec2 = Buffer.concat([uuidBytes(0x22), Buffer.alloc(8)]);
	rec2.writeDoubleLE(-1.25, 16);
	const events = parseValueEvents(Buffer.concat([rec, rec2]));
	assert.equal(events.length, 2);
	assert.equal(events[0].uuid, "00000011-0000-0000-0000000000000000");
	assert.equal(events[0].value, 21.5);
	assert.equal(events[1].value, -1.25);
});

test("parseTextEvents decodes {uuid, iconUuid, len, text} with 4-byte padding", () => {
	const text = "Hello"; // length 5 -> padded to 8
	const head = Buffer.concat([uuidBytes(0xaa), uuidBytes(0xbb), Buffer.alloc(4)]);
	head.writeUInt32LE(text.length, 32);
	const padded = Buffer.alloc(8);
	padded.write(text, 0, "utf8");
	const second = Buffer.concat([uuidBytes(0xcc), uuidBytes(0xdd), Buffer.alloc(4)]);
	second.writeUInt32LE(0, 32);
	const events = parseTextEvents(Buffer.concat([head, padded, second]));
	assert.equal(events.length, 2);
	assert.equal(events[0].uuid, "000000aa-0000-0000-0000000000000000");
	assert.equal(events[0].iconUuid, "000000bb-0000-0000-0000000000000000");
	assert.equal(events[0].text, "Hello");
	assert.equal(events[1].text, "");
});
