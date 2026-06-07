"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { toControlMeta } = require("../lib/bridge/controlMeta");
const { getOrCreateClientId } = require("../lib/bridge/clientId");

const fakeStructure = { roomName: (u) => (u === "r1" ? "Wohnzimmer" : undefined), catName: (u) => (u === "c1" ? "Energie" : undefined) };

test("toControlMeta maps id/type/name/room/category, icon, and carries details", () => {
	const control = { uuid: "u1", type: "Meter", name: "PV", room: "r1", cat: "c1", details: { icon: "Icons/pv.svg" } };
	assert.deepEqual(toControlMeta(control, fakeStructure), {
		id: "u1", type: "Meter", name: "PV", room: "Wohnzimmer", category: "Energie", iconUuid: "Icons/pv.svg", details: { icon: "Icons/pv.svg" }
	});
});

test("toControlMeta tolerates missing room/cat/icon", () => {
	const m = toControlMeta({ uuid: "u2", type: "Switch", name: "Lampe" }, fakeStructure);
	assert.equal(m.room, null);
	assert.equal(m.category, null);
	assert.equal(m.iconUuid, null);
	assert.deepEqual(m.details, {});
});

test("getOrCreateClientId persists a stable UUID", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loxid-"));
	const file = path.join(dir, ".client-uuid");
	const a = getOrCreateClientId(file);
	const b = getOrCreateClientId(file);
	assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	assert.equal(a, b);
});
