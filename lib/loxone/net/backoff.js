"use strict";

function computeBackoff(attempt, maxMs, baseMs) {
	const base = baseMs || 1000;
	const exp = base * Math.pow(2, Math.max(0, attempt - 1));
	return Math.min(maxMs, exp);
}

module.exports = { computeBackoff };
