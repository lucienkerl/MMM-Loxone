"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { IconCache, recolorSvg } = require("../lib/loxone/IconCache");

const U = (p) => `${p}-0000-0000-0000000000000000`;

test("recolorSvg swaps explicit fills for currentColor, keeps fill=none, fills the root", () => {
	const svg = "<svg viewBox=\"0 0 24 24\"><path fill=\"#ff0000\" d=\"M0 0\"/><path fill=\"none\" d=\"M1 1\"/></svg>";
	const out = recolorSvg(svg);
	assert.ok(out.includes("fill=\"currentColor\""));
	assert.ok(out.includes("fill=\"none\""));
	assert.ok(/<svg[^>]*fill="currentColor"/.test(out));
});

test("IconCache fetches over the requester, recolors, and caches by uuid", async () => {
	let calls = 0;
	const requester = { commandRaw: async () => { calls += 1; return "<svg><path fill=\"#123456\" d=\"M0 0\"/></svg>"; } };
	const cache = new IconCache(requester);
	const a = await cache.get(U("dddd0001"));
	const b = await cache.get(U("dddd0001"));
	assert.ok(a.includes("currentColor"));
	assert.equal(a, b);
	assert.equal(calls, 1);
});

test("IconCache returns null for a non-svg response or a falsy uuid", async () => {
	const cache = new IconCache({ commandRaw: async () => "not an svg" });
	assert.equal(await cache.get(U("dddd0002")), null);
	assert.equal(await cache.get(null), null);
});
