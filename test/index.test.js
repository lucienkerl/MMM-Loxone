"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../lib/loxone");

test("public entry exports LoxoneClient and the resolution errors", () => {
	assert.equal(typeof lib.LoxoneClient, "function");
	assert.equal(typeof lib.NotFoundError, "function");
	assert.equal(typeof lib.AmbiguousNameError, "function");
});
