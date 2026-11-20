import test from 'node:test';
import assert from 'node:assert/strict';
import {startDeadlineClock} from '../src/deadlineClock.ts';

test('clock continues after unchanged rounded ticks and stops on cleanup', t => {
  t.mock.timers.enable({apis: ['Date', 'setInterval'], now: 100000});
  const values = [];
  const stop = startDeadlineClock(Date.now() + 600000, seconds => values.push(seconds));
  t.mock.timers.tick(250);
  assert.deepEqual(values, [600, 600]);
  t.mock.timers.tick(750);
  assert.equal(values.at(-1), 599);
  t.mock.timers.tick(1000);
  assert.equal(values.at(-1), 598);
  stop();
  const count = values.length;
  t.mock.timers.tick(1000);
  assert.equal(values.length, count);
});

test('clock catches up to elapsed wall time and clamps at zero', t => {
  t.mock.timers.enable({apis: ['Date', 'setInterval'], now: 100000});
  const values = [];
  const stop = startDeadlineClock(Date.now() + 600000, seconds => values.push(seconds));
  t.mock.timers.setTime(699000);
  t.mock.timers.tick(250);
  assert.equal(values.at(-1), 1);
  t.mock.timers.tick(1000);
  assert.equal(values.at(-1), 0);
  stop();
});
