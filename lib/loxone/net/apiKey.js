"use strict";

function parseApiKeyValue(value) {
	if (value && typeof value === "object") {
		return value;
	}
	const s = String(value);
	try {
		return JSON.parse(s);
	} catch (e) {
		return JSON.parse(s.replace(/'/g, "\""));
	}
}

module.exports = { parseApiKeyValue };
