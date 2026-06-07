"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const EventEmitter = require("events");
const { LoxoneClient } = require("../lib/loxone/LoxoneClient");
const { Structure } = require("../lib/loxone/structure/Structure");
const { TYPES } = require("../lib/loxone/protocol/MessageHeader");

const U = (p) => `${p}-0000-0000-0000000000000000`;
const POWER = U("aaaa1111");

function structureJson() {
	const ROOM = U("00aa0002");
	return JSON.stringify({
		lastModified: "2024-01-01 00:00:00",
		rooms: { [ROOM]: { uuid: ROOM, name: "Technik" } },
		cats: {},
		controls: {
			[U("11111111")]: { uuidAction: U("11111111"), name: "Wallbox", type: "Wallbox2", room: ROOM, states: { power: POWER } }
		},
		globalStates: {}
	});
}

function writeUuid(buf, off, uuid) {
	const [d1, d2, d3, tail] = uuid.split("-");
	buf.writeUInt32LE(parseInt(d1, 16), off);
	buf.writeUInt16LE(parseInt(d2, 16), off + 4);
	buf.writeUInt16LE(parseInt(d3, 16), off + 6);
	Buffer.from(tail, "hex").copy(buf, off + 8);
}

class FakeTransport extends EventEmitter {
	constructor() {
		super();
		this.sent = [];
	}
	open() {
		return Promise.resolve();
	}
	sendText(cmd) {
		this.sent.push(cmd);
		queueMicrotask(() => {
			const reply = (obj) => this.emit("frame", Buffer.from(JSON.stringify(obj)), false);
			if (cmd.includes("keyexchange")) {
				reply({ LL: { value: "ok", Code: "200" } });
			} else if (cmd.includes("getkey2")) {
				reply({ LL: { value: { key: "00ff", salt: "abcd", hashAlg: "SHA256" }, Code: "200" } });
			} else if (cmd.includes("jdev/sys/enc/")) { // encrypted getjwt
				reply({ LL: { value: { token: "jwt", validUntil: 9999999999, key: "00ff" }, Code: "200" } });
			} else if (cmd.includes("data/LoxAPP3.json")) {
				this.emit("frame", Buffer.from(structureJson()), false);
			} else if (cmd.includes("enablebinstatusupdate")) {
				reply({ LL: { value: "1", Code: "200" } });
			}
		});
	}
	close() {}
	pushValueEvent(stateUuid, value) {
		const header = Buffer.alloc(8);
		header[0] = 0x03;
		header[1] = TYPES.VALUE;
		header.writeUInt32LE(24, 4);
		const payload = Buffer.alloc(24);
		writeUuid(payload, 0, stateUuid);
		payload.writeDoubleLE(value, 16);
		this.emit("frame", header, true);
		this.emit("frame", payload, true);
	}
}

test("handshakes, loads structure, and emits controlState for a value event", async () => {
	const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
	const fake = new FakeTransport();
	const httpGetJson = async (url) => {
		if (url.includes("apiKey")) {
			return { LL: { value: "{'snr':'EE','version':'14.5','httpsStatus':1,'local':true}", Code: "200" } };
		}
		if (url.includes("getPublicKey")) {
			return { LL: { value: pubPem, Code: "200" } };
		}
		throw new Error(`unexpected url ${url}`);
	};
	const client = new LoxoneClient({
		host: "ms.local", user: "mirror", password: "pw",
		clientUuid: "uuid-1", clientInfo: "Test Mirror",
		controls: ["Wallbox"],
		deps: { createTransport: () => fake, httpGetJson, now: () => 1700000000000 }
	});

	const structureP = new Promise((r) => client.once("structure", r));
	await client.connect();
	await structureP;

	assert.ok(fake.sent.some((c) => c.includes("keyexchange")), "sent keyexchange");
	const kxCmd = fake.sent.find((c) => c.includes("keyexchange/"));
	const kxPayload = kxCmd.slice(kxCmd.indexOf("keyexchange/") + "keyexchange/".length);
	assert.match(kxPayload, /^[A-Za-z0-9+/]+={0,2}$/, "keyexchange session key must be raw base64, not URL-encoded");
	assert.ok(fake.sent.some((c) => c.includes("getkey2")), "sent getkey2");
	assert.ok(fake.sent.some((c) => c.includes("jdev/sys/enc/")), "sent ENCRYPTED getjwt");
	assert.ok(fake.sent.some((c) => c.includes("data/LoxAPP3.json")), "downloaded structure");
	assert.ok(fake.sent.some((c) => c.includes("enablebinstatusupdate")), "subscribed");

	const stateP = new Promise((r) => client.once("controlState", (id, states) => r({ id, states })));
	fake.pushValueEvent(POWER, 11);
	const evt = await stateP;
	assert.equal(evt.id, U("11111111"));
	assert.equal(evt.states.power, 11);

	client.stop();
});

test("emits a warning for an unresolved configured control", async () => {
	const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
	const fake = new FakeTransport();
	const httpGetJson = async (url) => (url.includes("apiKey")
		? { LL: { value: "{'local':true}", Code: "200" } }
		: { LL: { value: pubPem, Code: "200" } });
	const client = new LoxoneClient({
		host: "ms.local", user: "m", password: "p", clientUuid: "u", clientInfo: "i",
		controls: ["DoesNotExist"],
		deps: { createTransport: () => fake, httpGetJson, now: () => 1700000000000 }
	});
	const warnP = new Promise((r) => client.once("warnings", r));
	await client.connect();
	const warnings = await warnP;
	assert.equal(warnings[0].entry, "DoesNotExist");
	assert.equal(warnings[0].reason, "NotFoundError");
	client.stop();
});

test("coalesces multiple reconnect triggers into a single attempt", async () => {
	const client = new LoxoneClient({
		host: "ms.local", user: "m", password: "p", clientUuid: "u", clientInfo: "i",
		controls: [], reconnectMaxBackoffMs: 10,
		deps: { createTransport: () => new FakeTransport(), httpGetJson: async () => ({}), now: () => 1700000000000 }
	});
	let connectCount = 0;
	client.connect = () => { connectCount += 1; return Promise.resolve(client); };
	// Both the open() catch path and the close path can fire for one failure.
	client._scheduleReconnect();
	client._scheduleReconnect();
	client._scheduleReconnect();
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(connectCount, 1, "three triggers must schedule exactly one reconnect");
	client.stop();
});

function efmStructure() {
	const CAT = U("00cc0001");
	const EFM = U("0efm0000");
	const NETZ = U("0e1d0001");
	const PV = U("0e1d0002");
	const OTHER = U("0e1d0009");
	return new Structure({
		rooms: {}, cats: { [CAT]: { uuid: CAT, name: "Energie" } },
		controls: {
			[EFM]: { uuidAction: EFM, name: "Energieflussmonitor", type: "EFM", cat: CAT, states: {},
				details: { nodes: [{ ctrlUuid: NETZ, nodeType: "Grid" }, { ctrlUuid: PV, nodeType: "Production" }] } },
			[NETZ]: { uuidAction: NETZ, name: "Netz", type: "Meter", cat: CAT, states: {} },
			[PV]: { uuidAction: PV, name: "PV", type: "Meter", cat: CAT, states: {} },
			[OTHER]: { uuidAction: OTHER, name: "Wallbox", type: "Wallbox2", cat: CAT, states: {} }
		},
		globalStates: {}
	});
}

function displayNames(opt) {
	const c = new LoxoneClient(Object.assign({ host: "h", user: "u", password: "p", clientUuid: "x", clientInfo: "i" }, opt));
	c.structure = efmStructure();
	c._resolveDisplay();
	return c.display.map((u) => c.structure.getControl(u).name).sort();
}

test("a category sweep hides the meters an EFM references (absorbed into the EFM tile)", () => {
	assert.deepEqual(displayNames({ categories: ["Energie"] }), ["Energieflussmonitor", "Wallbox"]);
});

test("an explicitly listed control survives EFM absorption", () => {
	assert.deepEqual(displayNames({ categories: ["Energie"], controls: ["Netz"] }), ["Energieflussmonitor", "Netz", "Wallbox"]);
});

test("hideEfmChildren:false keeps the referenced meters as separate tiles", () => {
	assert.deepEqual(displayNames({ categories: ["Energie"], hideEfmChildren: false }), ["Energieflussmonitor", "Netz", "PV", "Wallbox"]);
});

test("stop() cancels a pending reconnect so a stopped client stays stopped", async () => {
	const client = new LoxoneClient({
		host: "ms.local", user: "m", password: "p", clientUuid: "u", clientInfo: "i",
		controls: [], reconnectMaxBackoffMs: 10,
		deps: { createTransport: () => new FakeTransport(), httpGetJson: async () => ({}), now: () => 1700000000000 }
	});
	let connectCount = 0;
	client.connect = () => { connectCount += 1; return Promise.resolve(client); };
	client._scheduleReconnect();
	client.stop();
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(connectCount, 0, "stop() must cancel the pending reconnect");
});
