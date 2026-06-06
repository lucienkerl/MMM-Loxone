"use strict";
const { uuidFromBuffer } = require("./uuid");

const VALUE_RECORD = 24;
const TEXT_FIXED = 36; // uuid(16) + iconUuid(16) + len(4)

function parseValueEvents(buf) {
	const out = [];
	for (let o = 0; o + VALUE_RECORD <= buf.length; o += VALUE_RECORD) {
		out.push({ uuid: uuidFromBuffer(buf, o), value: buf.readDoubleLE(o + 16) });
	}
	return out;
}

function parseTextEvents(buf) {
	const out = [];
	let o = 0;
	while (o + TEXT_FIXED <= buf.length) {
		const uuid = uuidFromBuffer(buf, o);
		const iconUuid = uuidFromBuffer(buf, o + 16);
		const len = buf.readUInt32LE(o + 32);
		const textStart = o + TEXT_FIXED;
		if (textStart + len > buf.length) {
			break;
		}
		const text = buf.slice(textStart, textStart + len).toString("utf8");
		out.push({ uuid, iconUuid, text });
		let advance = TEXT_FIXED + len;
		if (advance % 4 !== 0) {
			advance += 4 - (advance % 4);
		}
		o += advance;
	}
	return out;
}

module.exports = { parseValueEvents, parseTextEvents, VALUE_RECORD };
