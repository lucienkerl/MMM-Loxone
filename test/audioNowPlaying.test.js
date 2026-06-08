"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { toNowPlaying, absolutizeCover } = require("../lib/bridge/audioNowPlaying");

test("absolutizeCover keeps absolute URLs and prefixes relative paths with the host", () => {
	assert.equal(absolutizeCover("https://cover/x.jpg", "10.0.1.190:7091"), "https://cover/x.jpg");
	assert.equal(absolutizeCover("/cover/x.jpg", "10.0.1.190:7091"), "http://10.0.1.190:7091/cover/x.jpg");
	assert.equal(absolutizeCover("cover/x.jpg", "10.0.1.190:7091"), "http://10.0.1.190:7091/cover/x.jpg");
	assert.equal(absolutizeCover("", "h"), null);
});

test("toNowPlaying maps an audio_event entry to namespaced np* fields", () => {
	const np = toNowPlaying({
		title: "Powertrip", artist: "Monster Magnet", album: "Powertrip", station: "",
		coverurl: "/cover/abc", duration: 240, time: 61, mode: "play", playerid: 6
	}, "10.0.1.190:7091");
	assert.deepEqual(np, {
		npTitle: "Powertrip", npArtist: "Monster Magnet", npAlbum: "Powertrip", npStation: "",
		npCover: "http://10.0.1.190:7091/cover/abc", npDuration: 240, npTime: 61, npMode: "play"
	});
});

test("toNowPlaying tolerates missing fields", () => {
	const np = toNowPlaying({}, "h");
	assert.equal(np.npTitle, "");
	assert.equal(np.npCover, null);
	assert.equal(np.npDuration, 0);
	assert.equal(np.npTime, 0);
});
