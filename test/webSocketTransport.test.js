"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocketServer } = require("ws");
const { WebSocketTransport } = require("../lib/loxone/transport/WebSocketTransport");

test("forwards text frames (isBinary=false) and binary frames (isBinary=true)", async () => {
	const wss = new WebSocketServer({ port: 0 });
	wss.on("connection", (socket) => {
		socket.send("hello-text");
		socket.send(Buffer.from([1, 2, 3]));
	});
	await new Promise((r) => wss.on("listening", r));
	const { port } = wss.address();
	const t = new WebSocketTransport();
	const frames = [];
	t.on("frame", (data, isBinary) => frames.push([isBinary, data]));
	await t.open(`ws://127.0.0.1:${port}`, "remotecontrol");
	await new Promise((r) => setTimeout(r, 150));
	t.close();
	wss.close();
	const text = frames.find((f) => f[0] === false);
	const bin = frames.find((f) => f[0] === true);
	assert.ok(text, "expected a text frame");
	assert.equal(text[1].toString(), "hello-text");
	assert.ok(bin, "expected a binary frame");
	assert.deepEqual(Buffer.from(bin[1]), Buffer.from([1, 2, 3]));
});
