"use strict";
const http = require("http");
const https = require("https");

function httpGetJson(urlString) {
	return new Promise((resolve, reject) => {
		const lib = urlString.startsWith("https") ? https : http;
		const req = lib.get(urlString, (res) => {
			let data = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => {
				data += chunk;
			});
			res.on("end", () => {
				try {
					resolve(JSON.parse(data));
				} catch (e) {
					reject(new Error(`Invalid JSON from ${urlString}`));
				}
			});
		});
		req.on("error", reject);
	});
}

module.exports = { httpGetJson };
