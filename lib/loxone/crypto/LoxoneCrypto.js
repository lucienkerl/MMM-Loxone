"use strict";
const crypto = require("crypto");

function nodeAlg(hashAlg) {
	return hashAlg === "SHA256" ? "sha256" : "sha1";
}

function digestHex(hashAlg, input) {
	return crypto.createHash(nodeAlg(hashAlg)).update(input, "utf8").digest("hex");
}

function hmacHex(hashAlg, keyBuf, message) {
	return crypto.createHmac(nodeAlg(hashAlg), keyBuf).update(message, "utf8").digest("hex");
}

function hexToBuf(hex) {
	return Buffer.from(hex, "hex");
}

function passwordHash(password, userSalt, hashAlg) {
	return digestHex(hashAlg, `${password}:${userSalt}`).toUpperCase();
}

function credentialHash(user, pwHashUpper, keyHex, hashAlg) {
	return hmacHex(hashAlg, hexToBuf(keyHex), `${user}:${pwHashUpper}`);
}

function tokenHash(token, keyHex, hashAlg) {
	return hmacHex(hashAlg, hexToBuf(keyHex), token);
}

module.exports = { digestHex, hmacHex, hexToBuf, passwordHash, credentialHash, tokenHash };
