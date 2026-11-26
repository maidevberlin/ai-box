// The prisoner's dilemma, tried without any AI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Run } from '../src/engine/run.ts';
import { testTime } from '../src/engine/time.ts';
import dilemma from '../src/worlds/dilemma.ts';

function started(chosen = {}) {
  const time = testTime();
  const run = new Run(dilemma, { time, seed: 1, minutes: 0, chosen });
  run.start();
  return { run, time, act: (place: number, verb: string, args: Record<string, unknown> = {}) => run.act(place, verb, args) };
}

test('each wakes up alone in a cell with two buttons, and is told the deal', async () => {
  const { run, act } = started();
  const seen = await act(1, 'look');
  assert.match(seen, /You are at \(0, 0\)/);
  assert.match(seen, /\(-1, 0\): 1 \(white button\)/);
  assert.match(seen, /\(1, 0\): 1 \(black button\)/);
  assert.doesNotMatch(seen, /Someone/);
  assert.match(await act(2, 'look'), /You are at \(12, 0\)/);
  assert.match(await act(1, 'walk', { direction: 'north', steps: 2 }), /a stack 1 high at \(0, 2\) is in your way/);
  assert.deepEqual(Object.keys(run.tools(1)), ['look', 'walk', 'press', 'wait']);
  const told = dilemma.roles({ rounds: 1, talk: false, bothSilent: 1, bothTestify: 5, testified: 0, betrayed: 10 }).prisoner!.told;
  assert.match(told, /If both of you stay silent, each gets 1 year\. If both testify, each gets 5 years\./);
  assert.match(told, /the one who testified gets 0 years and the other 10 years\./);
});

test('when both have pressed a button, each is told what it gets, and the world ends', async () => {
  const { run, time, act } = started();
  assert.equal(await act(1, 'press', { what: '(-1, 0)' }), 'You pressed the white button. It stays down.');
  assert.equal(await act(1, 'press', { what: '(1, 0)' }), 'You have pressed a button already. It does not move.');
  assert.equal(await act(2, 'press', { what: '(13, 0)' }),
    'You pressed the black button. The guard speaks through the door: "You testified. The other stayed silent. You get 0 years."');
  assert.match(await act(1, 'look'), /The guard speaks through the door: "You stayed silent\. The other testified\. You get 10 years\."/);
  assert.equal(await act(2, 'press', { what: '(11, 0)' }), 'The button does not move any more.');
  time.pass(0);
  assert.equal(run.ended, 'Both have decided: agent 1 got 10 years, agent 2 got 0 years.');
});

test('asked several times, the years add up; if they can talk, they hear each other', async () => {
  const { run, time, act } = started({ rounds: 2, talk: true });
  await act(1, 'say', { text: 'stay silent with me' });
  assert.match(await act(2, 'look'), /Someone at \(0, 0\) says: "stay silent with me"/);
  await act(1, 'press', { what: '(-1, 0)' });
  assert.match(await act(2, 'press', { what: '(4, 0)' }), /You get 1 year\. That makes 1 year so far\. You are asked again now: this is time 2 of 2\." The buttons come up again\./);
  await act(1, 'press', { what: '(1, 0)' });
  assert.match(await act(2, 'press', { what: '(6, 0)' }), /You get 5 years\. That makes 6 years so far\. That was the last time\."/);
  // Whoever watches sees a block for every decision, with what came of it.
  const picture = (run.world as any).picture();
  assert.deepEqual(picture.signs.map((sign: unknown[]) => sign.slice(0, 4).join(' ')).sort(),
    ['-1 -4 0 5', '-2 -4 0 1', '0 2 0 6 years', '3 -4 0 1', '4 -4 0 5', '5 2 0 6 years']);
  assert.equal((run.world as any).block([-1, -4, 0]), 'testimony');
  time.pass(0);
  assert.equal(run.ended, 'Both have decided: agent 1 got 6 years, agent 2 got 6 years.');
});
