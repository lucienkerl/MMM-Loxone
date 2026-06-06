"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("../renderers/viewmodels");

test("formatLox: precision, %%, integer, %s, fallbacks", () => {
	assert.equal(vm.formatLox("%.1f° C", 21.45), "21.5° C");
	assert.equal(vm.formatLox("%.3fkW", 6.2), "6.200kW");
	assert.equal(vm.formatLox("%.0f%%", 80), "80%");
	assert.equal(vm.formatLox("%d", 3.7), "4");
	assert.equal(vm.formatLox("%s", "hi"), "hi");
	assert.equal(vm.formatLox("", 12.3), "12.3");
	assert.equal(vm.formatLox("%.1f kW", null), "—");
	assert.equal(vm.formatLox("%.1f kW", NaN), "—");
});

test("infoAnalogVM / infoDigitalVM / infoTextVM", () => {
	assert.deepEqual(vm.infoAnalogVM({ value: 21.45 }, { format: "%.1f° C" }), { value: "21.5° C" });
	const dd = { text: { on: "Ein", off: "Aus" }, color: { on: "#8DFF70", off: "#FF0054" } };
	assert.deepEqual(vm.infoDigitalVM({ active: 1 }, dd), { on: true, text: "Ein", color: "#8DFF70" });
	assert.deepEqual(vm.infoDigitalVM({ active: 0 }, dd), { on: false, text: "Aus", color: "#FF0054" });
	assert.deepEqual(vm.infoTextVM({ text: "hello" }), { text: "hello" });
	assert.deepEqual(vm.infoTextVM({ text: null }), { text: "" });
});

test("textStateVM parses iconAndColor JSON safely", () => {
	assert.deepEqual(vm.textStateVM({ textAndIcon: "972 ppm", iconAndColor: "{\"icon\":\"Icons/co2.svg\",\"color\":\"#45864A\"}" }),
		{ text: "972 ppm", icon: "Icons/co2.svg", color: "#45864A" });
	assert.deepEqual(vm.textStateVM({ textAndIcon: "y", iconAndColor: "nope" }), { text: "y", icon: null, color: null });
});

test("switchVM / sliderVM", () => {
	assert.deepEqual(vm.switchVM({ active: 1 }), { on: true });
	const s = vm.sliderVM({ value: 45 }, { format: "%.0f Minuten", min: 0, max: 180 });
	assert.equal(s.value, "45 Minuten");
	assert.equal(s.pct, 25);
	assert.equal(vm.sliderVM({ value: 999 }, { min: 0, max: 180 }).pct, 100);
});

test("meterVM: uni / storage / bidirectional", () => {
	const UNI = { type: "unidirectional", actualFormat: "%.3fkW", totalFormat: "%.1fkWh", powerName: "Leistung" };
	const r = vm.meterVM({ actual: 1.234, total: 56.7 }, UNI);
	assert.equal(r.power, "1.234kW");
	assert.equal(r.energy, "56.7kWh");
	assert.equal(r.flow, "in");
	const sto = vm.meterVM({ actual: -2, storage: 83 }, { type: "storage", actualFormat: "%.3fkW", storageFormat: "%.0f%%" });
	assert.equal(sto.isStorage, true);
	assert.equal(sto.storagePct, 83);
	assert.equal(sto.flow, "out");
	const bi = vm.meterVM({ actual: 1, total: 100, totalNeg: 40 }, { type: "bidirectional", totalFormat: "%.1fkWh", actualFormat: "%.3fkW" });
	assert.equal(bi.exported, "40.0kWh");
});

test("roomControllerVM formats current + target", () => {
	const r = vm.roomControllerVM({ tempActual: 21.4, tempTarget: 22 }, { format: "%.1f°" });
	assert.equal(r.current, "21.4°");
	assert.equal(r.target, "22.0°");
});

test("wallboxVM: status, session energy, percent of max, malformed session", () => {
	const D = { actualFormat: "%.3fkW", totalFormat: "%.1fkWh", max: 11 };
	const r = vm.wallboxVM({ actual: 7.7, total: 1234.5, connected: 1, active: 1, limit: 11, session: "{\"power\":7.7,\"energy\":18.4}" }, D);
	assert.equal(r.status, "charging");
	assert.equal(r.power, "7.700kW");
	assert.equal(r.sessionEnergy, 18.4);
	assert.equal(r.pct, 70);
	assert.equal(vm.wallboxVM({ connected: 1, active: 0 }, D).status, "connected");
	assert.equal(vm.wallboxVM({ connected: 0 }, D).status, "idle");
	assert.equal(vm.wallboxVM({ session: "bad" }, D).sessionEnergy, null);
});

test("energyFlowVM: consumption + flags + soc", () => {
	const r = vm.energyFlowVM({ Ppwr: 6.2, Gpwr: -1.1, Spwr: -2.0 });
	assert.equal(Math.round(r.consumption * 10) / 10, 3.1);
	assert.equal(r.producing, true);
	assert.equal(r.gridExporting, true);
	assert.equal(r.storageCharging, true);
	const i = vm.energyFlowVM({ Ppwr: 0, Gpwr: 1.5, Spwr: 0.5, Ssoc: 76 });
	assert.equal(i.gridImporting, true);
	assert.equal(i.storageDischarging, true);
	assert.equal(i.soc, 76);
	assert.equal(vm.energyFlowVM({ Ppwr: 0, Gpwr: 0, Spwr: 0 }).soc, null);
});
