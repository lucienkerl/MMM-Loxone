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

test("rsaEncryptBase64 produces a valid RSA-2048 PKCS#1 ciphertext", () => {
	// Node 20+ forbids privateDecrypt with PKCS1 padding (CVE-2023-46809); the Miniserver
	// path only encrypts. Verify the public-key encryption side instead of round-tripping.
	const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const pem = publicKey.export({ type: "spki", format: "pem" });
	const a = C.rsaEncryptBase64(pem, "deadbeef:cafebabe");
	const b = C.rsaEncryptBase64(pem, "deadbeef:cafebabe");
	assert.equal(Buffer.from(a, "base64").length, 256); // 2048-bit modulus -> 256-byte block
	assert.notEqual(a, b); // PKCS#1 v1.5 random padding -> ciphertext differs each time
});

test("aesEncryptBase64/aesDecryptString round-trip with zero padding (non-block-aligned)", () => {
	const key = Buffer.alloc(32, 7);
	const iv = Buffer.alloc(16, 9);
	const plain = "salt/ab12/jdev/sps/enablebinstatusupdate"; // not a multiple of 16
	const cipher = C.aesEncryptBase64(key, iv, plain);
	assert.equal(C.aesDecryptString(key, iv, cipher), plain);
});

test("aesEncryptBase64 is deterministic for fixed key/iv", () => {
	const key = Buffer.alloc(32, 1);
	const iv = Buffer.alloc(16, 2);
	assert.equal(C.aesEncryptBase64(key, iv, "hello"), C.aesEncryptBase64(key, iv, "hello"));
});

test("generateSessionKey yields 32-byte key + 16-byte iv as hex", () => {
	const s = C.generateSessionKey();
	assert.equal(s.keyHex.length, 64);
	assert.equal(s.ivHex.length, 32);
	assert.equal(s.keyBuf.length, 32);
	assert.equal(s.ivBuf.length, 16);
});

test("randomSalt returns hex of requested byte length", () => {
	assert.equal(C.randomSalt(2).length, 4);
	assert.notEqual(C.randomSalt(2), C.randomSalt(2));
});
