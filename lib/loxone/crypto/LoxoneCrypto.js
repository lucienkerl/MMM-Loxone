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

module.exports = { digestHex, hmacHex, hexToBuf };
