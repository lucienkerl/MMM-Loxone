"use strict";

function num(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

// Local-track covers come as an Audioserver-relative path; radio/stream covers are
// already absolute URLs. Make them browser-loadable either way.
function absolutizeCover(url, host) {
	if (!url) {
		return null;
	}
	if (/^https?:\/\//i.test(url)) {
		return url;
	}
	return "http://" + host + (url.charAt(0) === "/" ? "" : "/") + url;
}

// Map one Audioserver `audio_event` entry to the namespaced now-playing fields the
// AudioZoneV2 tile reads (kept distinct from the Miniserver state names).
function toNowPlaying(entry, host) {
	const e = entry || {};
	return {
		npTitle: e.title || "",
		npArtist: e.artist || "",
		npAlbum: e.album || "",
		npStation: e.station || "",
		npCover: absolutizeCover(e.coverurl, host),
		npDuration: num(e.duration),
		npTime: num(e.time),
		npMode: e.mode || ""
	};
}

module.exports = { toNowPlaying, absolutizeCover };
