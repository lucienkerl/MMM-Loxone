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
