"use strict";
const { aesEncryptBase64, randomSalt } = require("../crypto/LoxoneCrypto");

class CommandCipher {
	constructor(keyBuf, ivBuf, options) {
		const opts = options || {};
		this.keyBuf = keyBuf;
		this.ivBuf = ivBuf;
		this.salt = opts.salt || randomSalt(2);
		this.maxUses = opts.maxUses || 20;
		this.uses = 0;
	}

	_plaintextFor(cmd) {
		if (this.uses >= this.maxUses) {
			const prev = this.salt;
			const next = randomSalt(2);
			this.salt = next;
			this.uses = 1;
			return `nextSalt/${prev}/${next}/${cmd}`;
		}
		this.uses += 1;
		return `salt/${this.salt}/${cmd}`;
	}

	_wrap(prefix, cmd) {
		const cipher = encodeURIComponent(aesEncryptBase64(this.keyBuf, this.ivBuf, this._plaintextFor(cmd)));
		return `${prefix}/${cipher}`;
	}

	encrypt(cmd) {
		return this._wrap("jdev/sys/enc", cmd);
	}

	encryptFull(cmd) {
		return this._wrap("jdev/sys/fenc", cmd);
	}
}

module.exports = { CommandCipher };
