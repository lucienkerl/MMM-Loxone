"use strict";
const UUID_BYTES = 16;

function hex(n, width) {
	return n.toString(16).padStart(width, "0");
}

function uuidFromBuffer(buf, offset) {
	const o = offset || 0;
	const d1 = buf.readUInt32LE(o);
	const d2 = buf.readUInt16LE(o + 4);
	const d3 = buf.readUInt16LE(o + 6);
	let tail = "";
	for (let i = 0; i < 8; i++) {
		tail += buf[o + 8 + i].toString(16).padStart(2, "0");
	}
	return `${hex(d1, 8)}-${hex(d2, 4)}-${hex(d3, 4)}-${tail}`;
}

module.exports = { uuidFromBuffer, UUID_BYTES };
