"use strict";
(function () {
	const VM = typeof require === "function" ? require("./viewmodels") : self.LoxRender;
	const { formatLox } = VM;

	// ---- registry ----
	function createRegistry() {
		const map = new Map();
		return {
			register(type, renderer) {
				(Array.isArray(type) ? type : [type]).forEach((t) => map.set(t, renderer));
				return this;
			},
			has(type) { return map.has(type); },
			resolve(type) { return map.get(type) || null; },
			types() { return [...map.keys()]; }
		};
	}

	// ---- DOM helpers (browser only; not called during registration) ----
	const BUILTIN = { Wallbox2: "🚗", EFM: "⚡", EnergyManager2: "⚡", Meter: "🔌", IRoomControllerV2: "🌡", PowerUnit: "🔋" };

	function el(tag, cls, text) {
		const e = document.createElement(tag);
		if (cls) { e.className = cls; }
		if (text !== null && text !== undefined) { e.textContent = text; }
		return e;
	}

	function makeIcon(iconSvg, type) {
		const span = el("span", "lox-icon");
		if (iconSvg) { span.innerHTML = iconSvg; } else { span.textContent = BUILTIN[type] || ""; }
		return span;
	}

	function makeTile(meta, ctx) {
		const tile = el("div", "lox-tile lox-type-" + String(meta.type || "").toLowerCase());
		const head = el("div", "lox-tile-head");
		const icon = makeIcon(meta.iconSvg, meta.type);
		if (icon.textContent || icon.innerHTML) { head.appendChild(icon); }
		head.appendChild(el("span", "lox-title", meta.name || ""));
		if (ctx && ctx.showRoom && meta.room) { head.appendChild(el("span", "lox-room", meta.room)); }
		tile.appendChild(head);
		const body = el("div", "lox-tile-body");
		tile.appendChild(body);
		tile._body = body;
		return tile;
	}

	// ---- energy-flow radial SVG (browser only) ----
	const NS = "http://www.w3.org/2000/svg";
	const COL = { production: "var(--lox-production)", import: "var(--lox-import)", export: "var(--lox-export)", storage: "var(--lox-storage)", fg: "var(--lox-fg)" };

	function svg(name, attrs) {
		const e = document.createElementNS(NS, name);
		Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
		return e;
	}
	// viewBox tightly bounds the content vertically (top glyph ~y10 … bottom value
	// ~y122) so there is no empty band scaling into a gap below the tile; the extra
	// horizontal room (x -20…280, content centred on 130) keeps wide outer labels
	// like "12.345kW 100%" from clipping at the edge.
	const EFM_VIEWBOX = "-20 0 300 130";
	function efmMarker(id, color) {
		const m = svg("marker", { id, markerWidth: 7, markerHeight: 7, refX: 4, refY: 3.5, orient: "auto" });
		m.appendChild(svg("path", { d: "M0,0 L7,3.5 L0,7 Z", fill: color }));
		return m;
	}
	function efmFlowLine(markerId) {
		// Static skeleton; the dash animation lives in CSS (.lox-efm-line) so it
		// keeps running across in-place updates instead of restarting each batch.
		return svg("line", { stroke: COL.fg, "stroke-width": 2.5, "stroke-dasharray": "3 6", "stroke-linecap": "round", "marker-end": `url(#${markerId})`, class: "lox-efm-line" });
	}
	function efmNodeEl(x, y, glyph, color) {
		const g = svg("g", { transform: `translate(${x},${y})`, "text-anchor": "middle" });
		const a = svg("text", { y: 0, "font-size": 18 });
		a.textContent = glyph;
		const value = svg("text", { y: 18, "font-size": 12, fill: color });
		g.appendChild(a);
		g.appendChild(value);
		return { g, value };
	}
	function setEfmFlow(line, active, x1, y1, x2, y2, color, markerId) {
		line.setAttribute("x1", x1);
		line.setAttribute("y1", y1);
		line.setAttribute("x2", x2);
		line.setAttribute("y2", y2);
		line.setAttribute("stroke", color);
		line.setAttribute("marker-end", `url(#${markerId})`);
		// toggling a class (vs replacing the node) keeps a still-active flow's CSS
		// animation uninterrupted — only a genuine active<->idle flip restarts it.
		line.classList.toggle("is-idle", !active);
	}
	// Build the SVG skeleton once; the returned refs are patched on every update.
	function buildEnergyFlow() {
		const root = svg("svg", { viewBox: EFM_VIEWBOX, class: "lox-efm", width: "100%" });
		const defs = svg("defs", {});
		[["efm-prod", COL.production], ["efm-imp", COL.import], ["efm-exp", COL.export], ["efm-sto", COL.storage]].forEach(([id, c]) => defs.appendChild(efmMarker(id, c)));
		root.appendChild(defs);
		const prod = efmFlowLine("efm-prod");
		const grid = efmFlowLine("efm-imp");
		const sto = efmFlowLine("efm-sto");
		root.appendChild(prod);
		root.appendChild(grid);
		root.appendChild(sto);
		const prodN = efmNodeEl(130, 26, "☀️", COL.production);
		const gridN = efmNodeEl(28, 100, "⚡", COL.import);
		const stoN = efmNodeEl(232, 100, "🔋", COL.storage);
		const homeN = efmNodeEl(130, 100, "🏠", COL.fg);
		[prodN, gridN, stoN, homeN].forEach((n) => root.appendChild(n.g));
		return { root, refs: { prod, grid, sto, prodVal: prodN.value, gridVal: gridN.value, stoVal: stoN.value, homeVal: homeN.value } };
	}
	// Patch only the dynamic parts in place — no DOM rebuild, so the flow stays smooth.
	function applyEnergyFlow(refs, vm, fmt) {
		setEfmFlow(refs.prod, vm.producing, 130, 48, 130, 84, COL.production, "efm-prod");
		if (vm.gridExporting) {
			setEfmFlow(refs.grid, true, 102, 105, 58, 105, COL.export, "efm-exp");
		} else {
			setEfmFlow(refs.grid, vm.gridImporting, 58, 105, 102, 105, COL.import, "efm-imp");
		}
		if (vm.storageCharging) {
			setEfmFlow(refs.sto, true, 158, 105, 202, 105, COL.storage, "efm-sto");
		} else {
			setEfmFlow(refs.sto, vm.storageDischarging, 202, 105, 158, 105, COL.storage, "efm-sto");
		}
		refs.prodVal.textContent = fmt(vm.production);
		refs.gridVal.textContent = fmt(Math.abs(vm.grid));
		refs.gridVal.setAttribute("fill", vm.gridExporting ? COL.export : COL.import);
		refs.stoVal.textContent = fmt(Math.abs(vm.storage)) + (vm.soc !== null ? ` ${Math.round(vm.soc)}%` : "");
		refs.homeVal.textContent = fmt(vm.consumption);
	}

	// ---- renderer factory + body builders ----
	function makeRenderer(toVM, buildBody) {
		const apply = (tile, meta, states, ctx) => {
			tile._body.replaceChildren(buildBody(toVM(states, meta.details || {}), ctx, meta));
		};
		return {
			toVM,
			render(meta, states, ctx) {
				const tile = makeTile(meta, ctx);
				apply(tile, meta, states, ctx);
				return tile;
			},
			update(tile, meta, states, ctx) { apply(tile, meta, states, ctx); }
		};
	}

	const tr = (ctx, key, fallback) => (ctx && ctx.translate ? ctx.translate(key) : fallback);
	const bar = (pct) => {
		const b = el("div", "lox-bar");
		const f = el("div", "lox-bar-fill");
		f.style.width = pct + "%";
		b.appendChild(f);
		return b;
	};

	const analogBody = (vm) => el("div", "lox-value", vm.value);
	const textBody = (vm) => el("div", "lox-value", vm.text);
	const textStateBody = (vm) => {
		const e = el("div", "lox-value", vm.text);
		if (vm.color) { e.style.color = vm.color; }
		return e;
	};
	const digitalBody = (vm) => {
		const e = el("div", "lox-value lox-state", vm.text);
		if (vm.color) { e.style.color = vm.color; }
		return e;
	};
	const switchBody = (vm, ctx) => {
		const e = el("div", "lox-value lox-state", tr(ctx, vm.on ? "ON" : "OFF", vm.on ? "On" : "Off"));
		e.classList.toggle("is-on", vm.on);
		return e;
	};
	const sliderBody = (vm) => {
		const w = el("div", "lox-slider");
		w.appendChild(el("div", "lox-value", vm.value));
		w.appendChild(bar(vm.pct));
		return w;
	};
	const roomBody = (vm) => {
		const w = el("div", "lox-room-temp");
		w.appendChild(el("span", "lox-value", vm.current));
		w.appendChild(el("span", "lox-target", "→ " + vm.target));
		return w;
	};
	const meterBody = (vm) => {
		const w = el("div", "lox-meter");
		w.appendChild(el("div", "lox-value", vm.power));
		w.appendChild(el("div", "lox-sub", vm.energy));
		if (vm.isStorage && vm.storagePct !== null) { w.appendChild(bar(vm.storagePct)); }
		return w;
	};
	const wallboxBody = (vm, ctx) => {
		const w = el("div", "lox-wallbox");
		const head = el("div", "lox-wb-head");
		head.appendChild(el("span", "lox-value", vm.power));
		const badge = el("span", "lox-badge", tr(ctx, "WB_" + vm.status.toUpperCase(), vm.status));
		badge.classList.toggle("is-charging", vm.charging);
		head.appendChild(badge);
		w.appendChild(head);
		w.appendChild(bar(vm.pct));
		if (vm.sessionEnergy !== null) { w.appendChild(el("div", "lox-sub", formatLox("%.1f kWh", vm.sessionEnergy))); }
		return w;
	};
	const efmFmt = (meta) => (kw) => formatLox((meta.details && meta.details.actualFormat) || "%.1f kW", kw);
	// Bespoke renderer (not makeRenderer): builds the SVG once and patches it in
	// place so the flow animation never restarts on a state update.
	const efmRenderer = {
		toVM: (st) => VM.energyFlowVM(st),
		render(meta, states, ctx) {
			const tile = makeTile(meta, ctx);
			const built = buildEnergyFlow();
			tile._efm = { refs: built.refs, fmt: efmFmt(meta) };
			applyEnergyFlow(built.refs, this.toVM(states), tile._efm.fmt);
			tile._body.replaceChildren(built.root);
			return tile;
		},
		update(tile, meta, states) {
			if (tile._efm) {
				applyEnergyFlow(tile._efm.refs, this.toVM(states), tile._efm.fmt);
			}
		}
	};

	const lvl = (level, text) => el("div", "lox-value lox-level-" + level, text);
	const windowBody = (vm, ctx) => lvl(vm.level,
		vm.open + " " + tr(ctx, "WIN_OPEN", "open") + " · " + vm.tilted + " " + tr(ctx, "WIN_TILTED", "tilted") + " · " + vm.closed + " " + tr(ctx, "WIN_CLOSED", "closed"));
	const gateBody = (vm, ctx) => {
		const w = el("div", "lox-gate");
		w.appendChild(lvl(vm.open ? "alert" : "ok", tr(ctx, vm.open ? "GATE_OPEN" : "GATE_CLOSED", vm.open ? "Open" : "Closed")));
		if (vm.pct > 0 && vm.pct < 100) { w.appendChild(bar(vm.pct)); }
		return w;
	};
	const presenceBody = (vm, ctx) => lvl(vm.active ? "warn" : "ok", tr(ctx, vm.active ? "PRESENCE_ACTIVE" : "PRESENCE_IDLE", vm.active ? "Motion" : "Clear"));
	const aalBody = (vm, ctx) => lvl(vm.alarm ? "alert" : "ok", tr(ctx, vm.alarm ? "EMERGENCY_ALARM" : "EMERGENCY_OK", vm.alarm ? "ALARM" : "OK"));
	const jalousieBody = (vm, ctx) => {
		const w = el("div", "lox-jalousie");
		const head = el("div", "lox-value", vm.pct + " %");
		if (vm.auto) { head.appendChild(el("span", "lox-badge", tr(ctx, "AUTO", "Auto"))); }
		w.appendChild(head);
		w.appendChild(bar(vm.pct));
		return w;
	};
	const lightBody = (vm) => el("div", "lox-value lox-state", vm.moods || "—");
	const centralJalousieBody = (vm, ctx) => lvl(vm.safety ? "warn" : "ok", vm.safety ? tr(ctx, "SHADE_SAFETY", "Safety") : "—");
	const pvForecastBody = (vm, ctx) => {
		const w = el("div", "lox-forecast");
		w.appendChild(el("div", "lox-value", vm.today));
		w.appendChild(el("div", "lox-sub", tr(ctx, "FORECAST_TODAY", "today") + " · " + vm.tomorrow + " " + tr(ctx, "FORECAST_TOMORROW", "tomorrow")));
		return w;
	};
	const spotPriceBody = (vm) => lvl(vm.level, vm.price);
	const alarmBody = (vm, ctx) => {
		if (vm.ringing) {
			return lvl("alert", tr(ctx, "ALARM_RINGING", "Ringing"));
		}
		return el("div", "lox-value" + (vm.enabled ? "" : " lox-muted"), vm.nextTime || "—");
	};
	const ventBody = (vm, ctx) => {
		const w = el("div", "lox-vent");
		w.appendChild(el("div", "lox-value", tr(ctx, "VENT_LEVEL", "Level") + " " + vm.speed));
		if (vm.humidity !== null) { w.appendChild(el("div", "lox-sub", vm.humidity + " % rH")); }
		return w;
	};
	const saunaBody = (vm, ctx) => {
		const w = el("div", "lox-sauna");
		const head = el("div", "lox-value", vm.temp);
		head.appendChild(el("span", "lox-badge", vm.ready ? tr(ctx, "SAUNA_READY", "Ready") : vm.active ? tr(ctx, "SAUNA_HEATING", "Heating") : tr(ctx, "OFF", "Off")));
		w.appendChild(head);
		return w;
	};
	const intercomBody = (vm, ctx) => el("div", "lox-value" + (vm.ringing ? " lox-level-warn" : ""),
		vm.ringing ? tr(ctx, "INTERCOM_RINGING", "Ringing") : (vm.lastTime ? tr(ctx, "INTERCOM_LAST", "last") + " " + vm.lastTime : "—"));
	const statusMonBody = (vm, ctx) => lvl(vm.alert ? "alert" : "ok", vm.alert ? vm.defective + " " + tr(ctx, "STATUS_FAULT", "fault") : tr(ctx, "STATUS_OK", "OK"));

	function buildRegistry() {
		const reg = createRegistry();
		reg.register("InfoOnlyAnalog", makeRenderer((st, d) => VM.infoAnalogVM(st, d), analogBody));
		reg.register("InfoOnlyText", makeRenderer((st) => VM.infoTextVM(st), textBody));
		reg.register("InfoOnlyDigital", makeRenderer((st, d) => VM.infoDigitalVM(st, d), digitalBody));
		reg.register("TextState", makeRenderer((st) => VM.textStateVM(st), textStateBody));
		reg.register(["Switch", "Pushbutton"], makeRenderer((st) => VM.switchVM(st), switchBody));
		reg.register("Slider", makeRenderer((st, d) => VM.sliderVM(st, d), sliderBody));
		reg.register("Meter", makeRenderer((st, d) => VM.meterVM(st, d), meterBody));
		reg.register("IRoomControllerV2", makeRenderer((st, d) => VM.roomControllerVM(st, d), roomBody));
		reg.register("Wallbox2", makeRenderer((st, d) => VM.wallboxVM(st, d), wallboxBody));
		reg.register(["EFM", "EnergyManager2"], efmRenderer);
		reg.register("WindowMonitor", makeRenderer((st) => VM.windowMonitorVM(st), windowBody));
		reg.register("Gate", makeRenderer((st) => VM.gateVM(st), gateBody));
		reg.register("PresenceDetector", makeRenderer((st) => VM.presenceVM(st), presenceBody));
		reg.register("AalEmergency", makeRenderer((st) => VM.aalEmergencyVM(st), aalBody));
		reg.register("Jalousie", makeRenderer((st) => VM.jalousieVM(st), jalousieBody));
		reg.register("CentralJalousie", makeRenderer((st) => VM.centralJalousieVM(st), centralJalousieBody));
		reg.register("LightControllerV2", makeRenderer((st) => VM.lightControllerVM(st), lightBody));
		reg.register("PvProductionForecast", makeRenderer((st) => VM.pvForecastVM(st), pvForecastBody));
		reg.register("SpotPriceOptimizer", makeRenderer((st, d) => VM.spotPriceVM(st, d), spotPriceBody));
		reg.register("AlarmClock", makeRenderer((st) => VM.alarmClockVM(st), alarmBody));
		reg.register("Heatmixer", makeRenderer((st, d) => VM.heatmixerVM(st, d), roomBody));
		reg.register("SteakThermo", makeRenderer((st, d) => VM.steakThermoVM(st, d), roomBody));
		reg.register("Ventilation", makeRenderer((st) => VM.ventilationVM(st), ventBody));
		reg.register("Sauna", makeRenderer((st, d) => VM.saunaVM(st, d), saunaBody));
		reg.register("Intercom", makeRenderer((st) => VM.intercomVM(st), intercomBody));
		reg.register("StatusMonitor", makeRenderer((st) => VM.statusMonitorVM(st), statusMonBody));
		return reg;
	}

	function genericFallbackRenderer() {
		return makeRenderer(
			(st) => {
				const key = Object.keys(st || {}).find((k) => k !== "jLocked" && (typeof st[k] === "number" || typeof st[k] === "string"));
				return { value: key ? String(st[key]) : "" };
			},
			(vm) => el("div", "lox-value", vm.value)
		);
	}

	const api = { buildRegistry, genericFallbackRenderer, createRegistry };
	if (typeof module === "object" && module.exports) {
		module.exports = api;
	} else {
		self.LoxRender = Object.assign(self.LoxRender || {}, api);
	}
}());
