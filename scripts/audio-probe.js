#!/usr/bin/env node
"use strict";
/*
 * Discovery probe for Loxone Audioserver now-playing (cover / title / album / time).
 *
 *   node scripts/audio-probe.js <miniserver-host> <user> <password> [audioserver-host:port]
 *   LOX_HOST=… LOX_USER=… LOX_PASS=… node scripts/audio-probe.js
 *
 * Step 1: reuses the existing lib to connect to the MINISERVER, obtain a token,
 *         and read the Audioserver host + AudioZoneV2 zones from the structure.
 * Step 2: connects to the AUDIOSERVER WebSocket and attempts the secure handshake
 *         (secure/hello → secure/init/<token> → secure/authenticate/<token>), then
 *         requests player details. EVERY response is logged verbatim so we can see
 *         exactly what the paired device requires. Prints NO password; the token is
 *         shown only as length. Requires Node 18+.
 */
const path = require("path");
const WebSocket = require("ws");
const { LoxoneClient } = require("../lib/loxone");
const { TokenStore } = require("../lib/loxone/auth/TokenStore");

const msHost = process.argv[2] || process.env.LOX_HOST;
const user = process.argv[3] || process.env.LOX_USER;
const password = process.argv[4] || process.env.LOX_PASS;
const audioArg = process.argv[5] || process.env.LOX_AUDIO || null;

if (!msHost || !user || !password) {
	console.error("usage: node scripts/audio-probe.js <miniserver-host> <user> <password> [audioserver-host:port]");
	process.exit(2);
}

const t0 = Date.now();
const ts = () => "+" + ((Date.now() - t0) / 1000).toFixed(2) + "s";
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("MMM-Loxone audio-probe — node", process.version);
console.log("miniserver:", msHost, "| user:", user);

let done = false;
function finish(code) {
	if (done) { return; }
	done = true;
	setTimeout(() => process.exit(code || 0), 200);
}
setTimeout(() => { log("TIMEOUT (40s)"); finish(1); }, 40000);

const tokenStore = new TokenStore(path.join(__dirname, "..", ".loxone-tokens.json"));
const client = new LoxoneClient({
	host: msHost, user, password, permission: "app",
	clientUuid: "audio-probe", clientInfo: "audio-probe",
	controls: [], reconnectMaxBackoffMs: 999999, tokenStore
});
client.on("error", (e) => log("miniserver error:", e && e.message));
client.on("phase", (p) => { if (p.phase === "authOk") { log("miniserver auth OK (" + (p.detail && p.detail.mode) + ")"); } });

client.once("structure", async (structure) => {
	const rec = tokenStore.load(msHost, user) || {};
	const token = rec.token || "";
	log("miniserver token:", token ? token.length + " chars, hashAlg=" + rec.hashAlg : "NONE — cannot auth to audioserver");

	const media = structure.raw.mediaServer || {};
	const servers = Object.keys(media).map((k) => media[k]).filter((m) => m && m.deviceType === "Audioserver");
	servers.forEach((s) => log("audioserver in structure:", JSON.stringify({ name: s.name, host: s.host, mac: s.mac })));
	const zones = Object.keys(structure.controls)
		.map((u) => structure.controls[u])
		.filter((c) => c.type === "AudioZoneV2")
		.map((c) => ({ name: c.name, playerid: c.details && c.details.playerid }));
	log("zones:", JSON.stringify(zones));

	const hostport = audioArg || (servers[0] && servers[0].host);
	if (!hostport) { log("no Audioserver host found"); return finish(1); }

	try {
		await probeAudioserver(hostport, token, zones);
	} catch (e) {
		log("audioserver probe error:", e && e.message);
	}
	finish(0);
});
log("connecting to miniserver…");
client.connect();

async function probeAudioserver(hostport, token, zones) {
	const url = "ws://" + hostport + "/";
	// The Loxone WS protocol uses the "remotecontrol" subprotocol; without it the
	// paired device accepts the TCP upgrade but ignores the connection.
	log("=== connecting AUDIOSERVER WS:", url, "(subprotocol remotecontrol) ===");
	const ws = new WebSocket(url, "remotecontrol");
	const seen = [];
	let events = 0;
	ws.on("message", (data, isBinary) => {
		if (isBinary) { log("  <= [binary " + data.length + " bytes]: " + data.slice(0, 16).toString("hex")); return; }
		const txt = data.toString();
		seen.push(txt);
		if (txt.indexOf("\"audio_event\"") >= 0) { events += 1; }
		log("  <=", txt.length > 500 ? txt.slice(0, 500) + "… (" + txt.length + " chars)" : txt);
	});
	ws.on("error", (e) => log("  ws error:", e && e.message));
	ws.on("unexpected-response", (req, res) => log("  ws upgrade REJECTED: HTTP " + res.statusCode, JSON.stringify(res.headers)));
	ws.on("close", (code, reason) => log("  ws CLOSE code=" + code, "reason=" + (reason ? reason.toString() : "")));
	await new Promise((resolve, reject) => {
		ws.once("open", () => resolve());
		ws.once("error", reject);
		setTimeout(() => reject(new Error("ws open timeout")), 8000);
	});
	log("  ws open — subprotocol:", JSON.stringify(ws.protocol), "| zones:", zones.length, "| token:", token.length + " chars");
	// PASSIVE read-only test: only keepalive, NO privileged commands (getplayersdetails
	// got us kicked with 1006). At +8s a harmless audio/cfg/getkey nudge — so we can tell
	// from timestamps whether audio_event arrives purely passively or needs a nudge.
	log("  PASSIVE test: keepalive only; harmless getkey nudge at +8s. Listening ~24s for audio_event…");
	const ka = setInterval(() => { if (ws.readyState === WebSocket.OPEN) { ws.send("keepalive"); } }, 4000);
	if (ka.unref) { ka.unref(); }
	await sleep(8000);
	if (ws.readyState === WebSocket.OPEN) { log("  => audio/cfg/getkey (nudge)"); ws.send("audio/cfg/getkey"); }
	await sleep(16000);
	clearInterval(ka);

	const blob = seen.join("\n");
	const hit = (k) => (blob.indexOf(k) >= 0 ? "YES" : "no");
	log("=== result ===");
	log("  audio_event pushes:", events, "| connection still open:", ws.readyState === WebSocket.OPEN);
	log("  fields: coverurl:", hit("coverurl"), "title:", hit("title"), "album:", hit("album"), "artist:", hit("artist"), "duration:", hit("duration"), "time:", hit("\"time\""), "station:", hit("station"));
	try { ws.close(); } catch (e) { /* ignore */ }
}
