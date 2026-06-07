"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Coalescer } = require("../lib/bridge/Coalescer");

function manualScheduler() {
	let fn = null;
	return { set: (f) => { fn = f; return 1; }, clear: () => { fn = null; }, fire: () => { const f = fn; fn = null; if (f) { f(); } }, pending: () => fn !== null };
}

test("coalesces pushes into one flush; latest state per id wins", () => {
	const sched = manualScheduler();
	const flushes = [];
	const c = new Coalescer(250, (b) => flushes.push(b), sched);
	c.push("a", { v: 1 });
	c.push("b", { v: 2 });
	c.push("a", { v: 3 });
	assert.equal(flushes.length, 0);
	sched.fire();
	assert.equal(flushes.length, 1);
	assert.deepEqual(flushes[0].sort((x, y) => (x.id < y.id ? -1 : 1)), [{ id: "a", states: { v: 3 } }, { id: "b", states: { v: 2 } }]);
});

test("empty flush is a no-op; a later push starts a new window", () => {
	const sched = manualScheduler();
	const flushes = [];
	const c = new Coalescer(250, (b) => flushes.push(b), sched);
	c.push("a", { v: 1 });
	sched.fire();
	c.push("a", { v: 2 });
	assert.equal(sched.pending(), true);
	sched.fire();
	assert.equal(flushes.length, 2);
});
