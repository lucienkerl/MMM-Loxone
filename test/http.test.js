"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { httpGetJson } = require("../lib/loxone/net/http");

test("fetches and JSON-parses a response", async () => {
	const server = http.createServer((req, res) => {
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ LL: { control: req.url, value: "ok", Code: "200" } }));
	});
	await new Promise((r) => server.listen(0, r));
	const { port } = server.address();
	try {
		const json = await httpGetJson(`http://127.0.0.1:${port}/jdev/cfg/apiKey`);
		assert.equal(json.LL.value, "ok");
	} finally {
		server.close();
	}
});

test("rejects on invalid JSON", async () => {
	const server = http.createServer((req, res) => res.end("not json"));
	await new Promise((r) => server.listen(0, r));
	const { port } = server.address();
	try {
		await assert.rejects(() => httpGetJson(`http://127.0.0.1:${port}/x`), /Invalid JSON/);
	} finally {
		server.close();
	}
});

test("rejects with a timeout error when the server never responds", async () => {
	const server = http.createServer(() => { /* accept but never respond */ });
	await new Promise((r) => server.listen(0, r));
	const { port } = server.address();
	try {
		await assert.rejects(
			() => httpGetJson(`http://127.0.0.1:${port}/hang`, { timeoutMs: 120 }),
			/timed out/i
		);
	} finally {
		server.closeAllConnections();
		server.close();
	}
});
