"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseLL } = require("../lib/loxone/protocol/response");

test("parseLL reads control, value, and numeric Code", () => {
	const r = parseLL("{\"LL\":{\"control\":\"dev/cfg/api\",\"value\":\"hi\",\"Code\":\"200\"}}");
	assert.deepEqual(r, { control: "dev/cfg/api", value: "hi", code: 200 });
});

test("parseLL accepts lowercase 'code' and object values", () => {
	const r = parseLL({ LL: { control: "c", value: { token: "t" }, code: 200 } });
	assert.equal(r.code, 200);
	assert.deepEqual(r.value, { token: "t" });
});

test("parseLL tolerates a missing LL envelope", () => {
	const r = parseLL({});
	assert.equal(r.code, undefined);
	assert.equal(r.value, undefined);
});
