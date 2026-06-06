"use strict";
const { parseLL } = require("../protocol/response");

class Requester {
	constructor(send) {
		this.send = send;
		this.queue = [];
		this.cipher = null;
	}

	setCipher(cipher) {
		this.cipher = cipher;
	}

	handleText(text) {
		const pending = this.queue.shift();
		if (!pending) {
			return;
		}
		try {
			pending.resolve(pending.raw ? text : parseLL(text));
		} catch (e) {
			pending.reject(e);
		}
	}

	_enqueue(cmd, raw) {
		return new Promise((resolve, reject) => {
			this.queue.push({ resolve, reject, raw });
			this.send(cmd);
		});
	}

	command(cmd) {
		return this._enqueue(cmd, false);
	}

	commandRaw(cmd) {
		return this._enqueue(cmd, true);
	}

	rejectAll(err) {
		while (this.queue.length) {
			this.queue.shift().reject(err);
		}
	}

	commandEncrypted(cmd) {
		if (!this.cipher) {
			return Promise.reject(new Error("No session cipher established"));
		}
		return this._enqueue(this.cipher.encrypt(cmd), false);
	}
}

module.exports = { Requester };
