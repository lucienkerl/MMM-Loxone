# Loxone MagicMirror Module & Renderers Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MagicMirror layer on top of the `lib/loxone` library (Plan 1, complete): a thin `node_helper.js` bridge, the frontend `MMM-Loxone.js`, the Hybrid dark+semantic-color theme, and a renderer registry with generic renderers plus rich **Wallbox** and **Energy-Flow** (EFM / EnergyManager2) renderers — read-only.

**Architecture:** Each renderer has a **pure view-model** (`states + details → display object`, unit-tested) and a **DOM builder** (browser, verified by running the mirror). A registry maps `control.type → renderer`. `node_helper.js` wires `LoxoneClient` to MagicMirror via socket notifications (coalescing state, pre-fetching icons); `MMM-Loxone.js` mounts tiles and dispatches updates.

**Tech Stack:** Node 20+, `node:test`/`node:assert`, vanilla browser JS + CSS (no jQuery, no bundler). Builds on `lib/loxone`.

**Reference spec:** `docs/superpowers/specs/2026-06-06-mmm-loxone-rebuild-design.md` (§8 integration, §9 rendering, §10 config, §15 confirmed bindings).

**Apply TDD:** @superpowers:test-driven-development — failing test → see it fail → implement → see it pass → commit.

**CRITICAL — Node version:** the default shell `node` is v12. For EVERY node/npm/npx command, prepend `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && ` (gives v20.14.0). The full Plan 1 suite (64 tests) plus Plan 2's new tests must stay green.

## Browser-module convention (IMPORTANT)

The MagicMirror frontend loads scripts as plain `<script>` tags (via `getScripts()`) — there is **no `require` / bundler** in the browser. But the view-model + render logic must also be **unit-testable under `node:test`** (which needs `module.exports`). So the two frontend logic files are **dual-mode**, wrapped in a single IIFE that exports to `module.exports` under Node and to a `self.LoxRender` global in the browser:

```js
"use strict";
(function () {
	// ... all functions defined here (IIFE-scoped, so multiple <script>s don't collide) ...
	const api = { /* public functions */ };
	if (typeof module === "object" && module.exports) {
		module.exports = api;            // Node (tests)
	} else {
		self.LoxRender = Object.assign(self.LoxRender || {}, api); // browser global
	}
}());
```

Files: `renderers/viewmodels.js` (self-contained) and `renderers/render.js` (depends on viewmodels — reads it via `require("./viewmodels")` under Node, or `self.LoxRender` in the browser). `getScripts()` loads `viewmodels.js` **before** `render.js`. The node-side bridge files (`lib/bridge/*`) are ordinary CommonJS (Node only). DOM/SVG builders and `MMM-Loxone.js`/CSS are the visual deliverable — verified by running the mirror, not unit-tested (no jsdom dependency).

**Testing boundary:** the formatter, all view-models, and the registry are unit-tested. DOM/SVG construction, `MMM-Loxone.js`, and CSS are validated by running the mirror.

---

## Chunk 0: View-models (`renderers/viewmodels.js`)

The formatter + every pure view-model in one dual-mode file. Spec §9.2–9.4, §15.

### Task 0.1: `viewmodels.js` + tests

**Files:**
- Create: `renderers/viewmodels.js`
- Test: `test/viewmodels.test.js`

- [ ] **Step 1: Write the failing test** — `test/viewmodels.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --test test/viewmodels.test.js`
Expected: FAIL — cannot find module `viewmodels`.

- [ ] **Step 3: Implement** — `renderers/viewmodels.js`:

```js
"use strict";
(function () {
	const SPEC = /%[-+ 0]*\d*(?:\.(\d+))?([fdis])/;

	function formatLox(format, value) {
		if (format === null || format === undefined || format === "") {
			return value === null || value === undefined ? "" : String(value);
		}
		return format
			.replace(/%%/g, "\\u0001")
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
				return num.toFixed(precision === undefined ? 6 : parseInt(precision, 10));
			})
			.replace(/\\u0001/g, "%");
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
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --test test/viewmodels.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint + commit**

```bash
export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && npx eslint renderers/viewmodels.js
git add renderers/viewmodels.js test/viewmodels.test.js
git commit -m "feat(renderers): dual-mode view-models + formatter"
```

---

## Chunk 1: Render layer (`renderers/render.js`)

Dual-mode file: registry + icons + tile chrome + energy-flow radial SVG + `buildRegistry()` wiring view-models to DOM body builders. Only the registry is unit-tested (no DOM at registration time); DOM/SVG is visual. Spec §9.1, §9.5, §9.6.

### Task 1.1: `render.js` + registry coverage test

**Files:**
- Create: `renderers/render.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Write the failing test** — `test/render.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRegistry } = require("../renderers/render");

test("buildRegistry registers all v1 control types without needing a DOM", () => {
	const reg = buildRegistry();
	["EFM", "EnergyManager2", "Wallbox2", "Meter", "IRoomControllerV2",
		"InfoOnlyAnalog", "InfoOnlyDigital", "InfoOnlyText", "TextState", "Switch", "Pushbutton", "Slider"]
		.forEach((t) => assert.equal(reg.has(t), true, `missing ${t}`));
});

test("resolve returns a renderer with render/update/toVM; unknown -> null", () => {
	const reg = buildRegistry();
	const r = reg.resolve("Meter");
	assert.equal(typeof r.render, "function");
	assert.equal(typeof r.update, "function");
	assert.equal(typeof r.toVM, "function");
	assert.equal(reg.resolve("LightControllerV2"), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --test test/render.test.js`
Expected: FAIL — cannot find module `render`.

- [ ] **Step 3: Implement** — `renderers/render.js`:

```js
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
		reg.register("TextState", makeRenderer((st) => VM.textStateVM(st), textBody));
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
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --test test/render.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint + commit**

```bash
export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && npx eslint renderers/render.js
git add renderers/render.js test/render.test.js
git commit -m "feat(renderers): dual-mode render layer (registry, tiles, radial EFM SVG)"
```

---

## Chunk 2: node-side Bridge Helpers

Ordinary CommonJS (Node only). Pure + unit-tested. Spec §8.1.

### Task 2.1: `Coalescer`

**Files:**
- Create: `lib/bridge/Coalescer.js`
- Test: `test/coalescer.test.js`

- [ ] **Step 1: Write the failing test** — `test/coalescer.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Coalescer } = require("../lib/bridge/Coalescer");

function manualScheduler() {
	let fn = null;
	return { set: (f) => { fn = f; return 1; }, clear: () => { fn = null; }, fire: () => { const f = fn; fn = null; if (f) { f(); } }, pending: () => fn !== null };
}

test("coalesces pushes into one flush; latest state per id wins", () => {
	const sched = manualScheduler();
	const flushes = [];
	const c = new Coalescer(250, (b) => flushes.push(b), sched);
	c.push("a", { v: 1 });
	c.push("b", { v: 2 });
	c.push("a", { v: 3 });
	assert.equal(flushes.length, 0);
	sched.fire();
	assert.equal(flushes.length, 1);
	assert.deepEqual(flushes[0].sort((x, y) => (x.id < y.id ? -1 : 1)), [{ id: "a", states: { v: 3 } }, { id: "b", states: { v: 2 } }]);
});

test("empty flush is a no-op; a later push starts a new window", () => {
	const sched = manualScheduler();
	const flushes = [];
	const c = new Coalescer(250, (b) => flushes.push(b), sched);
	c.push("a", { v: 1 });
	sched.fire();
	c.push("a", { v: 2 });
	assert.equal(sched.pending(), true);
	sched.fire();
	assert.equal(flushes.length, 2);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --test test/coalescer.test.js`
Expected: FAIL — cannot find module `Coalescer`.

- [ ] **Step 3: Implement** — `lib/bridge/Coalescer.js`:

```js
"use strict";

class Coalescer {
	constructor(flushMs, onFlush, scheduler) {
		this.flushMs = flushMs;
		this.onFlush = onFlush;
		this.pending = new Map();
		this.timer = null;
		this._set = scheduler && scheduler.set ? scheduler.set : (fn) => setTimeout(fn, this.flushMs);
		this._clear = scheduler && scheduler.clear ? scheduler.clear : clearTimeout;
	}

	push(id, states) {
		this.pending.set(id, states);
		if (this.timer === null) {
			this.timer = this._set(() => this.flush(), this.flushMs);
		}
	}

	flush() {
		if (this.timer !== null) {
			this._clear(this.timer);
			this.timer = null;
		}
		if (this.pending.size === 0) {
			return;
		}
		const batch = [...this.pending.entries()].map(([id, states]) => ({ id, states }));
		this.pending.clear();
		this.onFlush(batch);
	}
}

module.exports = { Coalescer };
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --test test/coalescer.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/bridge/Coalescer.js test/coalescer.test.js
git commit -m "feat(bridge): state-update coalescer"
```

### Task 2.2: `toControlMeta` + `getOrCreateClientId`

**Files:**
- Create: `lib/bridge/controlMeta.js`
- Create: `lib/bridge/clientId.js`
- Test: `test/bridge-helpers.test.js`

- [ ] **Step 1: Write the failing test** — `test/bridge-helpers.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --test test/bridge-helpers.test.js`
Expected: FAIL — cannot find module `controlMeta`.

- [ ] **Step 3: Implement** — `lib/bridge/controlMeta.js`:

```js
"use strict";

function toControlMeta(control, structure) {
	const details = control.details || {};
	return {
		id: control.uuid,
		type: control.type,
		name: control.name,
		room: structure.roomName(control.room) || null,
		category: structure.catName(control.cat) || null,
		iconUuid: details.icon || null,
		details
	};
}

module.exports = { toControlMeta };
```

And `lib/bridge/clientId.js`:

```js
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function getOrCreateClientId(filePath) {
	try {
		const existing = fs.readFileSync(filePath, "utf8").trim();
		if (existing) {
			return existing;
		}
	} catch (e) {
		// not created yet
	}
	const id = crypto.randomUUID();
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, id);
	return id;
}

module.exports = { getOrCreateClientId };
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --test test/bridge-helpers.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/bridge/controlMeta.js lib/bridge/clientId.js test/bridge-helpers.test.js
git commit -m "feat(bridge): control-meta mapper + stable client id"
```

---

## Chunk 3: `node_helper.js`

MagicMirror glue wiring `LoxoneClient` to the frontend. Verified by `node --check` + running the mirror (the `node_helper` module is provided by a MagicMirror install). Spec §8.1.

### Task 3.1: Replace `node_helper.js`

**Files:**
- Overwrite: `node_helper.js`

- [ ] **Step 1: Replace `node_helper.js` entirely** with:

```js
"use strict";
const path = require("path");
const NodeHelper = require("node_helper");
const { LoxoneClient } = require("./lib/loxone");
const { TokenStore } = require("./lib/loxone/auth/TokenStore");
const { Coalescer } = require("./lib/bridge/Coalescer");
const { toControlMeta } = require("./lib/bridge/controlMeta");
const { getOrCreateClientId } = require("./lib/bridge/clientId");

module.exports = NodeHelper.create({
	start() {
		this.client = null;
		this.coalescer = null;
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "LOXONE_CONFIG") {
			this.startClient(payload);
		}
	},

	startClient(config) {
		if (this.client) {
			return;
		}
		const dir = path.resolve(__dirname);
		const clientUuid = getOrCreateClientId(path.join(dir, ".loxone-client-uuid"));

		this.coalescer = new Coalescer(config.updateThrottleMs || 250, (batch) => this.sendSocketNotification("LOXONE_STATE", batch));

		this.client = new LoxoneClient({
			host: config.host,
			user: config.user,
			password: config.password,
			permission: config.permission || "app",
			clientUuid,
			clientInfo: "MagicMirror",
			controls: config.controls || [],
			rooms: config.rooms || [],
			categories: config.categories || [],
			reconnectMaxBackoffMs: config.reconnectMaxBackoffMs || 60000,
			tokenStore: new TokenStore(path.join(dir, ".loxone-tokens.json"))
		});

		this.client.on("status", (s) => this.sendSocketNotification("LOXONE_STATUS", s));
		this.client.on("oos", (oos) => this.sendSocketNotification("LOXONE_STATUS", { state: oos ? "oos" : "online" }));
		this.client.on("warnings", (w) => this.sendSocketNotification("LOXONE_WARNINGS", w));
		this.client.on("controlState", (id, states) => this.coalescer.push(id, states));
		this.client.on("structure", () => this.publishControls());
		this.client.on("error", (e) => console.error("[MMM-Loxone]", e && e.message ? e.message : e));

		this.client.connect();
	},

	async publishControls() {
		const structure = this.client.structure;
		const metas = [];
		for (const uuid of this.client.display) {
			const control = structure.getControl(uuid);
			if (!control) {
				continue;
			}
			const meta = toControlMeta(control, structure);
			meta.iconSvg = meta.iconUuid ? await this._safeIcon(meta.iconUuid) : null;
			meta.initialStates = structure.namedStates(uuid, this.client.valueMap);
			metas.push(meta);
		}
		this.sendSocketNotification("LOXONE_CONTROLS", metas);
	},

	async _safeIcon(iconUuid) {
		try {
			return await this.client.iconCache.get(iconUuid);
		} catch (e) {
			return null;
		}
	}
});
```

- [ ] **Step 2: Syntax-check (the `node_helper` module is only present in a real MM install)**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --check node_helper.js`
Expected: exit 0.

- [ ] **Step 3: Run full suite + lint**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --test && npx eslint lib node_helper.js`
Expected: all tests green; lint clean.

- [ ] **Step 4: Commit**

```bash
git add node_helper.js
git commit -m "feat(bridge): node_helper wiring LoxoneClient to MagicMirror"
```

---

## Chunk 4: Frontend, Theme, Translations, Docs, Cleanup

The browser module, Hybrid theme, i18n, documentation, and removal of the deprecated implementation. Visual layer — verified by running the mirror.

### Task 4.1: `MMM-Loxone.js` (frontend module)

**Files:**
- Overwrite: `MMM-Loxone.js`

- [ ] **Step 1: Replace `MMM-Loxone.js` entirely** with:

```js
/* global Module, Log */
Module.register("MMM-Loxone", {
	defaults: {
		host: null,
		user: null,
		password: null,
		controls: [],
		rooms: [],
		categories: [],
		layout: "grid",
		columns: 2,
		showRoomLabels: true,
		efmLayout: "radial",
		updateThrottleMs: 250,
		permission: "app",
		reconnectMaxBackoffMs: 60000
	},

	getStyles() {
		return [this.file("MMM-Loxone.css")];
	},

	getScripts() {
		return [this.file("renderers/viewmodels.js"), this.file("renderers/render.js")];
	},

	getTranslations() {
		return { en: "translations/en.json", de: "translations/de.json", nl: "translations/nl.json", sv: "translations/sv.json" };
	},

	start() {
		this.registry = self.LoxRender.buildRegistry();
		this.fallback = self.LoxRender.genericFallbackRenderer();
		this.tiles = {};
		this.controls = [];
		this.status = { state: "connecting" };
		this.warnings = [];
		this.ctx = { translate: (k) => this.translate(k), showRoom: this.config.showRoomLabels };
		if (this.config.host && this.config.user && this.config.password) {
			this.sendSocketNotification("LOXONE_CONFIG", this.config);
		} else {
			this.status = { state: "error", message: this.translate("MISSING_CONFIG") };
		}
		this.updateDom();
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "LOXONE_CONTROLS") {
			this.controls = payload;
			this.tiles = {};
			this.updateDom();
		} else if (notification === "LOXONE_STATE") {
			this.applyStates(payload);
		} else if (notification === "LOXONE_STATUS") {
			this.status = payload;
			this.updateDom();
		} else if (notification === "LOXONE_WARNINGS") {
			this.warnings = payload;
			this.updateDom();
		}
	},

	applyStates(batch) {
		batch.forEach((entry) => {
			const t = this.tiles[entry.id];
			if (t) {
				t.renderer.update(t.el, t.meta, entry.states, this.ctx);
			}
		});
	},

	rendererFor(type) {
		return this.registry.resolve(type) || this.fallback;
	},

	getDom() {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-loxone status-" + (this.status.state || "");
		if (this.status.state && this.status.state !== "online") {
			const s = document.createElement("div");
			s.className = "lox-status";
			s.textContent = this.translate(this.status.state.toUpperCase()) || this.status.message || "";
			wrapper.appendChild(s);
		}
		if (!this.controls.length) {
			const empty = document.createElement("div");
			empty.className = "lox-status";
			empty.textContent = this.status.state === "error" ? (this.status.message || this.translate("ERROR")) : this.translate("LOADING");
			wrapper.appendChild(empty);
			return wrapper;
		}
		const grid = document.createElement("div");
		grid.className = "lox-grid lox-layout-" + this.config.layout;
		if (this.config.layout === "grid") {
			grid.style.gridTemplateColumns = "repeat(" + this.config.columns + ", auto)";
		}
		this.controls.forEach((meta) => {
			const renderer = this.rendererFor(meta.type);
			const el = renderer.render(meta, meta.initialStates || {}, this.ctx);
			this.tiles[meta.id] = { el, meta, renderer };
			grid.appendChild(el);
		});
		wrapper.appendChild(grid);
		this.warnings.forEach((w) => {
			const wEl = document.createElement("div");
			wEl.className = "lox-warning";
			wEl.textContent = this.translate(w.reason === "AmbiguousNameError" ? "AMBIGUOUS" : "NOT_FOUND") + ": " + w.entry;
			wrapper.appendChild(wEl);
		});
		return wrapper;
	}
});
```

- [ ] **Step 2: Syntax-check**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --check MMM-Loxone.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add MMM-Loxone.js
git commit -m "feat(frontend): MMM-Loxone module (registry-driven tiles, status, warnings)"
```

### Task 4.2: Hybrid theme `MMM-Loxone.css`

**Files:**
- Overwrite: `MMM-Loxone.css`

- [ ] **Step 1: Replace `MMM-Loxone.css`** with the Hybrid theme (dark, thin, semantic color). Use these CSS custom properties and styles for the classes the renderers emit (`lox-tile`, `lox-tile-head`, `lox-title`, `lox-room`, `lox-icon`, `lox-tile-body`, `lox-value`, `lox-sub`, `lox-state`, `lox-bar`/`lox-bar-fill`, `lox-badge`, `lox-room-temp`, `lox-target`, `lox-meter`, `lox-wallbox`, `lox-wb-head`, `lox-efm`, `lox-grid`, `lox-status`, `lox-warning`):

```css
.mmm-loxone {
	--lox-fg: #ffffff;
	--lox-muted: #888888;
	--lox-production: #7bd06a;
	--lox-import: #ff6b6b;
	--lox-export: #7bd06a;
	--lox-storage: #5aa9ff;
	--lox-consume: #9fe08a;
	color: var(--lox-fg);
	font-weight: 300;
}
.lox-grid { display: grid; gap: 18px; }
.lox-grid.lox-layout-list { display: block; }
.lox-tile { padding: 2px 0; }
.lox-tile-head { display: flex; align-items: baseline; gap: 8px; }
.lox-icon { font-size: 14px; }
.lox-title { font-size: 13px; }
.lox-room { font-size: 10px; text-transform: uppercase; color: var(--lox-muted); margin-left: auto; }
.lox-tile-body { margin-top: 4px; }
.lox-value { font-size: 20px; font-weight: 300; }
.lox-sub { font-size: 11px; color: var(--lox-muted); }
.lox-state.is-on { color: var(--lox-production); }
.lox-bar { height: 3px; background: #1c1c1c; margin-top: 6px; }
.lox-bar-fill { height: 3px; background: var(--lox-production); }
.lox-badge { font-size: 10px; text-transform: uppercase; color: var(--lox-muted); margin-left: 8px; }
.lox-badge.is-charging { color: var(--lox-production); }
.lox-room-temp .lox-target { font-size: 12px; color: var(--lox-muted); margin-left: 6px; }
.lox-wb-head { display: flex; align-items: baseline; justify-content: space-between; }
.lox-efm text { font-family: inherit; }
.lox-status, .lox-warning { font-size: 11px; color: var(--lox-muted); margin: 4px 0; }
.lox-warning { color: var(--lox-import); }
```

- [ ] **Step 2: Commit**

```bash
git add MMM-Loxone.css
git commit -m "style(frontend): Hybrid dark + semantic-color theme"
```

### Task 4.3: Translations

**Files:**
- Overwrite: `translations/en.json`, `translations/de.json`, `translations/nl.json`, `translations/sv.json`

- [ ] **Step 1: Write each translation file** with these keys (translate values per language): `LOADING`, `CONNECTING`, `OFFLINE`, `OOS`, `ERROR`, `MISSING_CONFIG`, `NOT_FOUND`, `AMBIGUOUS`, `ON`, `OFF`, `WB_CHARGING`, `WB_CONNECTED`, `WB_IDLE`, `SOC`. Example `translations/en.json`:

```json
{
	"LOADING": "Loading…",
	"CONNECTING": "Connecting…",
	"OFFLINE": "Offline",
	"OOS": "Miniserver restarting…",
	"ERROR": "Error",
	"MISSING_CONFIG": "Missing host/user/password in config.js",
	"NOT_FOUND": "Not found",
	"AMBIGUOUS": "Ambiguous name",
	"ON": "On",
	"OFF": "Off",
	"WB_CHARGING": "Charging",
	"WB_CONNECTED": "Connected",
	"WB_IDLE": "Free",
	"SOC": "SoC"
}
```

`translations/de.json` (German):

```json
{
	"LOADING": "Lade Daten…",
	"CONNECTING": "Verbinde…",
	"OFFLINE": "Offline",
	"OOS": "Miniserver startet neu…",
	"ERROR": "Fehler",
	"MISSING_CONFIG": "host/user/password fehlen in config.js",
	"NOT_FOUND": "Nicht gefunden",
	"AMBIGUOUS": "Mehrdeutiger Name",
	"ON": "Ein",
	"OFF": "Aus",
	"WB_CHARGING": "Lädt",
	"WB_CONNECTED": "Verbunden",
	"WB_IDLE": "Frei",
	"SOC": "Ladestand"
}
```

Provide `nl.json` and `sv.json` with the same keys translated to Dutch and Swedish respectively (reuse the existing `LOADING` wording from the old files where present).

- [ ] **Step 2: Validate JSON + commit**

```bash
export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && for f in translations/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))" || exit 1; done
git add translations
git commit -m "i18n: translation keys for v2 (en/de/nl/sv)"
```

### Task 4.4: Remove deprecated implementation + docs

**Files:**
- Delete: `scripts/q.js`, `scripts/jquery.min.js`, `shared/lxEnums.js`, `Gruntfile.js`, `.stylelintrc`, `getControlUuid.PNG`, `getRoomUuid.PNG`, `observingUuids.PNG`
- Modify: `.gitignore`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Delete the deprecated files**

```bash
git rm scripts/q.js scripts/jquery.min.js shared/lxEnums.js Gruntfile.js .stylelintrc getControlUuid.PNG getRoomUuid.PNG observingUuids.PNG
rmdir scripts shared 2>/dev/null || true
```

- [ ] **Step 2: Add runtime artifacts to `.gitignore`** (append):

```
.loxone-tokens.json
.loxone-client-uuid
sample-data/LoxAPP3.json
```

- [ ] **Step 3: Rewrite `README.md`** to document: what the module does (v2), the token-based connection, **name-or-UUID configuration** (with a `config.js` example using `controls`/`rooms`/`categories` and `efmLayout`/`layout`/`columns`), the supported controls (generic + Wallbox + Energy-Flow), and that it is read-only. Remove the old UUID-screenshot instructions.

- [ ] **Step 4: Rewrite `CLAUDE.md`** to reflect the new architecture: the isolated `lib/loxone` library (crypto/protocol/auth/structure/transport/client), the `lib/bridge` + `node_helper` glue, the dual-mode `renderers/` (viewmodels + render) loaded via `getScripts`, the `npm test` (`node --test`, needs Node 20+) and `npm run lint` commands, and the spec/plan locations under `docs/superpowers/`.

- [ ] **Step 5: Final full verification**

Run: `export PATH="/Users/lucienkerl/.nvm/versions/node/v20.14.0/bin:$PATH" && node --test && npm run lint && node --check MMM-Loxone.js && node --check node_helper.js`
Expected: all tests green; lint exit 0; both syntax checks pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated lxcommunicator implementation; update README + CLAUDE.md"
```

---

## Done criteria (Plan 2)

- `node --test` fully green (Plan 1's 64 + Plan 2's view-model/registry/bridge tests).
- `npm run lint` exit 0; `node --check` passes for `MMM-Loxone.js` and `node_helper.js`.
- Deprecated `scripts/`, `shared/`, `Gruntfile.js`, `.stylelintrc`, and UUID screenshots removed; README + CLAUDE.md updated.
- The module is installable in `~/MagicMirror/modules/MMM-Loxone`; renderers load via `getScripts` globals. **Live validation (real Miniserver) is the user's manual step**, and is where the deferred §17 hardening items (encrypt post-auth commands, killtoken, version-cache, hasEventSlots) should be revisited.
