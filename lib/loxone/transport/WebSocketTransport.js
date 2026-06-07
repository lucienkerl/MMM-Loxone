"use strict";
const WebSocket = require("ws");
const EventEmitter = require("events");

class WebSocketTransport extends EventEmitter {
	constructor() {
		super();
		this.ws = null;
	}

	open(url, subprotocol, options) {
		const timeoutMs = (options && options.timeoutMs) || 10000;
		return new Promise((resolve, reject) => {
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
			this.ws = new WebSocket(url, subprotocol);
			this.ws.on("open", () => finish(resolve));
			this.ws.on("message", (data, isBinary) => this.emit("frame", data, isBinary));
			this.ws.on("close", (code, reason) => this.emit("close", { code, reason: reason ? reason.toString() : "" }));
			this.ws.on("error", (err) => {
				this.emit("error", err);
				finish(reject, err);
			});
			timer = setTimeout(() => {
				try {
					this.ws.terminate();
				} catch (e) {
					// ignore — terminate is best-effort on a stuck socket
				}
				finish(reject, new Error(`WebSocket open timed out after ${timeoutMs}ms: ${url}`));
			}, timeoutMs);
			if (timer.unref) {
				timer.unref();
			}
		});
	}

	sendText(text) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(text);
		}
	}

	close() {
		if (this.ws) {
			this.ws.close();
		}
	}
}

module.exports = { WebSocketTransport };
