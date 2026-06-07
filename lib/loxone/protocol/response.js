"use strict";

function parseLL(input) {
	const json = typeof input === "string" ? JSON.parse(input) : input;
	const ll = (json && (json.LL || json.ll)) || {};
	const codeRaw = ll.Code !== undefined ? ll.Code : ll.code;
	return {
		control: ll.control,
		value: ll.value,
		code: codeRaw !== undefined ? Number(codeRaw) : undefined
	};
}

module.exports = { parseLL };
