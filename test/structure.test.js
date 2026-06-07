"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Structure, NotFoundError, AmbiguousNameError, looksLikeUuid } = require("../lib/loxone/structure/Structure");

const U = (p) => `${p}-0000-0000-0000000000000000`;

function fixture() {
	const ROOM_WZ = U("00aa0001");
	const ROOM_TK = U("00aa0002");
	const ROOM_HID = U("00aa0003");
	const CAT_EN = U("00cc0001");
	return {
		lastModified: "2024-01-01 12:00:00",
		rooms: {
			[ROOM_WZ]: { uuid: ROOM_WZ, name: "Wohnzimmer" },
			[ROOM_TK]: { uuid: ROOM_TK, name: "Technik" },
			[ROOM_HID]: { uuid: ROOM_HID, name: "Versteckt" }
		},
		cats: { [CAT_EN]: { uuid: CAT_EN, name: "Energie" } },
		controls: {
			[U("11111111")]: { uuidAction: U("11111111"), name: "Wallbox", type: "Wallbox2", room: ROOM_TK, cat: CAT_EN,
				states: { power: U("aaaa1111"), sessionEnergy: U("aaaa2222") } },
			[U("22222222")]: { uuidAction: U("22222222"), name: "Licht", type: "Switch", room: ROOM_WZ,
				states: { active: U("bbbb1111") } },
			[U("33333333")]: { uuidAction: U("33333333"), name: "Licht", type: "Switch", room: ROOM_TK,
				states: { active: U("bbbb2222") } },
			[U("44444444")]: { uuidAction: U("44444444"), name: "Geheim", type: "", room: ROOM_HID, states: {} }
		},
		globalStates: { notifications: U("ffff0000") }
	};
}

test("looksLikeUuid distinguishes UUIDs from names", () => {
	assert.equal(looksLikeUuid(U("11111111")), true);
	assert.equal(looksLikeUuid("Wallbox"), false);
});

test("resolve by UUID returns the control", () => {
	const s = new Structure(fixture());
	assert.equal(s.resolve(U("11111111")).name, "Wallbox");
});

test("resolve by unique name returns the control (case-insensitive)", () => {
	const s = new Structure(fixture());
	assert.equal(s.resolve("  wallbox ").uuid, U("11111111"));
});

test("resolve of an ambiguous name throws with candidates incl. room", () => {
	const s = new Structure(fixture());
	assert.throws(() => s.resolve("Licht"), (e) => {
		assert.ok(e instanceof AmbiguousNameError);
		assert.equal(e.candidates.length, 2);
		assert.deepEqual(e.candidates.map((c) => c.room).sort(), ["Technik", "Wohnzimmer"]);
		return true;
	});
});

test("resolve of a room-qualified name disambiguates", () => {
	const s = new Structure(fixture());
	assert.equal(s.resolve("Wohnzimmer/Licht").uuid, U("22222222"));
	assert.equal(s.resolve("Technik: Licht").uuid, U("33333333"));
});

test("resolve of a missing name/uuid throws NotFoundError", () => {
	const s = new Structure(fixture());
	assert.throws(() => s.resolve("Nope"), NotFoundError);
	assert.throws(() => s.resolve(U("99999999")), NotFoundError);
});

test("controlsInRoom returns top-level controls by room name or uuid", () => {
	const s = new Structure(fixture());
	assert.deepEqual(s.controlsInRoom("Technik").map((c) => c.name).sort(), ["Licht", "Wallbox"]);
	assert.equal(s.controlsInRoom(U("00aa0001")).length, 1); // Wohnzimmer, by UUID key
});

test("excludes empty-type controls ('not visualized') from name resolution and room listings", () => {
	const s = new Structure(fixture());
	assert.throws(() => s.resolve("Geheim"), NotFoundError);
	assert.equal(s.controlsInRoom("Versteckt").length, 0);
});

test("statesForUuid maps a state UUID back to its control + state name", () => {
	const s = new Structure(fixture());
	assert.deepEqual(s.statesForUuid(U("aaaa1111")), [{ controlUuid: U("11111111"), stateName: "power" }]);
});

test("namedStates resolves a control's states from a value map (missing -> null)", () => {
	const s = new Structure(fixture());
	const values = new Map([[U("aaaa1111"), 11]]);
	assert.deepEqual(s.namedStates(U("11111111"), values), { power: 11, sessionEnergy: null });
});

test("referencedControlUuids walks EFM node ctrlUuids recursively plus subcontrol uuids", () => {
	const EFM = U("0efm0000");
	const GRID = U("0e1d0001");
	const PV = U("0e1d0002");
	const SUB = U("0e1d0003");
	const LEAF = U("0e1d0004");
	const SC = U("0e5c0001");
	const s = new Structure({
		rooms: {}, cats: {},
		controls: {
			[EFM]: {
				uuidAction: EFM, name: "Energieflussmonitor", type: "EFM", states: {},
				details: { nodes: [
					{ ctrlUuid: GRID, nodeType: "Grid" },
					{ ctrlUuid: PV, nodeType: "Production", nodes: [
						{ ctrlUuid: SUB, nodeType: "Load", nodes: [{ ctrlUuid: LEAF, nodeType: "Load" }, { title: "Rest" }] }
					] }
				] },
				subControls: { [SC]: { uuidAction: SC, name: "Rest", type: "Meter", states: {} } }
			}
		},
		globalStates: {}
	});
	assert.deepEqual([...s.referencedControlUuids(EFM)].sort(), [GRID, PV, SUB, LEAF, SC].sort());
});

test("referencedControlUuids is empty for a plain control without nodes/subControls", () => {
	const s = new Structure(fixture());
	assert.equal(s.referencedControlUuids(U("22222222")).size, 0);
	assert.equal(s.referencedControlUuids(U("99999999")).size, 0);
});
