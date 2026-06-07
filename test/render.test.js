"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRegistry } = require("../renderers/render");

test("buildRegistry registers all v1 control types without needing a DOM", () => {
	const reg = buildRegistry();
	["EFM", "EnergyManager2", "Wallbox2", "Meter", "IRoomControllerV2",
		"InfoOnlyAnalog", "InfoOnlyDigital", "InfoOnlyText", "TextState", "Switch", "Pushbutton", "Slider",
		"WindowMonitor", "Gate", "PresenceDetector", "AalEmergency", "Jalousie", "CentralJalousie",
		"LightControllerV2", "PvProductionForecast", "SpotPriceOptimizer", "AlarmClock", "Heatmixer",
		"SteakThermo", "Ventilation", "Sauna", "Intercom", "StatusMonitor", "AudioZoneV2"]
		.forEach((t) => assert.equal(reg.has(t), true, `missing ${t}`));
});

test("resolve returns a renderer with render/update/toVM; unknown -> null", () => {
	const reg = buildRegistry();
	const r = reg.resolve("Meter");
	assert.equal(typeof r.render, "function");
	assert.equal(typeof r.update, "function");
	assert.equal(typeof r.toVM, "function");
	assert.equal(reg.resolve("FooBarUnknown"), null);
});
