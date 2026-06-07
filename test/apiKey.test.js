"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseApiKeyValue } = require("../lib/loxone/net/apiKey");

test("parses single-quoted Loxone apiKey payload", () => {
	const v = "{'snr': 'EE:11', 'version': '14.5.0.0', 'httpsStatus': 1, 'local': true}";
	assert.deepEqual(parseApiKeyValue(v), { snr: "EE:11", version: "14.5.0.0", httpsStatus: 1, local: true });
});

test("passes through standard JSON strings and objects", () => {
	assert.deepEqual(parseApiKeyValue("{\"a\":1}"), { a: 1 });
	assert.deepEqual(parseApiKeyValue({ a: 2 }), { a: 2 });
});
