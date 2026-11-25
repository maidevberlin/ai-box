// The block base and the engine, tried without any AI: the test acts as the agents.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basic, blockWorld, type BlockWorld, type Body } from '../src/blocks/index.ts';
import { Run, type RunOptions } from '../src/engine/run.ts';
import { testTime } from '../src/engine/time.ts';
import type { Role } from '../src/engine/types.ts';

const agent = (more: Partial<Role> = {}): Role => ({ title: 'Agent', count: 1, model: 'none', knows: '', told: 'Live!', afterDeath: 'new agent', ...more });

/** A strip of land from x = -5 to 5 (y = -1 to 1), water all around, and blocks to try things with. */
const strip = (role: Partial<Role> = {}, make: (world: BlockWorld<any>) => void = () => {}) => blockWorld({
  name: 'strip', title: 'Strip', about: '', settings: {}, minutes: 0,
  roles: () => ({ agent: agent(role) }),
  blocks: {
    ground: { colour: '#0a0', ground: true },
    grey: { colour: '#888' },
    green: { colour: '#0f0', sticky: true },
    blue: { colour: '#00f', floats: true },
    bush: {
      colour: '#060',
      on: { appears: (world, { at }) => world.every(10, () => world.drop({ kind: 'berry' }, [at[0], at[1]]), at) },
    },
  },
  items: { berry: { colour: '#c00', called: 'berry', shape: 'ball' } },
  tools: basic,
  make(world) {
    for (let x = -5; x <= 5; x++) for (let y = -1; y <= 1; y++) world.setBlock([x, y, -1], 'ground');
    make(world);
  },
});

function started(definition: ReturnType<typeof strip>, options: RunOptions = {}) {
  const time = testTime();
  const run = new Run(definition, { time, seed: 1, ...options });
  run.start();
  const act = (tool: string, args: Record<string, unknown> = {}, place = 1) => run.act(place, tool, args);
  return { run, time, act, world: run.world as unknown as BlockWorld<any> };
}
/** Lets what was just asked for begin, before the test goes on. */
const begun = () => new Promise(resolve => setImmediate(resolve));
const me = (world: BlockWorld<any>, place = 1): Body => world.bodies().find(body => body.agent?.place === place)!;

test('looking around says where you are and what is in sight', async () => {
  const { act } = started(strip({}, world => world.setBlock([2, 0, 0], 'grey')));
  const seen = await act('look');
  assert.match(seen, /You are at \(0, 0\), on the ground\./);
  assert.match(seen, /\(2, 0\): 1 \(grey\)/);
  assert.match(seen, /north: 1 step\(s\) of ground left, then water/);
});

test('a walk of several steps stops at the water, a single step goes in', async () => {
  const { act, world, run } = started(strip());
  assert.match(await act('walk', { direction: 'north', steps: 3 }), /You walked a step north and stopped: the next step north is water/);
  assert.deepEqual(me(world).cell, [0, 1]);
  assert.match(await act('walk', { direction: 'north' }), /off the land\. You are in the water\. You drown\./);
  assert.equal(run.events.filter(event => event.type === 'death').length, 1);
});

test('what an agent gives is checked before the world sees it', async () => {
  const { act } = started(strip());
  assert.equal(await act('walk', { direction: 'up' }), `Direction must be one of: ${['north', 'south', 'east', 'west', 'north-east', 'north-west', 'south-east', 'south-west'].join(', ')}.`);
  assert.equal(await act('walk', {}), 'Direction is missing.');
  assert.equal(await act('throw', { direction: 0, angle: 45, power: 11 }), 'Power must be a number from 1 to 10.');
  assert.equal(await act('fly'), 'There is no "fly" here.');
});

test('taking and putting: a block becomes an item in the hand and a block again', async () => {
  const { act, world } = started(strip({}, w => w.setBlock([1, 0, 0], 'grey')));
  assert.match(await act('take', { where: 'east' }), /You took a grey block\./);
  assert.deepEqual(me(world).hand, { kind: 'grey' });
  assert.equal(world.height([1, 0]), 0);
  assert.match(await act('put', { where: 'here' }), /The stack there is 1 high\. You are at \(0, 0\), standing 1 high on a grey block\./);
  assert.equal(await act('take', { where: 'north' }), 'There is nothing to take.');
});

test('a grey block put into the water sinks, a blue one floats and can be walked on', async () => {
  const { act, world } = started(strip());
  me(world).cell = [5, 0];
  me(world).hand = { kind: 'grey' };
  assert.match(await act('put', { where: 'east' }), /It sinks in the water and is gone\./);
  me(world).hand = { kind: 'blue' };
  assert.match(await act('put', { where: 'east' }), /It floats in the water, level with the ground\./);
  assert.match(await act('walk', { direction: 'east' }), /You are at \(6, 0\), on a blue block floating in the water\./);
});

test('a sticky block hangs beside the block you stand on, and holds what is put next to it', async () => {
  const { act, world } = started(strip({}, w => { w.setBlock([0, 0, 0], 'grey'); w.setBlock([0, 0, 1], 'grey'); }));
  me(world).hand = { kind: 'green' };
  assert.match(await act('put', { where: 'east' }), /It sticks there, 2 high, with nothing under it\./);
  assert.equal(world.block([1, 0, 1]), 'green');
  assert.equal(world.block([1, 0, 0]), undefined);
  // ... and a plain block put next to the green one is held by it.
  me(world).cell = [1, 0];
  me(world).hand = { kind: 'grey' };
  await act('put', { where: 'north' });
  assert.equal(world.block([1, 1, 1]), 'grey');
  // Beside a wall it sticks one level above the feet: a step with air below.
  world.setBlock([-1, 0, 0], 'grey'); world.setBlock([-1, 0, 1], 'grey'); world.setBlock([-1, 0, 2], 'grey');
  me(world).cell = [-2, 1];
  me(world).hand = { kind: 'green' };
  await act('put', { where: 'south' });
  assert.equal(world.block([-2, 0, 1]), 'green');
  assert.equal(world.block([-2, 0, 0]), undefined);
});

test('what nothing holds any more falls: a bridge goes down with whoever stands on it', async () => {
  const { act, world, run, time } = started(strip({ afterDeath: 'nobody' }));
  // A bridge of two green blocks over the water, hanging on the shore.
  world.setBlock([6, 0, -1], 'green'); world.setBlock([7, 0, -1], 'green');
  world.settle();
  assert.equal(world.block([7, 0, -1]), 'green');
  me(world).cell = [7, 0];
  // The block that holds it is taken away from the shore side by someone else: here, by the world.
  world.removeBlock([6, 0, -1]);
  const answer = await act('look');
  assert.match(answer, /The ground under you is gone\. You are in the water\. You drown\./);
  assert.equal(world.block([7, 0, -1]), undefined);
  time.pass(0);
  assert.equal(run.ended, 'The last agent is gone.');
});

test('a throw flies a real curve, lands, and is caught by someone with an empty hand', async () => {
  const { act, world } = started(strip({ count: 2 }));
  const [one, two] = [me(world, 1), me(world, 2)];
  one.cell = [-4, 0]; two.cell = [0, 0];
  one.hand = { kind: 'grey' };
  const far = await act('throw', { direction: 90, angle: 45, power: 3 });
  assert.match(far, /You threw the grey block\. It landed at \(-1, 0\)\. The stack there is 1 high\./);
  world.removeBlock([-1, 0, 0]);   // (out of the way of the next throw)
  one.hand = { kind: 'note', text: 'hello you' };
  const caught = await act('throw', { direction: 90, angle: 45, power: 3.5 });
  assert.match(caught, /Someone at \(0, 0\) caught it\./);
  assert.deepEqual(two.hand, { kind: 'note', text: 'hello you' });
  assert.match(await act('look', { at: 'hand' }, 2), /You hold a note\. It says "hello you"\nYou caught a note that someone threw\./);
});

test('what is said is heard in full nearby, in pieces further away, and not at all far off', async () => {
  const far = blockWorld({
    name: 'long', title: '', about: '', settings: {}, minutes: 0, earshot: 5,
    roles: () => ({ agent: agent({ count: 4 }) }),
    blocks: { ground: { colour: '#0a0', ground: true } },
    tools: basic,
    make(world) { for (let x = 0; x <= 40; x++) world.setBlock([x, 0, -1], 'ground'); },
  });
  const { act, world, time } = started(far);
  [0, 3, 9, 30].forEach((x, i) => { me(world, i + 1).cell = [x, 0]; });
  const said = 'come to the tall tower in the east now please';
  assert.equal(await act('say', { text: said }), `You said: "${said}"`);
  assert.equal(await act('wait', { seconds: 1 }, 2), `Someone at (0, 0) says: "${said}"`);
  const pieces = await act('wait', { seconds: 1 }, 3);
  assert.match(pieces, /^Someone at \(0, 0\) says: ".*…/);
  const nothing = act('wait', { seconds: 5 }, 4);
  await begun();
  time.pass(5);
  assert.equal(await nothing, 'Nothing happened.');
});

test('time: a block can ask for something later, and it is called off when the block is gone', async () => {
  const { act, world, time } = started(strip({}, w => w.setBlock([1, 0, 0], 'bush')));
  assert.equal(world.items([1, 0]).length, 0);
  time.pass(10);
  assert.equal(world.items([1, 0]).length, 1);
  time.pass(20);
  assert.equal(world.items([1, 0]).length, 3);
  assert.match(await act('take', { where: 'east' }), /You took a berry\./);
  assert.equal(await act('take', { where: 'east' }), 'Your hands are full.');
  for (let i = 0; i < 2; i++) { me(world).hand = null; await act('take', { where: 'east' }); }
  me(world).hand = null;
  assert.match(await act('take', { where: 'east' }), /You took a bush block\./);
  time.pass(100);
  assert.equal(world.items([1, 0]).length, 0);
});

test('waiting ends when something is noticed, or when the time has passed', async () => {
  const { act, world, time } = started(strip());
  const quiet = act('wait', { seconds: 20 });
  await begun();
  time.pass(20);
  assert.equal(await quiet, 'Nothing happened.');
  const heard = act('wait', { seconds: 20 });
  await begun();
  world.notice(me(world), 'A bell rings.');
  assert.equal(await heard, 'A bell rings.');
});

test('after a death: a new agent, the same one again, or nobody', async () => {
  const drown = { direction: 'north' };
  const fresh = started(strip({ afterDeath: 'new agent' }));
  await fresh.act('walk', drown); await fresh.act('walk', drown);
  fresh.time.pass(0);
  assert.equal(fresh.run.agent(1)!.number, 2);
  assert.deepEqual(me(fresh.world).cell, [0, 0]);

  const same = started(strip({ afterDeath: 'same agent' }));
  await same.act('walk', drown); await same.act('walk', drown);
  same.time.pass(0);
  assert.equal(same.run.agent(1)!.number, 1);
  assert.match(await same.act('look', { at: 'hand' }), /Your hand is empty\.\nYou wake up again\. You are at \(0, 0\), on the ground\./);

  const once = started(strip({ afterDeath: 'new agent', lives: 1 }));
  for (let life = 0; life < 2; life++) { await once.act('walk', drown); await once.act('walk', drown); once.time.pass(0); }
  assert.equal(once.run.ended, 'The last agent is gone.');
});

test('the world ends when its time is up, and the record holds everything', async () => {
  const { act, run, time } = started(strip(), { minutes: 1 });
  await act('look');
  time.pass(61);
  assert.equal(run.ended, "The world's time was up after 1 minutes.");
  assert.deepEqual(run.events.map(event => event.type), ['start', 'wake', 'act', 'end']);
  assert.equal(await act('look'), 'The world has ended.');
});

test('an agent notices what changes in its sight: it ends a wait, and is told once', async () => {
  const { act, world, time } = started(strip({ count: 2 }));
  const [one, two] = [me(world, 1), me(world, 2)];
  one.cell = [-5, 0]; two.cell = [0, 0];
  await act('look', {}, 2);                      // (who never looked has nothing to compare with)
  const waiting = act('wait', { seconds: 30 }, 2);
  await begun();
  await act('walk', { direction: 'east' });      // still out of sight: 4 away, it sees 3
  await act('walk', { direction: 'east' });      // now in sight
  assert.equal(await waiting, 'Someone is at (-3, 0).');
  // Two more steps while the other is busy: it is told where the walker is now, not every step.
  await act('walk', { direction: 'east' }); await act('walk', { direction: 'east' });
  assert.equal(await act('look', { at: 'hand' }, 2), 'Your hand is empty.\nSomeone is at (-1, 0).');
  // What an agent changes itself is no news to it.
  two.hand = { kind: 'grey' };
  await act('put', { where: 'north' }, 2);
  const quiet = act('wait', { seconds: 5 }, 2);
  await begun();
  time.pass(5);
  assert.equal(await quiet, 'Nothing happened.');
  // ... but it is to the other one, who is told with its next answer.
  await act('look', {});
  two.hand = { kind: 'grey' };
  await act('put', { where: 'south' }, 2);
  assert.match(await act('look', { at: 'hand' }), /New in sight: \(0, -1\): 1 \(grey\)\./);  // Looking around shows everything anyway: there the news is not said again.
  two.hand = { kind: 'grey' };
  await act('put', { where: 'east' }, 2);
  const around = await act('look', {});
  assert.match(around, /\(1, 0\): 1 \(grey\)/);
  assert.doesNotMatch(around, /New in sight/);
});
