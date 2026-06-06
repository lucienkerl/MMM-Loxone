"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { uuidFromBuffer, UUID_BYTES } = require("../lib/loxone/protocol/uuid");

test("uuidFromBuffer decodes Data1 LE / Data2 LE / Data3 LE / Data4[8]", () => {
	// 0d12f989-0060-c82f-ffff2083eaf2523c
	const buf = Buffer.from([
		0x89, 0xf9, 0x12, 0x0d, // Data1 = 0x0d12f989 (LE)
		0x60, 0x00,             // Data2 = 0x0060 (LE)
		0x2f, 0xc8,             // Data3 = 0xc82f (LE)
		0xff, 0xff, 0x20, 0x83, 0xea, 0xf2, 0x52, 0x3c // Data4
	]);
	assert.equal(uuidFromBuffer(buf, 0), "0d12f989-0060-c82f-ffff2083eaf2523c");
	assert.equal(UUID_BYTES, 16);
});

test("uuidFromBuffer honours the offset", () => {
	const buf = Buffer.concat([Buffer.alloc(4, 0), Buffer.from([
		0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x03, 0x00, 0, 0, 0, 0, 0, 0, 0, 0
	])]);
	assert.equal(uuidFromBuffer(buf, 4), "00000001-0002-0003-0000000000000000");
});
