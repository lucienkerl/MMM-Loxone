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

function rsaEncryptBase64(publicKeyPem, plaintext) {
	const enc = crypto.publicEncrypt(
		{ key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
		Buffer.from(plaintext, "utf8")
	);
	return enc.toString("base64");
}

function zeroPad(buf, block) {
	const size = block || 16;
	const rem = buf.length % size;
	return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(size - rem, 0)]);
}

function aesEncryptBase64(keyBuf, ivBuf, plaintext) {
	const cipher = crypto.createCipheriv("aes-256-cbc", keyBuf, ivBuf);
	cipher.setAutoPadding(false);
	const padded = zeroPad(Buffer.from(plaintext, "utf8"), 16);
	return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

function aesDecryptString(keyBuf, ivBuf, b64) {
	const decipher = crypto.createDecipheriv("aes-256-cbc", keyBuf, ivBuf);
	decipher.setAutoPadding(false);
	const out = Buffer.concat([decipher.update(Buffer.from(b64, "base64")), decipher.final()]);
	let end = out.length;
	while (end > 0 && out[end - 1] === 0) {
		end--;
	}
	return out.slice(0, end).toString("utf8");
}

function generateSessionKey() {
	const keyBuf = crypto.randomBytes(32);
	const ivBuf = crypto.randomBytes(16);
	return { keyBuf, ivBuf, keyHex: keyBuf.toString("hex"), ivHex: ivBuf.toString("hex") };
}

function randomSalt(bytes) {
	return crypto.randomBytes(bytes || 2).toString("hex");
}

module.exports = {
	digestHex, hmacHex, hexToBuf,
	passwordHash, credentialHash, tokenHash,
	rsaEncryptBase64, aesEncryptBase64, aesDecryptString, zeroPad, generateSessionKey, randomSalt
};
