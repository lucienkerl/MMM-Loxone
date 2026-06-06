"use strict";
const fs = require("fs");
const path = require("path");

const LOX_EPOCH = Date.UTC(2009, 0, 1) / 1000; // seconds since unix epoch at 2009-01-01

class TokenStore {
	constructor(filePath) {
		this.filePath = filePath;
	}

	_all() {
		try {
			return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
		} catch (e) {
			return {};
		}
	}

	_write(all) {
		fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
		fs.writeFileSync(this.filePath, JSON.stringify(all, null, 2));
	}

	key(host, user) {
		return `${host}::${user}`;
	}

	load(host, user) {
		return this._all()[this.key(host, user)] || null;
	}

	save(host, user, record) {
		const all = this._all();
		all[this.key(host, user)] = record;
		this._write(all);
	}

	clear(host, user) {
		const all = this._all();
		delete all[this.key(host, user)];
		this._write(all);
	}
}

function tokenSecondsRemaining(validUntilLox, nowMs) {
	return (LOX_EPOCH + validUntilLox) - Math.floor(nowMs / 1000);
}

function isTokenUsable(record, nowMs, minRemainingSec) {
	if (!record || !record.token || typeof record.validUntil !== "number") {
		return false;
	}
	return tokenSecondsRemaining(record.validUntil, nowMs) > (minRemainingSec || 0);
}

module.exports = { TokenStore, tokenSecondsRemaining, isTokenUsable, LOX_EPOCH };
