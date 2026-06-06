"use strict";

function recolorSvg(svg) {
	let out = String(svg).replace(/fill="(?!none)[^"]*"/g, "fill=\"currentColor\"");
	if (!/<svg[^>]*\bfill=/.test(out)) {
		out = out.replace("<svg", "<svg fill=\"currentColor\"");
	}
	return out;
}

class IconCache {
	constructor(requester) {
		this.requester = requester;
		this.cache = new Map();
	}

	async get(iconUuid) {
		if (!iconUuid) {
			return null;
		}
		if (this.cache.has(iconUuid)) {
			return this.cache.get(iconUuid);
		}
		let svg = null;
		try {
			const raw = await this.requester.commandRaw(`${iconUuid}.svg`);
			if (raw && raw.includes("<svg")) {
				svg = recolorSvg(raw);
			}
		} catch (e) {
			svg = null;
		}
		this.cache.set(iconUuid, svg);
		return svg;
	}
}

module.exports = { IconCache, recolorSvg };
