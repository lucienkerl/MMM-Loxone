"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { TokenStore, isTokenUsable, LOX_EPOCH } = require("../lib/loxone/auth/TokenStore");

test("save/load/clear round-trips per host+user", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loxtok-"));
	const store = new TokenStore(path.join(dir, "tokens.json"));
	assert.equal(store.load("ms1", "mirror"), null);
	store.save("ms1", "mirror", { token: "t", validUntil: 123, hashAlg: "SHA256" });
	assert.deepEqual(store.load("ms1", "mirror"), { token: "t", validUntil: 123, hashAlg: "SHA256" });
	assert.equal(store.load("ms1", "other"), null); // scoped by user
	store.clear("ms1", "mirror");
	assert.equal(store.load("ms1", "mirror"), null);
});

test("isTokenUsable respects validUntil (Loxone epoch) and the threshold", () => {
	const nowMs = 1_700_000_000_000;
	const nowSec = Math.floor(nowMs / 1000);
	const future = { token: "t", validUntil: nowSec - LOX_EPOCH + 1000 };
	const past = { token: "t", validUntil: nowSec - LOX_EPOCH - 10 };
	assert.equal(isTokenUsable(future, nowMs, 60), true);
	assert.equal(isTokenUsable(past, nowMs, 60), false);
	assert.equal(isTokenUsable(null, nowMs, 60), false);
	assert.equal(isTokenUsable({ token: "t" }, nowMs, 60), false); // no validUntil
});
