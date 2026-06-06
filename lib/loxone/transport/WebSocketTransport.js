"use strict";
const WebSocket = require("ws");
const EventEmitter = require("events");

class WebSocketTransport extends EventEmitter {
	constructor() {
		super();
		this.ws = null;
	}

	open(url, subprotocol) {
		return new Promise((resolve, reject) => {
			this.ws = new WebSocket(url, subprotocol);
			this.ws.on("open", () => resolve());
			this.ws.on("message", (data, isBinary) => this.emit("frame", data, isBinary));
			this.ws.on("close", (code, reason) => this.emit("close", { code, reason: reason ? reason.toString() : "" }));
			this.ws.on("error", (err) => {
				this.emit("error", err);
				reject(err);
			});
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
