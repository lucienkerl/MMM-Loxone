"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Auth = require("../lib/loxone/auth/Authenticator");
const C = require("../lib/loxone/crypto/LoxoneCrypto");

function mockRequester(responses) {
	const sent = [];
	return {
		sent,
		command(cmd) { sent.push(["plain", cmd]); return Promise.resolve(responses.shift()); },
		commandEncrypted(cmd) { sent.push(["enc", cmd]); return Promise.resolve(responses.shift()); }
	};
}

test("acquireToken does getkey2 then ENCRYPTED getjwt with the correct hash", async () => {
	const keyHex = "00112233445566778899aabbccddeeff";
	const userSalt = "5e3d";
	const req = mockRequester([
		{ code: 200, value: { key: keyHex, salt: userSalt, hashAlg: "SHA256" } },
		{ code: 200, value: { token: "jwt123", validUntil: 999, tokenRights: 4, unsecurePass: false, key: "newkey" } }
	]);
	const rec = await Auth.acquireToken(req, {
		user: "mirror", password: "pw", permission: "app", clientUuid: "uuid-1", clientInfo: "Mirror Test"
	});
	assert.equal(req.sent[0][1], "jdev/sys/getkey2/mirror");
	assert.equal(req.sent[1][0], "enc"); // getjwt MUST be encrypted (spec §7.3)
	const pwHash = C.passwordHash("pw", userSalt, "SHA256");
	const hash = C.credentialHash("mirror", pwHash, keyHex, "SHA256");
	assert.ok(req.sent[1][1].startsWith(`jdev/sys/getjwt/${hash}/mirror/4/uuid-1/`));
	assert.equal(rec.token, "jwt123");
	assert.equal(rec.validUntil, 999);
	assert.equal(rec.hashAlg, "SHA256");
});

test("authWithToken hashes the token with the getkey result", async () => {
	const keyHex = "0011223344556677";
	const req = mockRequester([
		{ code: 200, value: keyHex },
		{ code: 200, value: {} }
	]);
	const ok = await Auth.authWithToken(req, { user: "mirror", token: "jwt123", hashAlg: "SHA1" });
	assert.equal(req.sent[0][1], "jdev/sys/getkey");
	assert.equal(req.sent[1][1], `authwithtoken/${C.tokenHash("jwt123", keyHex, "SHA1")}/mirror`);
	assert.equal(ok, true);
});

test("authWithToken returns false on non-200", async () => {
	const req = mockRequester([{ code: 200, value: "00ff" }, { code: 401, value: {} }]);
	assert.equal(await Auth.authWithToken(req, { user: "m", token: "t", hashAlg: "SHA256" }), false);
});
