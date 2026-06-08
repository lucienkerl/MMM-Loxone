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

	function windowMonitorVM(states) {
		const open = num(states.numOpen);
		const tilted = num(states.numTilted);
		const closed = num(states.numClosed);
		const offline = num(states.numOffline);
		return { open, tilted, closed, offline, level: open > 0 ? "alert" : (tilted > 0 || offline > 0) ? "warn" : "ok" };
	}

	function gateVM(states) {
		const pos = num(states.position);
		return { pct: Math.round(pos * 100), open: pos > 0.01, moving: !!states.active };
	}

	function presenceVM(states) {
		return { active: !!states.active };
	}

	function aalEmergencyVM(states) {
		return { alarm: num(states.status) > 0 };
	}

	function jalousieVM(states) {
		const pos = num(states.position);
		return { pct: Math.round(pos * 100), moving: !!states.up || !!states.down, auto: !!states.autoActive };
	}

	function lightControllerVM(states) {
		let moods = [];
		try {
			const active = JSON.parse(states.activeMoods || "[]");
			const list = JSON.parse(states.moodList || "[]");
			const byId = {};
			list.forEach((m) => { byId[m.id] = m.name; });
			moods = active.map((id) => byId[id] || ("#" + id));
		} catch (e) {
			moods = [];
		}
		return { moods: moods.join(" + ") };
	}

	function centralJalousieVM(states) {
		return { safety: !!states.safetyActive };
	}

	function pvForecastVM(states) {
		return { today: formatLox("%.1f kWh", states.today), tomorrow: formatLox("%.1f kWh", states.tomorrow) };
	}

	function spotPriceVM(states, details) {
		const d = details || {};
		const cur = Number(states.current);
		let level = "mid";
		if (Number.isFinite(cur)) {
			if (states.veryHigh !== undefined && cur >= Number(states.veryHigh)) {
				level = "alert";
			} else if (states.high !== undefined && cur >= Number(states.high)) {
				level = "warn";
			} else if (states.low !== undefined && cur <= Number(states.low)) {
				level = "ok";
			}
		}
		return { price: formatLox(d.format || "%.3f €/kWh", states.current), level };
	}

	function loxTimeToHM(loxSec) {
		const n = Number(loxSec);
		if (!Number.isFinite(n) || n <= 0) {
			return null;
		}
		const loxEpoch = Date.UTC(2009, 0, 1) / 1000;
		const d = new Date((loxEpoch + n) * 1000);
		return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
	}

	function alarmClockVM(states) {
		return { enabled: !!states.isEnabled, ringing: !!states.isAlarmActive, nextTime: loxTimeToHM(states.nextEntryTime) };
	}

	function heatmixerVM(states, details) {
		const d = details || {};
		return { current: formatLox(d.format || "%.1f °C", states.tempActual), target: formatLox(d.format || "%.1f °C", states.tempTarget) };
	}

	function ventilationVM(states) {
		const hum = states.humidityIndoor;
		return { speed: num(states.speed), humidity: hum === null || hum === undefined ? null : Math.round(num(hum)) };
	}

	function saunaVM(states, details) {
		const d = details || {};
		return {
			temp: formatLox(d.format || "%.0f°", states.tempActual),
			target: formatLox(d.format || "%.0f°", states.tempTarget),
			active: !!states.active,
			ready: !!states.ready
		};
	}

	function steakThermoVM(states, details) {
		const d = details || {};
		return {
			current: formatLox(d.format || "%.1f°", states.temperatureGreen),
			target: formatLox(d.format || "%.1f°", states.targetGreen),
			active: !!states.isActive
		};
	}

	function intercomVM(states) {
		return { ringing: !!states.bell, lastTime: loxTimeToHM(states.lastBellTimestamp) };
	}

	function statusMonitorVM(states) {
		const defective = num(states.numDef);
		return { defective, alert: defective > 0 };
	}

	function mmss(sec) {
		const s = Math.max(0, Math.floor(num(sec)));
		const r = s % 60;
		return Math.floor(s / 60) + ":" + (r < 10 ? "0" + r : r);
	}

	// AudioZoneV2 (Music Server zone). Status/volume come from the Miniserver
	// (playState: -1 unknown/0 stopped/1 paused/2 playing; serverState >= 2 online).
	// Track text/cover/position are injected from the Audioserver as np* fields
	// (see node_helper / audioNowPlaying); for radio, station replaces artist/album
	// and there is no duration/progress.
	function audioVM(states) {
		const play = num(states.playState);
		const vol = num(states.volume);
		const maxVol = (states.maxVolume === null || states.maxVolume === undefined) ? 100 : num(states.maxVolume);
		const server = (states.serverState === null || states.serverState === undefined) ? null : num(states.serverState);
		const online = server === null ? true : server >= 2;
		const mode = states.npMode || "";
		const hasPlay = states.playState !== null && states.playState !== undefined;
		// The position must tick only while actually playing — stop as soon as EITHER
		// the player mode OR the Miniserver playState reports pause/stop (whichever
		// lands first, and even if the Audioserver link is momentarily down).
		const stopped = mode === "pause" || mode === "stop" || (hasPlay && (play === 0 || play === 1));
		const playing = online && !stopped && (mode === "play" || (hasPlay && play >= 2));
		let status;
		if (!online) {
			status = "offline";
		} else if (playing) {
			status = "playing";
		} else if (mode === "pause" || play === 1) {
			status = "paused";
		} else {
			status = "stopped";
		}
		const duration = num(states.npDuration);
		const time = num(states.npTime);
		const subParts = [states.npArtist, states.npAlbum].filter((x) => x);
		return {
			status,
			playing,
			offline: status === "offline",
			volume: vol,
			volumePct: maxVol > 0 ? Math.max(0, Math.min(100, Math.round((vol / maxVol) * 100))) : 0,
			title: states.npTitle || "",
			subline: subParts.length ? subParts.join(" · ") : (states.npStation || ""),
			cover: states.npCover || null,
			time,
			duration,
			hasProgress: duration > 0,
			progressPct: duration > 0 ? Math.max(0, Math.min(100, Math.round((time / duration) * 100))) : 0,
			timeText: duration > 0 ? mmss(time) + " / " + mmss(duration) : ""
		};
	}

	const api = {
		formatLox, clampPct, infoAnalogVM, infoDigitalVM, infoTextVM, textStateVM,
		switchVM, sliderVM, meterVM, roomControllerVM, wallboxVM, energyFlowVM,
		windowMonitorVM, gateVM, presenceVM, aalEmergencyVM, jalousieVM, lightControllerVM,
		centralJalousieVM, pvForecastVM, spotPriceVM, alarmClockVM, heatmixerVM, ventilationVM,
		saunaVM, steakThermoVM, intercomVM, statusMonitorVM, audioVM
	};

	if (typeof module === "object" && module.exports) {
		module.exports = api;
	} else {
		self.LoxRender = Object.assign(self.LoxRender || {}, api);
	}
}());
