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
	function efmMarker(id, color) {
		const m = svg("marker", { id, markerWidth: 7, markerHeight: 7, refX: 4, refY: 3.5, orient: "auto" });
		m.appendChild(svg("path", { d: "M0,0 L7,3.5 L0,7 Z", fill: color }));
		return m;
	}
	function efmFlow(x1, y1, x2, y2, color, active, markerId) {
		const line = svg("line", { x1, y1, x2, y2, stroke: color, "stroke-width": 2.5, "stroke-dasharray": "3 6", "stroke-linecap": "round", "marker-end": `url(#${markerId})` });
		if (active) {
			line.appendChild(svg("animate", { attributeName: "stroke-dashoffset", from: 18, to: 0, dur: "0.9s", repeatCount: "indefinite" }));
		} else {
			line.setAttribute("opacity", "0.18");
		}
		return line;
	}
	function efmNode(x, y, glyph, color, valueText) {
		const g = svg("g", { transform: `translate(${x},${y})`, "text-anchor": "middle" });
		const a = svg("text", { y: 0, "font-size": 18 });
		a.textContent = glyph;
		const b = svg("text", { y: 18, "font-size": 12, fill: color });
		b.textContent = valueText;
		g.appendChild(a);
		g.appendChild(b);
		return g;
	}
	function energyFlowSvg(vm, fmt) {
		const root = svg("svg", { viewBox: "0 0 260 210", class: "lox-efm", width: "100%" });
		const defs = svg("defs", {});
		[["efm-prod", COL.production], ["efm-imp", COL.import], ["efm-exp", COL.export], ["efm-sto", COL.storage]].forEach(([id, c]) => defs.appendChild(efmMarker(id, c)));
		root.appendChild(defs);
		root.appendChild(efmFlow(130, 48, 130, 84, COL.production, vm.producing, "efm-prod"));
		if (vm.gridExporting) {
			root.appendChild(efmFlow(102, 105, 58, 105, COL.export, true, "efm-exp"));
		} else {
			root.appendChild(efmFlow(58, 105, 102, 105, COL.import, vm.gridImporting, "efm-imp"));
		}
		if (vm.storageCharging) {
			root.appendChild(efmFlow(158, 105, 202, 105, COL.storage, true, "efm-sto"));
		} else {
			root.appendChild(efmFlow(202, 105, 158, 105, COL.storage, vm.storageDischarging, "efm-sto"));
		}
		root.appendChild(efmNode(130, 26, "☀️", COL.production, fmt(vm.production)));
		root.appendChild(efmNode(28, 100, "⚡", vm.gridExporting ? COL.export : COL.import, fmt(Math.abs(vm.grid))));
		root.appendChild(efmNode(232, 100, "🔋", COL.storage, fmt(Math.abs(vm.storage)) + (vm.soc !== null ? ` ${Math.round(vm.soc)}%` : "")));
		root.appendChild(efmNode(130, 100, "🏠", COL.fg, fmt(vm.consumption)));
		return root;
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
	const efmBody = (vm, ctx, meta) => energyFlowSvg(vm, (kw) => formatLox((meta.details && meta.details.actualFormat) || "%.1f kW", kw));

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
		reg.register(["EFM", "EnergyManager2"], makeRenderer((st) => VM.energyFlowVM(st), efmBody));
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
