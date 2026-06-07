"use strict";
const http = require("http");
const https = require("https");

function httpGetJson(urlString, options) {
	const timeoutMs = (options && options.timeoutMs) || 8000;
	return new Promise((resolve, reject) => {
		const lib = urlString.startsWith("https") ? https : http;
		let settled = false;
		let timer = null;
		const finish = (fn, arg) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
			}
			fn(arg);
		};
		const req = lib.get(urlString, (res) => {
			let data = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => {
				data += chunk;
			});
			res.on("end", () => {
				try {
					finish(resolve, JSON.parse(data));
				} catch (e) {
					finish(reject, new Error(`Invalid JSON from ${urlString}`));
				}
			});
		});
		req.on("error", (err) => finish(reject, err));
		timer = setTimeout(() => {
			req.destroy();
			finish(reject, new Error(`HTTP request timed out after ${timeoutMs}ms: ${urlString}`));
		}, timeoutMs);
		if (timer.unref) {
			timer.unref();
		}
	});
}

module.exports = { httpGetJson };
