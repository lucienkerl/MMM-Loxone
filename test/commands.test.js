"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CommandCipher } = require("../lib/loxone/protocol/commands");
const { aesDecryptString } = require("../lib/loxone/crypto/LoxoneCrypto");

const KEY = Buffer.alloc(32, 3);
const IV = Buffer.alloc(16, 4);

function decode(cmd) {
	const cipher = cmd.replace(/^jdev\/sys\/f?enc\//, "");
	return aesDecryptString(KEY, IV, decodeURIComponent(cipher));
}

test("encrypt frames cmd as salt/{salt}/{cmd} under jdev/sys/enc/", () => {
	const cc = new CommandCipher(KEY, IV, { salt: "ab12" });
	const out = cc.encrypt("jdev/sps/enablebinstatusupdate");
	assert.ok(out.startsWith("jdev/sys/enc/"));
	assert.equal(decode(out), "salt/ab12/jdev/sps/enablebinstatusupdate");
});

test("rotates salt with nextSalt/{prev}/{next}/{cmd} after maxUses", () => {
	const cc = new CommandCipher(KEY, IV, { salt: "aaaa", maxUses: 1 });
	cc.encrypt("cmd1"); // consumes the initial salt
	const plain = decode(cc.encrypt("cmd2"));
	assert.match(plain, /^nextSalt\/aaaa\/[0-9a-f]{4}\/cmd2$/);
});

test("encryptFull uses the response-encrypting jdev/sys/fenc/ form", () => {
	const cc = new CommandCipher(KEY, IV, { salt: "ab12" });
	assert.ok(cc.encryptFull("cmd").startsWith("jdev/sys/fenc/"));
});
