"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Requester } = require("../lib/loxone/net/Requester");

test("command resolves with parsed LL responses in FIFO order", async () => {
	const sent = [];
	const r = new Requester((c) => sent.push(c));
	const p1 = r.command("a");
	const p2 = r.command("b");
	assert.deepEqual(sent, ["a", "b"]);
	r.handleText("{\"LL\":{\"value\":\"1\",\"Code\":\"200\"}}");
	r.handleText("{\"LL\":{\"value\":\"2\",\"Code\":\"200\"}}");
	assert.equal((await p1).value, "1");
	assert.equal((await p2).value, "2");
});

test("commandRaw resolves with the raw text (e.g. structure file)", async () => {
	const r = new Requester(() => {});
	const p = r.commandRaw("data/LoxAPP3.json");
	r.handleText("{\"lastModified\":\"x\"}");
	assert.equal(await p, "{\"lastModified\":\"x\"}");
});

test("commandEncrypted rejects without a session cipher", async () => {
	const r = new Requester(() => {});
	await assert.rejects(() => r.commandEncrypted("x"), /session cipher/);
});

test("commandEncrypted sends the cipher-wrapped command", async () => {
	const sent = [];
	const r = new Requester((c) => sent.push(c));
	r.setCipher({ encrypt: (cmd) => `ENC(${cmd})` });
	const p = r.commandEncrypted("jdev/sys/getjwt/...");
	assert.equal(sent[0], "ENC(jdev/sys/getjwt/...)");
	r.handleText("{\"LL\":{\"value\":{\"token\":\"t\"},\"Code\":\"200\"}}");
	assert.deepEqual((await p).value, { token: "t" });
});

test("rejectAll rejects all pending requests and clears the queue", async () => {
	const r = new Requester(() => {});
	const p = r.command("x");
	r.rejectAll(new Error("boom"));
	await assert.rejects(() => p, /boom/);
	r.handleText("{\"LL\":{\"value\":\"late\",\"Code\":\"200\"}}"); // no pending -> no throw
});
