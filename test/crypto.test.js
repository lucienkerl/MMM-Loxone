"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const C = require("../lib/loxone/crypto/LoxoneCrypto");

test("digestHex matches known SHA1/SHA256 vectors", () => {
	assert.equal(C.digestHex("SHA1", "abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
	assert.equal(C.digestHex("SHA256", "abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("hmacHex matches known RFC vectors", () => {
	const key = Buffer.from("key");
	const msg = "The quick brown fox jumps over the lazy dog";
	assert.equal(C.hmacHex("SHA1", key, msg), "de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9");
	assert.equal(C.hmacHex("SHA256", key, msg), "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
});

test("hexToBuf converts hex string to bytes", () => {
	assert.deepEqual(C.hexToBuf("0a0b0c"), Buffer.from([10, 11, 12]));
});

test("passwordHash is uppercase HASH of '{pw}:{userSalt}'", () => {
	const expected = crypto.createHash("sha1").update("secret:abcd1234").digest("hex").toUpperCase();
	assert.equal(C.passwordHash("secret", "abcd1234", "SHA1"), expected);
});

test("credentialHash is HMAC('{user}:{pwHash}') keyed by hex key", () => {
	const pwHash = C.passwordHash("secret", "abcd1234", "SHA256");
	const keyHex = "00112233445566778899aabbccddeeff";
	const expected = crypto.createHmac("sha256", Buffer.from(keyHex, "hex")).update(`mirror:${pwHash}`).digest("hex");
	assert.equal(C.credentialHash("mirror", pwHash, keyHex, "SHA256"), expected);
});

test("tokenHash is HMAC(token) keyed by hex key", () => {
	const keyHex = "0011223344556677";
	const expected = crypto.createHmac("sha1", Buffer.from(keyHex, "hex")).update("the.jwt.token").digest("hex");
	assert.equal(C.tokenHash("the.jwt.token", keyHex, "SHA1"), expected);
});
