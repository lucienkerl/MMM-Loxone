"use strict";
const path = require("path");
const NodeHelper = require("node_helper");
const { LoxoneClient } = require("./lib/loxone");
const { TokenStore } = require("./lib/loxone/auth/TokenStore");
const { Coalescer } = require("./lib/bridge/Coalescer");
const { toControlMeta } = require("./lib/bridge/controlMeta");
const { getOrCreateClientId } = require("./lib/bridge/clientId");
const { AudioServerClient } = require("./lib/loxone/audio/AudioServerClient");
const { toNowPlaying } = require("./lib/bridge/audioNowPlaying");

module.exports = NodeHelper.create({
	start() {
		this.client = null;
		this.coalescer = null;
		this.warnings = null;
		this.audioClients = [];
		this.audioMap = null;
		this.audioStarted = false;
		this.nowPlaying = {};
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
		this.client.on("controlState", (id, states) => this.coalescer.push(id, this._withNowPlaying(id, states)));
		this.client.on("structure", () => { this.publishControls(); this._startAudio(); });
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
			meta.initialStates = this._withNowPlaying(uuid, structure.namedStates(uuid, this.client.valueMap));
			metas.push(meta);
		}
		this.sendSocketNotification("LOXONE_CONTROLS", metas);
	},

	// Open a read-only second connection to each Audioserver that owns a displayed
	// AudioZoneV2, so the tile can show cover / title / album / position. The rich
	// track data is NOT on the Miniserver — only on the Audioserver. Runs once;
	// the audio clients keep their own connection across Miniserver reconnects.
	_startAudio() {
		if (this.audioStarted) {
			return;
		}
		const structure = this.client.structure;
		const media = (structure.raw && structure.raw.mediaServer) || {};
		this.audioMap = {};
		const serverUuids = new Set();
		for (const uuid of this.client.display) {
			const c = structure.getControl(uuid);
			const d = c && c.details;
			if (c && c.type === "AudioZoneV2" && d && d.server != null && d.playerid != null) {
				this.audioMap[d.server + ":" + d.playerid] = uuid;
				serverUuids.add(d.server);
			}
		}
		if (!serverUuids.size) {
			return;
		}
		this.audioStarted = true;
		serverUuids.forEach((serverUuid) => {
			const host = media[serverUuid] && media[serverUuid].host;
			if (!host) {
				return;
			}
			const ac = new AudioServerClient({ host });
			ac.on("audioEvent", (events) => this._onAudioEvent(serverUuid, host, events));
			ac.on("open", () => console.log("[MMM-Loxone] audioserver connected:", host));
			ac.on("error", (e) => console.warn("[MMM-Loxone] audioserver(" + host + ") error:", e && e.message));
			ac.connect();
			this.audioClients.push(ac);
		});
	},

	_onAudioEvent(serverUuid, host, events) {
		(events || []).forEach((e) => {
			if (!e || e.playerid == null) {
				return;
			}
			const uuid = this.audioMap[serverUuid + ":" + e.playerid];
			if (!uuid) {
				return; // a zone that isn't being displayed
			}
			this.nowPlaying[uuid] = toNowPlaying(e, host);
			this.coalescer.push(uuid, this._withNowPlaying(uuid, this.client.structure.namedStates(uuid, this.client.valueMap)));
		});
	},

	_withNowPlaying(uuid, states) {
		const np = this.nowPlaying[uuid];
		return np ? Object.assign({}, states, np) : states;
	},

	async _safeIcon(iconUuid) {
		try {
			return await this.client.iconCache.get(iconUuid);
		} catch (e) {
			return null;
		}
	}
});
