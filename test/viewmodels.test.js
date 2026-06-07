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

test("windowMonitorVM levels: ok / warn / alert", () => {
	assert.equal(vm.windowMonitorVM({ numOpen: 0, numTilted: 0, numClosed: 5, numOffline: 0 }).level, "ok");
	assert.equal(vm.windowMonitorVM({ numTilted: 1, numClosed: 4 }).level, "warn");
	assert.deepEqual(vm.windowMonitorVM({ numOpen: 2, numTilted: 1, numClosed: 14, numOffline: 0 }),
		{ open: 2, tilted: 1, closed: 14, offline: 0, level: "alert" });
});

test("gateVM position + open + moving", () => {
	assert.deepEqual(vm.gateVM({ position: 0, active: 0 }), { pct: 0, open: false, moving: false });
	assert.deepEqual(vm.gateVM({ position: 0.5, active: 1 }), { pct: 50, open: true, moving: true });
	assert.equal(vm.gateVM({ position: 1 }).open, true);
});

test("presenceVM + aalEmergencyVM", () => {
	assert.deepEqual(vm.presenceVM({ active: 1 }), { active: true });
	assert.equal(vm.aalEmergencyVM({ status: 1 }).alarm, true);
	assert.equal(vm.aalEmergencyVM({ status: 0 }).alarm, false);
});

test("jalousieVM position / auto / moving", () => {
	const r = vm.jalousieVM({ position: 0.6, up: 0, down: 0, autoActive: 1 });
	assert.equal(r.pct, 60);
	assert.equal(r.auto, true);
	assert.equal(r.moving, false);
	assert.equal(vm.jalousieVM({ position: 0.2, down: 1 }).moving, true);
});

test("lightControllerVM maps active mood ids to names", () => {
	const list = "[{\"id\":778,\"name\":\"Aus\"},{\"id\":3,\"name\":\"Gemütlich\"}]";
	assert.equal(vm.lightControllerVM({ activeMoods: "[778]", moodList: list }).moods, "Aus");
	assert.equal(vm.lightControllerVM({ activeMoods: "[778,3]", moodList: list }).moods, "Aus + Gemütlich");
	assert.equal(vm.lightControllerVM({ activeMoods: "bad" }).moods, "");
});

test("centralJalousieVM safety", () => {
	assert.equal(vm.centralJalousieVM({ safetyActive: 1 }).safety, true);
	assert.equal(vm.centralJalousieVM({ safetyActive: 0 }).safety, false);
});

test("pvForecastVM formats today/tomorrow", () => {
	assert.deepEqual(vm.pvForecastVM({ today: 38.2, tomorrow: 41.7 }), { today: "38.2 kWh", tomorrow: "41.7 kWh" });
});

test("spotPriceVM level classification + price format", () => {
	const D = { format: "%.3f €/kWh" };
	const t = { veryHigh: 0.4, high: 0.3, low: 0.1 };
	assert.equal(vm.spotPriceVM(Object.assign({ current: 0.05 }, t), D).level, "ok");
	assert.equal(vm.spotPriceVM(Object.assign({ current: 0.32 }, t), D).level, "warn");
	assert.equal(vm.spotPriceVM(Object.assign({ current: 0.45 }, t), D).level, "alert");
	assert.equal(vm.spotPriceVM(Object.assign({ current: 0.2 }, t), D).level, "mid");
	assert.equal(vm.spotPriceVM({ current: 0.283 }, D).price, "0.283 €/kWh");
});

test("alarmClockVM flags + nextTime format", () => {
	assert.equal(vm.alarmClockVM({ isEnabled: 1 }).enabled, true);
	assert.equal(vm.alarmClockVM({ isAlarmActive: 1 }).ringing, true);
	assert.equal(vm.alarmClockVM({ nextEntryTime: 0 }).nextTime, null);
	assert.match(vm.alarmClockVM({ nextEntryTime: 500000000 }).nextTime, /^\d{2}:\d{2}$/);
});

test("heatmixerVM current/target", () => {
	assert.deepEqual(vm.heatmixerVM({ tempActual: 38.4, tempTarget: 40 }, { format: "%.1f °C" }),
		{ current: "38.4 °C", target: "40.0 °C" });
});

test("ventilationVM speed + humidity", () => {
	assert.deepEqual(vm.ventilationVM({ speed: 2, humidityIndoor: 44.6 }), { speed: 2, humidity: 45 });
	assert.equal(vm.ventilationVM({ speed: 1 }).humidity, null);
});

test("saunaVM temp + status flags", () => {
	const r = vm.saunaVM({ tempActual: 82, tempTarget: 90, active: 1, ready: 0 }, {});
	assert.equal(r.temp, "82°");
	assert.equal(r.target, "90°");
	assert.equal(r.active, true);
	assert.equal(r.ready, false);
});

test("steakThermoVM green probe", () => {
	const r = vm.steakThermoVM({ temperatureGreen: 56.3, targetGreen: 60, isActive: 1 }, { format: "%.1f°" });
	assert.equal(r.current, "56.3°");
	assert.equal(r.target, "60.0°");
	assert.equal(r.active, true);
});

test("intercomVM ringing + last time", () => {
	assert.equal(vm.intercomVM({ bell: 1 }).ringing, true);
	assert.equal(vm.intercomVM({ bell: 0, lastBellTimestamp: 0 }).lastTime, null);
	assert.match(vm.intercomVM({ lastBellTimestamp: 500000000 }).lastTime, /^\d{2}:\d{2}$/);
});

test("statusMonitorVM defective alert", () => {
	assert.deepEqual(vm.statusMonitorVM({ numDef: 0 }), { defective: 0, alert: false });
	assert.deepEqual(vm.statusMonitorVM({ numDef: 2 }), { defective: 2, alert: true });
});

test("audioVM play states map to status", () => {
	assert.equal(vm.audioVM({ playState: 2, volume: 30, serverState: 2 }).status, "playing");
	assert.equal(vm.audioVM({ playState: 1, volume: 30, serverState: 2 }).status, "paused");
	assert.equal(vm.audioVM({ playState: 0, volume: 30, serverState: 2 }).status, "stopped");
	assert.equal(vm.audioVM({ playState: -1, volume: 30, serverState: 2 }).status, "stopped");
});

test("audioVM offline serverState overrides play state", () => {
	const r = vm.audioVM({ playState: 2, volume: 30, serverState: 0 });
	assert.equal(r.status, "offline");
	assert.equal(r.offline, true);
	assert.equal(r.playing, false);
});

test("audioVM volume bar scales to maxVolume", () => {
	assert.equal(vm.audioVM({ playState: 2, volume: 40, maxVolume: 80, serverState: 2 }).volumePct, 50);
	assert.equal(vm.audioVM({ playState: 2, volume: 30 }).volumePct, 30); // no maxVolume -> /100
	assert.equal(vm.audioVM({ playState: 2, volume: 30 }).volume, 30);
});
