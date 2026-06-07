#!/usr/bin/env node
"use strict";
/*
 * Standalone connection diagnostic for MMM-Loxone (no MagicMirror needed).
 *
 *   node scripts/diagnose.js <host> <user> <password>
 *   LOX_HOST=… LOX_USER=… LOX_PASS=… node scripts/diagnose.js
 *
 * Requires Node 18+. Prints each handshake phase, the apiKey info
 * (local / httpsStatus), and the exact failure (error stack or ws close code).
 */
const { LoxoneClient } = require("../lib/loxone");
const { httpGetJson } = require("../lib/loxone/net/http");
const { parseLL } = require("../lib/loxone/protocol/response");
const { parseApiKeyValue } = require("../lib/loxone/net/apiKey");

const host = process.argv[2] || process.env.LOX_HOST;
const user = process.argv[3] || process.env.LOX_USER;
const password = process.argv[4] || process.env.LOX_PASS;

if (!host || !user || !password) {
	console.error("usage: node scripts/diagnose.js <host> <user> <password>");
	process.exit(2);
}

const t0 = Date.now();
const ts = () => "+" + ((Date.now() - t0) / 1000).toFixed(2) + "s";
console.log("MMM-Loxone diagnostic — node", process.version);
console.log("host:", host, "| user:", user);

(async () => {
	try {
		const r = await httpGetJson(`http://${host}/jdev/cfg/apiKey`);
		const info = parseApiKeyValue(parseLL(r).value);
		console.log(ts(), "apiKey OK:", JSON.stringify({ version: info.version, httpsStatus: info.httpsStatus, local: info.local, snr: info.snr, hasEventSlots: info.hasEventSlots }));
		if (info.httpsStatus && info.httpsStatus !== 0) {
			console.log("   note: httpsStatus =", info.httpsStatus, "— Miniserver uses/supports TLS; if it REQUIRES encryption, plain ws:// may be refused.");
		}
		if (info.local === false) {
			console.log("   note: local = false — the Miniserver does NOT consider this a local connection; access may be restricted.");
		}
	} catch (e) {
		console.error(ts(), "apiKey FAILED:", e.message);
		console.error("   -> http://" + host + " not reachable or not JSON. Check host/port; is the Miniserver HTTPS-only?");
		process.exit(1);
	}

	try {
		const r = await httpGetJson(`http://${host}/jdev/sys/getPublicKey`);
		console.log(ts(), "getPublicKey OK (", String(parseLL(r).value).length, "chars )");
	} catch (e) {
		console.error(ts(), "getPublicKey FAILED:", e.message, "— does this firmware support jdev/sys/getPublicKey?");
		process.exit(1);
	}

	const client = new LoxoneClient({
		host, user, password, permission: "app",
		clientUuid: "diagnose-" + process.pid, clientInfo: "diagnose",
		controls: [], reconnectMaxBackoffMs: 999999
	});

	let done = false;
	const finish = (code, msg) => {
		if (done) { return; }
		done = true;
		if (msg) { console.log(ts(), msg); }
		try { client.stop(); } catch (e) { /* ignore */ }
		setTimeout(() => process.exit(code), 250);
	};

	client.on("phase", (p) => console.log(ts(), "phase:", p.phase, p.detail !== undefined ? JSON.stringify(p.detail) : ""));
	client.on("status", (s) => console.log(ts(), "status:", s.state, s.message || ""));
	client.on("error", (e) => console.error(ts(), "ERROR:", e && e.stack ? e.stack : e));
	client.on("close", (info) => {
		console.warn(ts(), "ws CLOSE code=" + (info && info.code), "reason=" + (info && info.reason || ""));
		console.warn("   close-code guide: 1006=abnormal/unreachable/refused · 4003=auth timeout or too many logins · 4004-4006=user changed/disabled · 4007=MS updating · 4008=no event slots");
		finish(1, "-> failed: look at the last phase reached + ERROR/CLOSE above");
	});
	client.on("structure", () => finish(0, "SUCCESS ✓ connected, authenticated and structure loaded"));

	setTimeout(() => finish(1, "TIMEOUT after 25s (no success, no close — likely hung waiting on a response)"), 25000);
	console.log(ts(), "connecting…");
	client.connect();
})();
