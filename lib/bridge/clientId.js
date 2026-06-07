"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function getOrCreateClientId(filePath) {
	try {
		const existing = fs.readFileSync(filePath, "utf8").trim();
		if (existing) {
			return existing;
		}
	} catch (e) {
		// not created yet
	}
	const id = crypto.randomUUID();
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, id);
	return id;
}

module.exports = { getOrCreateClientId };
