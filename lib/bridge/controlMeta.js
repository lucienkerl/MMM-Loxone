"use strict";

function toControlMeta(control, structure) {
	const details = control.details || {};
	return {
		id: control.uuid,
		type: control.type,
		name: control.name,
		room: structure.roomName(control.room) || null,
		category: structure.catName(control.cat) || null,
		iconUuid: details.icon || null,
		details
	};
}

module.exports = { toControlMeta };
