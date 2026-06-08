"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("events");
const { AudioServerClient } = require("../lib/loxone/audio/AudioServerClient");

function fakeTransport() {
	const t = new EventEmitter();
	t.opened = null;
	t.open = (url, sub) => { t.opened = { url, sub }; return Promise.resolve(); };
	t.close = () => t.emit("close", {});
	return t;
}

test("connects with the remotecontrol subprotocol and emits parsed audio_event", async () => {
	const fake = fakeTransport();
	const c = new AudioServerClient({ host: "10.0.1.190:7091", deps: { createTransport: () => fake } });
	const got = [];
	c.on("audioEvent", (e) => got.push(e));
	await c.connect();
	assert.deepEqual(fake.opened, { url: "ws://10.0.1.190:7091/", sub: "remotecontrol" });

	fake.emit("frame", Buffer.from(JSON.stringify({ audio_event: [{ playerid: 6, title: "X" }] })), false);
	assert.equal(got.length, 1);
	assert.equal(got[0][0].title, "X");
	c.stop();
});

test("ignores the identification line, command errors, and binary frames", async () => {
	const fake = fakeTransport();
	const c = new AudioServerClient({ host: "h", deps: { createTransport: () => fake } });
	const got = [];
	c.on("audioEvent", (e) => got.push(e));
	await c.connect();

	fake.emit("frame", Buffer.from("LWSS V 17.1 | ~API:1.6~ | Session-Token: abc"), false);
	fake.emit("frame", Buffer.from("404 command not found"), false);
	fake.emit("frame", Buffer.from(JSON.stringify({ getkey_result: [] })), false);
	fake.emit("frame", Buffer.from([0x01, 0x02, 0x03]), true);
	assert.equal(got.length, 0, "no audioEvent for non-audio_event messages");
	c.stop();
});
