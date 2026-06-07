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
