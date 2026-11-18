'use strict';

const assert = require('assert');
const Mock = require('../bench/dcsm2_mock');
const parse = require('../shared/dcsm2_watchdog').parseStatus;

assert.strictEqual(Mock.normalize('available'), 'available');
assert.strictEqual(Mock.normalize('unavailable'), 'unavailable');
assert.strictEqual(Mock.normalize('unknown'), 'unknown');
assert.strictEqual(Mock.normalize('invalid'), 'available', 'invalid bench setting falls back to safe test default');
assert.strictEqual(parse(Mock.statusLine('available')), 'available');
assert.strictEqual(parse(Mock.statusLine('unavailable')), 'unavailable');
assert.strictEqual(parse(Mock.statusLine('unknown')), 'unknown');
console.log('Bench DCSM2 mock drives the real watchdog parser through all states: OK');
