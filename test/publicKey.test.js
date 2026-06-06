"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { normalizePublicKey } = require("../lib/loxone/net/publicKey");

test("rebuilds a usable PEM from Loxone's single-line CERTIFICATE-wrapped key", () => {
	const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const spki = publicKey.export({ type: "spki", format: "pem" }).toString();
	const body = spki.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s+/g, "");
	const loxoneStyle = `-----BEGIN CERTIFICATE-----${body}-----END CERTIFICATE-----`;
	const pem = normalizePublicKey(loxoneStyle);
	assert.match(pem, /-----BEGIN PUBLIC KEY-----/);
	// Normalization must preserve the key: identical SPKI DER to the original (portable across Node versions).
	const origDer = crypto.createPublicKey(spki).export({ type: "spki", format: "der" });
	const normDer = crypto.createPublicKey(pem).export({ type: "spki", format: "der" });
	assert.ok(origDer.equals(normDer));
	// ...and the normalized PEM is usable for PKCS#1 encryption (256-byte block for RSA-2048).
	const enc = crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from("k:v"));
	assert.equal(Buffer.from(enc).length, 256);
});

test("passes through an already-valid PEM", () => {
	const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const spki = publicKey.export({ type: "spki", format: "pem" }).toString();
	const pem = normalizePublicKey(spki);
	assert.doesNotThrow(() => crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from("x")));
});
