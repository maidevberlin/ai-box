// Wild hills, tried without any AI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BlockWorld, Body } from '../src/blocks/index.ts';
import { Run } from '../src/engine/run.ts';
import { testTime } from '../src/engine/time.ts';
import hills from '../src/worlds/hills.ts';

function started(chosen = {}, roles = {}) {
  const time = testTime();
  const run = new Run(hills, { time, seed: 7, minutes: 0, chosen: { rabbits: 0, ...chosen }, roles: { agent: roles } });
  run.start();
  const world = run.world as unknown as BlockWorld<any>;
  const me: Body = world.bodies().find(body => body.agent?.place === 1)!;
  return { run, time, world, me, act: (tool: string, args: Record<string, unknown> = {}) => run.act(1, tool, args) };
}

test('the land has hills, a lake and trees, and looking around shows it as a map', async () => {
  const { act, world } = started();
  const heights = world.disc(13).filter(cell => world.column(cell).length).map(cell => world.height(cell));
  assert.ok(Math.max(...heights) >= 3, 'there are hills');
  assert.ok(world.disc(10).some(cell => !world.column(cell).length), 'there is a lake');
  const seen = await act('look');
  assert.match(seen, /The ground around you, as heights/);
  assert.match(seen, /\[0\]/);
  assert.equal(seen.split('\n').filter(line => /^[ \[\]0-9~T]+$/.test(line)).length, 7);   // sight 3: seven rows
});

test('digging takes the ground away, and it can be put down somewhere else', async () => {
  const { act, world, time } = started({ hunger: false });
  assert.match(await act('dig', { where: 'east' }), /You dug out the ground at \(1, 0\)\. You hold a block of soil now\./);
  assert.equal(world.height([1, 0]), -1);
  assert.equal(await act('dig', { where: 'east' }), 'Your hands are full.');
  assert.match(await act('put', { where: 'west' }), /You put the block down at \(-1, 0\)\./);
  assert.equal(world.height([-1, 0]), 1);
  // Under the grass and soil is stone.
  assert.equal(await act('dig', { where: 'east' }), 'The stone is too hard to dig.');
  assert.match(await act('look', { at: 'east' }), /At \(1, 0\) the ground is 1 deep\. On top is a stone\./);
  // Walking goes up one level, not two.
  assert.match(await act('walk', { direction: 'west' }), /You are at \(-1, 0\), on the ground, 1 high\./);
  world.setBlock([-2, 0, 0], 'soil'); world.setBlock([-2, 0, 1], 'soil'); world.setBlock([-2, 0, 2], 'soil');
  assert.match(await act('walk', { direction: 'west' }), /The ground at \(-2, 0\) rises 2: too steep to walk up\./);
  // Bare soil grows over with grass.
  assert.equal(world.top([-1, 0]), 'soil');
  time.pass(61);
  assert.equal(world.top([-1, 0]), 'grass');
});

test('trees drop fruit, fruit can be eaten, and a fruit left lying grows into a tree', async () => {
  const { act, world, me, time } = started({ trees: 3 });
  const count = () => world.disc(13).reduce((n, cell) => n + world.items(cell).filter(item => item.kind === 'fruit').length, 0);
  assert.equal(count(), 0);
  time.pass(600);
  assert.ok(count() > 0, 'fruit has dropped');
  // (Ten minutes without eating: the agent has starved meanwhile. A new one has woken up.)
  me.hand = { kind: 'fruit' };
  me.has.strength = 5;
  assert.equal(await act('eat'), 'You ate it. You feel stronger.');
  assert.equal(me.has.strength, 11);
  assert.equal(await act('eat'), 'You hold nothing.');
  const before = world.own.trees.size;
  time.pass(400);
  assert.ok(world.own.trees.size > before, 'a fruit has grown into a tree');
});

test('hunger: an agent is told when it is hungry, and dies without food', async () => {
  const { act, run, time } = started({}, { afterDeath: 'nobody' });
  await act('look');
  time.pass(15 * 14);
  assert.match(await act('look', { at: 'hand' }), /You are hungry\./);
  time.pass(15 * 3);
  assert.match(await act('look', { at: 'hand' }), /You are very hungry\. You feel weak\./);
  time.pass(15 * 3 + 1);
  assert.equal(run.ended, 'The last agent is gone.');
  assert.match(String(run.events.find(event => event.type === 'death')!.why), /You have no strength left/);
});

test('rabbits wander and eat fruit', async () => {
  const { world, time } = started({ rabbits: 1, trees: 0, hunger: false });
  const rabbit = world.bodies().find(body => body.creature === 'rabbit')!;
  const at = String(rabbit.cell);
  world.drop({ kind: 'fruit' }, rabbit.cell);
  time.pass(4);
  assert.equal(world.items(rabbit.cell).length, 0);
  time.pass(60);
  assert.notEqual(String(rabbit.cell), at);
});
