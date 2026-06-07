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
		this.warnings = null;
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "LOXONE_CONFIG") {
			this.startClient(payload);
		}
	},

	startClient(config) {
		if (this.client) {
			// Frontend reloaded — keep the existing connection but re-send the
			// current state so the fresh DOM populates (see republish()).
			this.republish();
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
			hideEfmChildren: config.hideEfmChildren !== false,
			efmSocControl: config.efmSocControl || null,
			reconnectMaxBackoffMs: config.reconnectMaxBackoffMs || 60000,
			tokenStore: new TokenStore(path.join(dir, ".loxone-tokens.json"))
		});

		this.client.on("status", (s) => { console.log("[MMM-Loxone] status:", s.state, s.message || ""); this.sendSocketNotification("LOXONE_STATUS", s); });
		this.client.on("phase", (p) => console.log("[MMM-Loxone] phase:", p.phase, p.detail !== undefined ? JSON.stringify(p.detail) : ""));
		this.client.on("oos", (oos) => this.sendSocketNotification("LOXONE_STATUS", { state: oos ? "oos" : "online" }));
		this.client.on("warnings", (w) => { this.warnings = w; console.warn("[MMM-Loxone] unresolved controls:", JSON.stringify(w)); this.sendSocketNotification("LOXONE_WARNINGS", w); });
		this.client.on("controlState", (id, states) => this.coalescer.push(id, states));
		this.client.on("structure", () => this.publishControls());
		this.client.on("close", (info) => console.warn("[MMM-Loxone] ws close: code=" + (info && info.code), info && info.reason ? "reason=" + info.reason : ""));
		this.client.on("error", (e) => console.error("[MMM-Loxone] error:", e && e.stack ? e.stack : (e && e.message) || e));

		this.client.connect();
	},

	// A frontend reload re-sends LOXONE_CONFIG while node_helper keeps the existing
	// connection. LOXONE_CONTROLS/LOXONE_STATUS are only emitted on backend events
	// that already fired, so without re-publishing, the reloaded DOM would receive
	// only the ongoing LOXONE_STATE stream (which it ignores — it has no tiles) and
	// stay stuck at "Verbinde…/Lade Daten…". Re-send status + controls (+ warnings)
	// so the fresh DOM repopulates immediately from the current data.
	republish() {
		this.sendSocketNotification("LOXONE_STATUS", { state: this.client.state || "connecting" });
		if (this.warnings && this.warnings.length) {
			this.sendSocketNotification("LOXONE_WARNINGS", this.warnings);
		}
		if (this.client.structure) {
			this.publishControls();
		}
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
