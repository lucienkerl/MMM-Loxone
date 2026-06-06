"use strict";
(function () {
	const SPEC = /%[-+ 0]*\d*(?:\.(\d+))?([fdis])/;

	function formatLox(format, value) {
		if (format === null || format === undefined || format === "") {
			return value === null || value === undefined ? "" : String(value);
		}
		const numericMissing = value === null || value === undefined || value === "" || Number.isNaN(Number(value));
		const probe = format.match(SPEC);
		if (probe && (probe[2] === "f" || probe[2] === "d" || probe[2] === "i") && numericMissing) {
			return "—"; // numeric token with no value -> whole string is the dash
		}
		return format
			.replace(/%%/g, "\x01")
			.replace(SPEC, (m, precision, conv) => {
				if (conv === "s") {
					return value === null || value === undefined ? "" : String(value);
				}
				if (value === null || value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value))) {
					return "—";
				}
				const num = Number(value);
				if (Number.isNaN(num)) {
					return String(value);
				}
				if (conv === "d" || conv === "i") {
					return String(Math.round(num));
				}
				const p = precision === undefined ? 6 : parseInt(precision, 10);
				const factor = Math.pow(10, p);
				return (Math.round((num + Number.EPSILON * Math.abs(num)) * factor) / factor).toFixed(p);
			})
			.replace(/\x01/g, "%");
	}

	function clampPct(value, min, max) {
		const lo = Number(min) || 0;
		const hi = Number(max);
		if (!Number.isFinite(hi) || hi === lo) {
			return 0;
		}
		return Math.max(0, Math.min(100, Math.round(((Number(value) - lo) / (hi - lo)) * 100)));
	}

	function infoAnalogVM(states, details) {
		return { value: formatLox((details || {}).format, states.value) };
	}

	function infoDigitalVM(states, details) {
		const on = !!states.active;
		const d = details || {};
		return { on, text: d.text ? (on ? d.text.on : d.text.off) : "", color: d.color ? (on ? d.color.on : d.color.off) : null };
	}

	function infoTextVM(states) {
		return { text: states.text === null || states.text === undefined ? "" : String(states.text) };
	}

	function textStateVM(states) {
		let icon = null;
		let color = null;
		if (states.iconAndColor) {
			try {
				const p = JSON.parse(states.iconAndColor);
				icon = p.icon || null;
				color = p.color || null;
			} catch (e) {
				icon = null;
				color = null;
			}
		}
		return { text: states.textAndIcon === null || states.textAndIcon === undefined ? "" : String(states.textAndIcon), icon, color };
	}

	function switchVM(states) {
		return { on: !!states.active };
	}

	function sliderVM(states, details) {
		const d = details || {};
		return { value: formatLox(d.format, states.value), pct: clampPct(states.value, d.min, d.max) };
	}

	function meterVM(states, details) {
		const d = details || {};
		const isStorage = d.type === "storage";
		const isBidirectional = d.type === "bidirectional";
		const actual = Number(states.actual);
		return {
			power: formatLox(d.actualFormat, states.actual),
			energy: formatLox(d.totalFormat, states.total),
			powerName: d.powerName || "",
			flow: actual > 0 ? "in" : actual < 0 ? "out" : "idle",
			isStorage,
			isBidirectional,
			storagePct: isStorage && states.storage !== null && states.storage !== undefined ? Math.max(0, Math.min(100, Number(states.storage))) : null,
			storageText: isStorage ? formatLox(d.storageFormat, states.storage) : null,
			exported: isBidirectional ? formatLox(d.totalFormat, states.totalNeg) : null
		};
	}

	function roomControllerVM(states, details) {
		const d = details || {};
		return {
			current: formatLox(d.format, states.tempActual),
			target: formatLox(d.format, states.tempTarget),
			currentRaw: Number(states.tempActual),
			targetRaw: Number(states.tempTarget)
		};
	}

	function parseSession(raw) {
		if (!raw) {
			return {};
		}
		try {
			return JSON.parse(raw) || {};
		} catch (e) {
			return {};
		}
	}

	function wallboxVM(states, details) {
		const d = details || {};
		const session = parseSession(states.session);
		const actual = Number(states.actual);
		const max = Number(d.max);
		return {
			connected: !!states.connected,
			charging: !!states.active,
			enabled: !!states.enabled,
			power: formatLox(d.actualFormat, states.actual),
			powerRaw: Number.isFinite(actual) ? actual : 0,
			sessionEnergy: session.energy === null || session.energy === undefined ? null : Number(session.energy),
			totalEnergy: formatLox(d.totalFormat, states.total),
			limit: states.limit === null || states.limit === undefined ? null : Number(states.limit),
			max: Number.isFinite(max) ? max : null,
			pct: Number.isFinite(max) && max > 0 ? Math.max(0, Math.min(100, Math.round((actual / max) * 100))) : 0,
			status: states.active ? "charging" : states.connected ? "connected" : "idle"
		};
	}

	const EPS = 0.01;
	function num(v) {
		const x = Number(v);
		return Number.isFinite(x) ? x : 0;
	}

	function energyFlowVM(states) {
		const production = num(states.Ppwr);
		const grid = num(states.Gpwr);
		const storage = num(states.Spwr);
		const hasSoc = states.Ssoc !== null && states.Ssoc !== undefined;
		return {
			production,
			grid,
			storage,
			consumption: production + grid + storage,
			soc: hasSoc ? num(states.Ssoc) : null,
			selfConsumption: states.selfConsumption === null || states.selfConsumption === undefined ? null : num(states.selfConsumption),
			producing: production > EPS,
			gridImporting: grid > EPS,
			gridExporting: grid < -EPS,
			storageDischarging: storage > EPS,
			storageCharging: storage < -EPS
		};
	}

	const api = {
		formatLox, clampPct, infoAnalogVM, infoDigitalVM, infoTextVM, textStateVM,
		switchVM, sliderVM, meterVM, roomControllerVM, wallboxVM, energyFlowVM
	};

	if (typeof module === "object" && module.exports) {
		module.exports = api;
	} else {
		self.LoxRender = Object.assign(self.LoxRender || {}, api);
	}
}());
