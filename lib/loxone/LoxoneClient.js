"use strict";
const EventEmitter = require("events");
const C = require("./crypto/LoxoneCrypto");
const { CommandCipher } = require("./protocol/commands");
const { FrameAssembler } = require("./protocol/FrameAssembler");
const { TYPES } = require("./protocol/MessageHeader");
const { parseValueEvents, parseTextEvents } = require("./protocol/EventParser");
const { parseLL } = require("./protocol/response");
const { Structure } = require("./structure/Structure");
const { Requester } = require("./net/Requester");
const { acquireToken, authWithToken } = require("./auth/Authenticator");
const { isTokenUsable } = require("./auth/TokenStore");
const { normalizePublicKey } = require("./net/publicKey");
const { parseApiKeyValue } = require("./net/apiKey");
const { httpGetJson } = require("./net/http");
const { WebSocketTransport } = require("./transport/WebSocketTransport");
const { computeBackoff } = require("./net/backoff");
const { IconCache } = require("./IconCache");

const DEFAULTS = { permission: "app", reconnectMaxBackoffMs: 60000, keepaliveMs: 120000, tokenMinRemainingSec: 600 };

class LoxoneClient extends EventEmitter {
	constructor(options) {
		super();
		this.opt = Object.assign({}, DEFAULTS, options);
		this.deps = Object.assign({ createTransport: () => new WebSocketTransport(), httpGetJson, now: () => Date.now() }, options.deps || {});
		this.tokenStore = options.tokenStore || null;
		this.state = "INIT";
		this.transport = null;
		this.requester = null;
		this.cipher = null;
		this.structure = null;
		this.iconCache = null;
		this.session = null;
		this.publicKey = null;
		this.apiInfo = null;
		this.valueMap = new Map();
		this.display = [];
		this.displaySet = new Set();
		this.stopped = false;
		this.attempt = 0;
		this.keepaliveTimer = null;
		this.reconnectTimer = null;
	}

	_setStatus(state, message) {
		this.state = state;
		this.emit("status", { state, message });
	}

	async connect() {
		this.stopped = false;
		try {
			await this._handshake();
			this.attempt = 0;
		} catch (e) {
			this.emit("error", e);
			this._scheduleReconnect();
		}
		return this;
	}

	async _handshake() {
		const { host } = this.opt;
		this._setStatus("connecting");
		const apiResp = await this.deps.httpGetJson(`http://${host}/jdev/cfg/apiKey`);
		this.apiInfo = parseApiKeyValue(parseLL(apiResp).value);
		this.emit("phase", { phase: "apiKey", detail: { version: this.apiInfo.version, httpsStatus: this.apiInfo.httpsStatus, local: this.apiInfo.local, snr: this.apiInfo.snr } });
		const pkResp = await this.deps.httpGetJson(`http://${host}/jdev/sys/getPublicKey`);
		this.publicKey = normalizePublicKey(parseLL(pkResp).value);
		this.emit("phase", { phase: "publicKey" });

		this.transport = this.deps.createTransport();
		const assembler = new FrameAssembler({
			onText: (t) => this.requester.handleText(t),
			onMessage: (type, payload) => this._onMessage(type, payload)
		});
		this.transport.on("frame", (data, isBinary) => assembler.push(data, isBinary));
		this.transport.on("close", (info) => this._onClose(info));
		this.transport.on("error", (e) => { if (this.requester) { this.requester.rejectAll(e); } this.emit("error", e); });
		this.requester = new Requester((cmd) => this.transport.sendText(cmd));
		await this.transport.open(`ws://${host}/ws/rfc6455`, "remotecontrol");
		this.emit("phase", { phase: "wsOpen" });

		this.session = C.generateSessionKey();
		const sessionKey = C.rsaEncryptBase64(this.publicKey, `${this.session.keyHex}:${this.session.ivHex}`);
		// The RSA-encrypted session key is sent as RAW base64 — the Miniserver does NOT
		// URL-decode this path, so encoding "+ / =" would corrupt it (→ 401). Only the
		// later AES enc/fenc commands are URL-encoded (see CommandCipher).
		const keyexResp = await this.requester.command(`jdev/sys/keyexchange/${sessionKey}`);
		if (keyexResp.code !== 200) { throw new Error(`keyexchange failed (code ${keyexResp.code})`); }
		this.cipher = new CommandCipher(this.session.keyBuf, this.session.ivBuf);
		this.requester.setCipher(this.cipher);
		this.emit("phase", { phase: "keyexchange", detail: { code: keyexResp.code } });

		await this._authenticate();
		await this._loadStructure();
		this.emit("phase", { phase: "structure", detail: { controls: Object.keys(this.structure.controls).length, display: this.display.length } });
		const enableResp = await this.requester.command("jdev/sps/enablebinstatusupdate");
		if (enableResp.code !== 200) { throw new Error(`enablebinstatusupdate failed (code ${enableResp.code})`); }
		this.emit("phase", { phase: "subscribed" });

		this._setStatus("online");
		this._startKeepalive();
		this.emit("structure", this.structure);
	}

	async _authenticate() {
		const { host, user, password, permission, clientUuid, clientInfo } = this.opt;
		const stored = this.tokenStore ? this.tokenStore.load(host, user) : null;
		if (isTokenUsable(stored, this.deps.now(), this.opt.tokenMinRemainingSec)) {
			this.emit("phase", { phase: "auth", detail: { mode: "token" } });
			const ok = await authWithToken(this.requester, { user, token: stored.token, hashAlg: stored.hashAlg });
			if (ok) {
				this.emit("phase", { phase: "authOk", detail: { mode: "token" } });
				return;
			}
			if (this.tokenStore) {
				this.tokenStore.clear(host, user);
			}
		}
		this.emit("phase", { phase: "auth", detail: { mode: "acquire" } });
		const record = await acquireToken(this.requester, { user, password, permission, clientUuid, clientInfo });
		if (this.tokenStore) {
			this.tokenStore.save(host, user, record);
		}
		this.emit("phase", { phase: "authOk", detail: { mode: "acquire" } });
	}

	async _loadStructure() {
		const raw = await this.requester.commandRaw("data/LoxAPP3.json");
		this.structure = new Structure(JSON.parse(raw));
		this.iconCache = new IconCache(this.requester);
		this._resolveDisplay();
	}

	_resolveDisplay() {
		const set = new Set();
		const warnings = [];
		const add = (control) => set.add(control.uuid);
		(this.opt.controls || []).forEach((entry) => {
			try {
				add(this.structure.resolve(entry));
			} catch (e) {
				warnings.push({ entry, reason: e.name, candidates: e.candidates });
			}
		});
		(this.opt.rooms || []).forEach((r) => this.structure.controlsInRoom(r).forEach(add));
		(this.opt.categories || []).forEach((c) => this.structure.controlsInCategory(c).forEach(add));
		this.displaySet = set;
		this.display = [...set];
		if (warnings.length) {
			this.emit("warnings", warnings);
		}
	}

	_onMessage(type, payload) {
		if (type === TYPES.VALUE) {
			parseValueEvents(payload).forEach((e) => this._applyState(e.uuid, e.value));
		} else if (type === TYPES.TEXTSTATE) {
			parseTextEvents(payload).forEach((e) => this._applyState(e.uuid, e.text));
		} else if (type === TYPES.OOS) {
			this.emit("oos", true);
		}
		// DAYTIMER, WEATHER, KEEPALIVE decoded elsewhere / ignored in v1
	}

	_applyState(stateUuid, value) {
		this.valueMap.set(stateUuid, value);
		const affected = new Set();
		this.structure.statesForUuid(stateUuid).forEach((owner) => {
			if (this.displaySet.has(owner.controlUuid)) {
				affected.add(owner.controlUuid);
			}
		});
		affected.forEach((controlUuid) => {
			this.emit("controlState", controlUuid, this.structure.namedStates(controlUuid, this.valueMap));
		});
	}

	_startKeepalive() {
		this._stopKeepalive();
		this.keepaliveTimer = setInterval(() => {
			if (this.transport) {
				this.transport.sendText("keepalive");
			}
		}, this.opt.keepaliveMs);
		if (this.keepaliveTimer.unref) {
			this.keepaliveTimer.unref();
		}
	}

	_stopKeepalive() {
		if (this.keepaliveTimer) {
			clearInterval(this.keepaliveTimer);
			this.keepaliveTimer = null;
		}
	}

	_onClose(info) {
		this._stopKeepalive();
		if (this.requester) { this.requester.rejectAll(new Error("connection closed")); }
		this.emit("close", info || {});
		if (!this.stopped) {
			this._setStatus("offline");
			this._scheduleReconnect();
		}
	}

	_scheduleReconnect() {
		// A single handshake failure can trigger both the open() catch path and the
		// transport "close" path; coalesce them so we never run parallel reconnects.
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

	getControl(idOrName) {
		return this.structure ? this.structure.resolve(idOrName) : null;
	}

	stop() {
		this.stopped = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this._stopKeepalive();
		if (this.transport) {
			this.transport.close();
		}
	}
}

module.exports = { LoxoneClient };
