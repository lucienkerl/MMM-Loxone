"use strict";
const { parseHeader } = require("./MessageHeader");

class FrameAssembler {
	constructor(handlers) {
		this.onText = handlers.onText;
		this.onMessage = handlers.onMessage;
		this.pending = null;
	}

	push(data, isBinary) {
		if (!isBinary) {
			// A text frame; the header that announced it (if any) is consumed.
			this.pending = null;
			this.onText(Buffer.isBuffer(data) ? data.toString() : String(data));
			return;
		}
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
		if (!this.pending) {
			const h = parseHeader(buf);
			if (!h) {
				return; // unexpected non-header binary frame; ignore
			}
			if (h.estimated) {
				return; // an exact header always follows
			}
			if (h.length === 0) {
				this.onMessage(h.type, Buffer.alloc(0));
				return;
			}
			this.pending = h;
			return;
		}
		const h = this.pending;
		this.pending = null;
		this.onMessage(h.type, buf);
	}
}

module.exports = { FrameAssembler };
