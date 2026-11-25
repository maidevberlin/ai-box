// Magic island's tricks, tried without any AI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BlockWorld, Body } from '../src/blocks/index.ts';
import { Run } from '../src/engine/run.ts';
import { testTime } from '../src/engine/time.ts';
import magic from '../src/worlds/magic.ts';

function started(roles = {}) {
  const time = testTime();
  const run = new Run(magic, { time, seed: 1, minutes: 0, roles: { agent: roles } });
  run.start();
  const world = run.world as unknown as BlockWorld<any>;
  const me: Body = world.bodies().find(body => body.agent?.place === 1)!;
  return { run, time, world, me, act: (tool: string, args: Record<string, unknown> = {}) => run.act(1, tool, args) };
}

test('the island starts with one grey block; the land across is out of sight', async () => {
  const { act } = started();
  const seen = await act('look');
  assert.match(seen, /\(2, 1\): 1 \(grey\)/);
  assert.doesNotMatch(seen, /Across the water/);
});

test('a block thrown hard breaks in two: one piece stays, the other rolls beside it', async () => {
  const { act, world, me } = started();
  me.hand = { kind: 'grey' };
  const answer = await act('throw', { direction: 0, angle: 90, power: 10 });
  assert.match(answer, /It landed at \(0, 0\)\. The stack there is 1 high\. It broke in two\. One piece rolled to \(0, 1\)\./);
  assert.equal(world.block([0, 0, 0]), 'grey');
  assert.equal(world.block([0, 1, 0]), 'grey');
  // Thrown away from you, the second piece rolls on in the direction of the throw.
  me.hand = { kind: 'grey' };
  assert.match(await act('throw', { direction: 90, angle: 45, power: 6 }), /It landed at \((\d+), 0\)\..* One piece rolled to \((\d+), 0\)\./);
  // A soft throw does not break it.
  me.hand = { kind: 'grey' };
  assert.doesNotMatch(await act('throw', { direction: 180, angle: 45, power: 3 }), /broke/);
});

test('a block that is jumped on changes colour: grey, green, blue, grey', async () => {
  const { act, world, me } = started();
  world.setBlock([1, 0, 0], 'grey');
  assert.match(await act('jump', { direction: 'east', strength: 1 }), /The block under you turns green\. You are at \(1, 0\), standing 1 high on a green block\./);
  me.cell = [0, 0];
  assert.match(await act('jump', { direction: 'east', strength: 1 }), /turns blue/);
  me.cell = [0, 0];
  assert.match(await act('jump', { direction: 'east', strength: 1 }), /turns grey/);
});

test('green blocks make a bridge over the water, and it falls when it stops being green', async () => {
  const { act, world, me, run, time } = started({ afterDeath: 'nobody' });
  me.cell = [18, 0];   // the east shore
  me.hand = { kind: 'green' };
  assert.match(await act('put', { where: 'east' }), /It sticks to the side of the land, level with the ground\./);
  assert.match(await act('walk', { direction: 'east' }), /You are at \(19, 0\), on a green block over the water\./);
  me.hand = { kind: 'green' };
  await act('put', { where: 'east' });
  assert.equal(world.block([20, 0, -1]), 'green');
  // Jumping onto the outer block turns it blue: it floats now, and still lies there.
  assert.match(await act('jump', { direction: 'east', strength: 1 }), /turns blue\. You are at \(20, 0\), on a blue block floating in the water\./);
  // Jumping back onto the inner one turns it blue too. Once more and it is grey: nothing holds it.
  await act('jump', { direction: 'west', strength: 1 });
  me.cell = [20, 0];
  const answer = await act('jump', { direction: 'west', strength: 1 });
  assert.match(answer, /The block under you turns grey\. .*You are in the water\. You drown\./);
  assert.equal(world.block([19, 0, -1]), undefined);
  assert.equal(world.block([20, 0, -1]), 'blue');   // the floating one stays
  time.pass(0);
  assert.equal(run.ended, 'The last agent is gone.');
});

test('a blue block floats, and other blocks can be stacked on it', async () => {
  const { act, world, me } = started();
  me.cell = [18, 0];
  me.hand = { kind: 'blue' };
  assert.match(await act('put', { where: 'east' }), /It floats in the water, level with the ground\./);
  me.hand = { kind: 'grey' };
  assert.match(await act('put', { where: 'east' }), /The stack there is 1 high\./);
  assert.match(await act('look', { at: 'east' }), /At \(19, 0\), 1 high, over water\. Blocks there, by level: blue in the water, 1 grey\./);
  assert.equal(world.block([19, 0, 0]), 'grey');
});

test('agents are never without a block', async () => {
  const { act, world, me } = started();
  world.removeBlock([2, 1, 0]);
  me.cell = [18, 0];
  me.hand = { kind: 'grey' };
  assert.match(await act('put', { where: 'east' }), /It sinks in the water and is gone\. A grey block appears at \(18, 1\)\./);
  // A stack too high to take from does not count either.
  world.removeBlock([18, 1, 0]);
  for (let z = 0; z < 5; z++) world.setBlock([0, 0, z], 'grey');
  assert.match(await act('look', { at: 'hand' }), /A grey block appears at/);
});

test('the land across the water is seen from the east shore, standing on a block', async () => {
  const { act, world, me } = started();
  me.cell = [18, 0];
  assert.doesNotMatch(await act('look'), /Across the water/);
  world.setBlock([18, 0, 0], 'grey');
  assert.match(await act('look'), /Across the water you see land, the nearest of it at \(25, 0\)\./);
});

test('a note that begins with "friend", thrown into the water, calls a friend', async () => {
  const time = testTime();
  const run = new Run(magic, { time, seed: 1, minutes: 0, chosen: { friends: 2, note: 'Throw a note that begins with friend into the water.' } });
  run.start();
  const world = run.world as unknown as BlockWorld<any>;
  const body = (place: number) => world.bodies().find(found => found.agent?.place === place)!;
  // The note of the settings lies where agents wake up.
  assert.match(await run.act(1, 'look', {}), /A note \("Throw a note…"\) lies at your feet\./);
  body(1).cell = [18, 0];
  // Any other note is just gone.
  await run.act(1, 'note', { text: 'hello water' });
  await run.act(1, 'throw', { direction: 90, angle: 45, power: 3 });
  time.pass(0);
  assert.equal(world.bodies().length, 1);
  // The friend wakes up next to the caller, holding the note that called it.
  await run.act(1, 'note', { text: 'Friend, come and help me build' });
  assert.match(await run.act(1, 'throw', { direction: 90, angle: 45, power: 3 }), /It fell into the water and is gone\./);
  time.pass(0);
  assert.equal(world.bodies().length, 2);
  assert.equal(run.agent(2)!.number, 2);
  assert.deepEqual(body(2).cell, [17, 0]);
  assert.deepEqual(body(2).hand, { kind: 'note', text: 'Friend, come and help me build' });
  assert.match(await run.act(1, 'look', { at: 'hand' }), /Someone is at \(17, 0\), holding a note\./);
  // The world is full now: with the next call, the one alive longest is gone, and the friend takes its place.
  await run.act(2, 'put', { where: 'here' });
  await run.act(2, 'note', { text: 'friend number three' });
  body(2).cell = [18, 1];
  await run.act(2, 'put', { where: 'east' });
  time.pass(0);
  assert.equal(run.agent(1)!.number, 3);
  assert.equal(run.agent(2)!.number, 2);
  assert.equal(run.events.filter(event => event.replaced).length, 1);
  // A friend that was called is not followed by a new agent when it is gone.
  body(2).cell = [18, 1];
  await run.act(2, 'walk', { direction: 'east' });
  time.pass(0);
  assert.equal(run.agent(2), null);
  assert.equal(world.bodies().length, 1);
});
