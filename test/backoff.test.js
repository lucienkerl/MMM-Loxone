"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { computeBackoff } = require("../lib/loxone/net/backoff");

test("grows exponentially and caps at max", () => {
	assert.equal(computeBackoff(1, 60000, 1000), 1000);
	assert.equal(computeBackoff(2, 60000, 1000), 2000);
	assert.equal(computeBackoff(3, 60000, 1000), 4000);
	assert.equal(computeBackoff(20, 60000, 1000), 60000);
});

test("never below the base and tolerates attempt 0", () => {
	assert.equal(computeBackoff(0, 60000, 1000), 1000);
});
