"use strict";
const EventEmitter = require("events");
const { WebSocketTransport } = require("../transport/WebSocketTransport");
const { computeBackoff } = require("../net/backoff");

// Read-only client for a Loxone Audioserver (the Music Server's player engine).
// Connects with the "remotecontrol" subprotocol — without it a paired device
// accepts the socket but ignores it. The server pushes `{"audio_event":[…]}` with
// per-player now-playing (title/artist/album/station/coverurl/duration/time/…)
// on connect and on change. We send NOTHING privileged (those trigger a close),
// only an occasional WebSocket ping for liveness. Reconnects with back-off.
class AudioServerClient extends EventEmitter {
	constructor(options) {
		super();
		this.opt = Object.assign({ reconnectMaxBackoffMs: 60000, pingMs: 30000 }, options);
		this.deps = Object.assign({ createTransport: () => new WebSocketTransport() }, options.deps || {});
		this.transport = null;
		this.stopped = false;
		this.attempt = 0;
		this.reconnectTimer = null;
		this.pingTimer = null;
	}

	async connect() {
		this.stopped = false;
		try {
			this.transport = this.deps.createTransport();
			this.transport.on("frame", (data, isBinary) => { if (!isBinary) { this._onText(data.toString()); } });
			this.transport.on("close", () => this._onClose());
			this.transport.on("error", (e) => this.emit("error", e));
			await this.transport.open(`ws://${this.opt.host}/`, "remotecontrol");
			this.attempt = 0;
			this._startPing();
			this.emit("open");
		} catch (e) {
			this.emit("error", e);
			this._scheduleReconnect();
		}
		return this;
	}

	_onText(txt) {
		// Only the JSON pushes interest us; the identification line ("LWSS V …")
		// and command errors ("404 command not found") are plain text — ignore them.
		if (!txt || txt.charCodeAt(0) !== 123) {
			return;
		}
		let obj;
		try {
			obj = JSON.parse(txt);
		} catch (e) {
			return;
		}
		if (obj && Array.isArray(obj.audio_event)) {
			this.emit("audioEvent", obj.audio_event);
		}
	}

	_startPing() {
		this._stopPing();
		this.pingTimer = setInterval(() => {
			const ws = this.transport && this.transport.ws;
			if (ws && ws.readyState === 1 && typeof ws.ping === "function") {
				try {
					ws.ping();
				} catch (e) {
					// ignore — a dead socket surfaces via the close/error events
				}
			}
		}, this.opt.pingMs);
		if (this.pingTimer.unref) {
			this.pingTimer.unref();
		}
	}

	_stopPing() {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
	}

	_onClose() {
		this._stopPing();
		if (!this.stopped) {
			this._scheduleReconnect();
		}
	}

	_scheduleReconnect() {
		if (this.stopped || this.reconnectTimer) {
			return;
		}
		this.attempt += 1;
		const delay = computeBackoff(this.attempt, this.opt.reconnectMaxBackoffMs);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
		if (this.reconnectTimer.unref) {
			this.reconnectTimer.unref();
		}
	}

	stop() {
		this.stopped = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this._stopPing();
		if (this.transport) {
			this.transport.close();
		}
	}
}

module.exports = { AudioServerClient };
