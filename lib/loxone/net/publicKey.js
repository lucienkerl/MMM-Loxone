"use strict";

function normalizePublicKey(raw) {
	let key = String(raw).trim()
		.replace(/-----BEGIN CERTIFICATE-----/g, "-----BEGIN PUBLIC KEY-----")
		.replace(/-----END CERTIFICATE-----/g, "-----END PUBLIC KEY-----");
	const body = key
		.replace(/-----BEGIN PUBLIC KEY-----/, "")
		.replace(/-----END PUBLIC KEY-----/, "")
		.replace(/\s+/g, "");
	if (!body) {
		return key;
	}
	const wrapped = (body.match(/.{1,64}/g) || [body]).join("\n");
	return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`;
}

module.exports = { normalizePublicKey };
