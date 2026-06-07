"use strict";

class Coalescer {
	constructor(flushMs, onFlush, scheduler) {
		this.flushMs = flushMs;
		this.onFlush = onFlush;
		this.pending = new Map();
		this.timer = null;
		this._set = scheduler && scheduler.set ? scheduler.set : (fn) => setTimeout(fn, this.flushMs);
		this._clear = scheduler && scheduler.clear ? scheduler.clear : clearTimeout;
	}

	push(id, states) {
		this.pending.set(id, states);
		if (this.timer === null) {
			this.timer = this._set(() => this.flush(), this.flushMs);
		}
	}

	flush() {
		if (this.timer !== null) {
			this._clear(this.timer);
			this.timer = null;
		}
		if (this.pending.size === 0) {
			return;
		}
		const batch = [...this.pending.entries()].map(([id, states]) => ({ id, states }));
		this.pending.clear();
		this.onFlush(batch);
	}
}

module.exports = { Coalescer };
