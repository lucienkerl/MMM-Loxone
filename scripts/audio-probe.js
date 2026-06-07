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
setTimeout(() => { log("TIMEOUT (30s)"); finish(1); }, 30000);

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
	log("=== connecting AUDIOSERVER WS:", url, "===");
	const ws = new WebSocket(url);
	const seen = [];
	ws.on("message", (data, isBinary) => {
		if (isBinary) { log("  <= [binary " + data.length + " bytes]"); return; }
		const txt = data.toString();
		seen.push(txt);
		log("  <=", txt.length > 500 ? txt.slice(0, 500) + "… (" + txt.length + " chars)" : txt);
	});
	ws.on("error", (e) => log("  ws error:", e && e.message));
	await new Promise((resolve, reject) => {
		ws.once("open", resolve);
		ws.once("error", reject);
		setTimeout(() => reject(new Error("ws open timeout")), 8000);
	});
	log("  ws open");

	const send = async (cmd, label) => {
		log("  =>", label || cmd);
		ws.send(cmd);
		await sleep(900);
	};

	// --- discovery + handshake attempt (responses above guide the real sequence) ---
	await send("audio/cfg/getkey", "audio/cfg/getkey");
	await send("secure/hello/audio-probe/audio-probe/0", "secure/hello/…");
	await send("secure/init/" + token, "secure/init/<token " + token.length + " chars>");
	await send("secure/authenticate/" + token, "secure/authenticate/<token>");
	await send("audio/cfg/getplayersdetails", "audio/cfg/getplayersdetails");
	for (const z of zones.slice(0, 2)) {
		await send("audio/" + z.playerid + "/status", "audio/" + z.playerid + "/status (" + z.name + ")");
	}
	await sleep(1500); // catch any pushed audio_event

	const blob = seen.join("\n");
	const hit = (k) => (blob.indexOf(k) >= 0 ? "YES" : "no");
	log("=== now-playing fields seen ===");
	log("  coverurl:", hit("coverurl"), "| title:", hit("title"), "| album:", hit("album"), "| artist:", hit("artist"), "| duration:", hit("duration"), "| time:", hit("\"time\""), "| audiopath:", hit("audiopath"));
	try { ws.close(); } catch (e) { /* ignore */ }
}
