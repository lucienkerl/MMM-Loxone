"use strict";

class NotFoundError extends Error {
	constructor(entry) {
		super(`Loxone control not found: ${entry}`);
		this.name = "NotFoundError";
		this.entry = entry;
	}
}

class AmbiguousNameError extends Error {
	constructor(entry, candidates) {
		super(`Loxone control name is ambiguous: ${entry}`);
		this.name = "AmbiguousNameError";
		this.entry = entry;
		this.candidates = candidates;
	}
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{16}$/;

function looksLikeUuid(s) {
	return UUID_RE.test(String(s).trim());
}

function norm(s) {
	return String(s).trim().toLowerCase();
}

class Structure {
	constructor(json) {
		this.raw = json;
		this.lastModified = json.lastModified;
		this.rooms = json.rooms || {};
		this.cats = json.cats || {};
		this.globalStates = json.globalStates || {};
		this.controls = {};
		this._byName = new Map();
		this._stateIndex = new Map();
		this._index(json.controls || {});
	}

	_addControl(control, isSub) {
		const uuid = control.uuidAction || control.uuid;
		if (!uuid) {
			return;
		}
		control.uuid = uuid;
		control._top = !isSub;
		this.controls[uuid] = control;
		// Empty-type controls "should not be visualized" (Structure File doc) -> keep out of name index.
		if (!isSub && control.type) {
			const key = norm(control.name);
			if (!this._byName.has(key)) {
				this._byName.set(key, []);
			}
			this._byName.get(key).push(control);
		}
		const states = control.states || {};
		Object.keys(states).forEach((stateName) => {
			const su = states[stateName];
			const list = Array.isArray(su) ? su : [su];
			list.forEach((sUuid) => {
				if (typeof sUuid !== "string") {
					return;
				}
				if (!this._stateIndex.has(sUuid)) {
					this._stateIndex.set(sUuid, []);
				}
				this._stateIndex.get(sUuid).push({ controlUuid: uuid, stateName });
			});
		});
	}

	_index(controls) {
		Object.keys(controls).forEach((uuid) => {
			const c = controls[uuid];
			this._addControl(c, false);
			if (c.subControls) {
				Object.keys(c.subControls).forEach((sUuid) => this._addControl(c.subControls[sUuid], true));
			}
		});
	}

	getControl(uuid) {
		return this.controls[uuid] || null;
	}

	roomName(uuid) {
		return this.rooms[uuid] ? this.rooms[uuid].name : undefined;
	}

	catName(uuid) {
		return this.cats[uuid] ? this.cats[uuid].name : undefined;
	}

	resolve(entry) {
		const raw = String(entry).trim();
		if (looksLikeUuid(raw)) {
			const c = this.getControl(raw);
			if (!c) {
				throw new NotFoundError(entry);
			}
			return c;
		}
		let roomQualifier = null;
		let name = raw;
		// Room-qualifier split. Assumes control/room names do not themselves contain "/" or ":".
		const sepIdx = raw.indexOf("/") >= 0 ? raw.indexOf("/") : raw.indexOf(":");
		if (sepIdx >= 0) {
			roomQualifier = norm(raw.slice(0, sepIdx));
			name = raw.slice(sepIdx + 1).trim();
		}
		let candidates = this._byName.get(norm(name)) || [];
		if (roomQualifier) {
			candidates = candidates.filter((c) => norm(this.roomName(c.room) || "") === roomQualifier);
		}
		if (candidates.length === 0) {
			throw new NotFoundError(entry);
		}
		if (candidates.length > 1) {
			throw new AmbiguousNameError(entry, candidates.map((c) => ({ uuid: c.uuid, name: c.name, room: this.roomName(c.room) })));
		}
		return candidates[0];
	}

	_uuidByName(map, name) {
		const n = norm(name);
		return Object.keys(map).find((u) => norm(map[u].name) === n) || null;
	}

	controlsInRoom(roomEntry) {
		// Accept a direct room key (UUID) or a room name; skip non-visualized (empty-type) controls.
		const room = this.rooms[roomEntry] ? roomEntry : this._uuidByName(this.rooms, roomEntry);
		return Object.values(this.controls).filter((c) => c._top && c.type && room && c.room === room);
	}

	controlsInCategory(catEntry) {
		const cat = this.cats[catEntry] ? catEntry : this._uuidByName(this.cats, catEntry);
		return Object.values(this.controls).filter((c) => c._top && c.type && cat && c.cat === cat);
	}

	statesForUuid(stateUuid) {
		return this._stateIndex.get(stateUuid) || [];
	}

	controlsByType(type) {
		return Object.values(this.controls).filter((c) => c._top && c.type === type);
	}

	// Attach an extra named state (from another control) to a control so it is
	// delivered with that control's updates — e.g. feeding an EnergyManager2's
	// SoC into an EFM. Never overrides a state the control already declares.
	linkState(controlUuid, stateName, stateUuid) {
		const c = this.getControl(controlUuid);
		if (!c || typeof stateUuid !== "string") {
			return false;
		}
		c.states = c.states || {};
		if (c.states[stateName]) {
			return false;
		}
		c.states[stateName] = stateUuid;
		if (!this._stateIndex.has(stateUuid)) {
			this._stateIndex.set(stateUuid, []);
		}
		this._stateIndex.get(stateUuid).push({ controlUuid, stateName });
		return true;
	}

	// UUIDs of the controls a composite (e.g. an EFM) is built from: every
	// `details.nodes[].ctrlUuid` walked recursively, plus its subControls.
	// Used to suppress those parts from showing up as their own tiles.
	referencedControlUuids(controlUuid) {
		const out = new Set();
		const c = this.getControl(controlUuid);
		if (!c) {
			return out;
		}
		const walk = (nodes) => {
			(nodes || []).forEach((n) => {
				if (n && typeof n.ctrlUuid === "string") {
					out.add(n.ctrlUuid);
				}
				if (n && Array.isArray(n.nodes)) {
					walk(n.nodes);
				}
			});
		};
		walk((c.details || {}).nodes);
		const subs = c.subControls || {};
		Object.keys(subs).forEach((key) => {
			const s = subs[key];
			out.add((s && (s.uuidAction || s.uuid)) || key);
		});
		return out;
	}

	namedStates(controlUuid, valueByStateUuid) {
		const c = this.getControl(controlUuid);
		if (!c || !c.states) {
			return {};
		}
		const out = {};
		Object.keys(c.states).forEach((stateName) => {
			const su = c.states[stateName];
			const key = Array.isArray(su) ? su[0] : su;
			out[stateName] = valueByStateUuid.has(key) ? valueByStateUuid.get(key) : null;
		});
		return out;
	}
}

module.exports = { Structure, NotFoundError, AmbiguousNameError, looksLikeUuid };
