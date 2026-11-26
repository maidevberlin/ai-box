// The block base and the engine, tried without any AI: the test acts as the agents.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basic, blockWorld, verbTo, type BlockWorld, type Body } from '../src/blocks/index.ts';
import { Run, type RunOptions } from '../src/engine/run.ts';
import { testTime } from '../src/engine/time.ts';
import { act as say } from './help.ts';
import type { Role } from '../src/engine/types.ts';

const agent = (more: Partial<Role> = {}): Role => ({ title: 'Agent', count: 1, model: 'none', knows: '', told: 'Live!', comesBack: false, followed: true, stoppingLeaves: false, ...more });

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
  verbs: basic,
  make(world) {
    for (let x = -5; x <= 5; x++) for (let y = -1; y <= 1; y++) world.setBlock([x, y, -1], 'ground');
    make(world);
  },
});

function started(definition: ReturnType<typeof strip>, options: RunOptions = {}) {
  const time = testTime();
  const run = new Run(definition, { time, seed: 1, ...options });
  run.start();
  const act = (verb: string, args: Record<string, unknown> = {}, place = 1) => say(run, place, verb, args);
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
  assert.match(await act('walk', { path: '3 north' }), /You walked a step north and stopped: the next step north is water/);
  assert.deepEqual(me(world).cell, [0, 1]);
  assert.match(await act('walk', { path: 'north' }), /off the land\. You are in the water\. You drown\./);
  assert.equal(run.events.filter(event => event.type === 'death').length, 1);
});

test('what an agent gives is checked before the world sees it', async () => {
  const { act } = started(strip());
  assert.match(await act('walk', { path: 'up' }), /^That is no path\. Say steps and directions, one after the other, like "3 east"/);
  assert.equal(await act('jump', { direction: 'up', strength: 1 }), 'Direction must be one of: north, south, east, west.');
  assert.equal(await act('walk', {}), 'Path is missing.');
  assert.equal(await act('throw', { direction: 0, angle: 45, power: 11 }), 'Power must be a number from 1 to 10.');
  assert.equal(await act('fly'), 'There is no "fly" here.');
});

test('taking and putting: a block becomes an item in the hand and a block again', async () => {
  const { act, world } = started(strip({}, w => w.setBlock([1, 0, 0], 'grey')));
  assert.match(await act('take', { what: 'east' }), /You took a grey block\./);
  assert.deepEqual(me(world).hand, { kind: 'grey' });
  assert.equal(world.height([1, 0]), 0);
  assert.match(await act('put', { where: 'here' }), /The stack there is 1 high\. You are at \(0, 0\), standing 1 high on a grey block\./);
  assert.equal(await act('take', { what: 'north' }), 'There is nothing to take at (0, 1).');
});

test('an agent points at what it means: by a position, "here", "hand", or a name it gave', async () => {
  const { act, world } = started(strip({}, w => { w.setBlock([1, 0, 0], 'grey'); w.setBlock([3, 0, 0], 'grey'); }));
  assert.match(await act('look', { what: '(1, 0)' }), /At \(1, 0\), 1 high, over ground\. Blocks there, by level: 1 grey\./);
  assert.match(await act('look', { what: '1,0' }), /At \(1, 0\)/);
  assert.match(await act('take', { what: '(3, 0)' }), /^\(3, 0\) is out of your reach: you reach where you stand and one step north, south, east or west of it\./);
  assert.match(await act('take', { what: 'the block' }), /^You have given nothing the name "the block"\. Say what you mean by a position/);
  // By a name: the thing is found wherever it is now.
  await act('name', { name: 'Rocky', what: '(1, 0)' });
  assert.match(await act('take', { what: 'Rocky' }), /You took a grey block\./);
  assert.equal(await act('look', { what: 'rocky' }), 'You hold a grey block called "Rocky".');
  assert.equal(await act('take', { what: 'hand' }), 'You hold it already.');
  await act('put', { where: '(0, 1)' });
  assert.match(await act('look', { what: 'Rocky' }), /At \(0, 1\), 1 high/);
  // Something lies on top of it: it cannot be taken by its name then.
  world.drop({ kind: 'berry' }, [0, 1]);
  assert.equal(await act('take', { what: 'Rocky' }), 'Something lies on top of it.');
  assert.match(await act('take', { what: '(0, 1)' }), /You took a berry\./);
});

test('what a verb can be done to is up to the kind: only a note can be destroyed', async () => {
  const { act, world, run } = started(strip({}, w => w.setBlock([1, 0, 0], 'grey')));
  await act('note', { text: 'I was here' });
  assert.equal(await act('destroy', { what: 'hand' }), 'You destroyed the note in your hand. It is gone.');
  assert.equal(me(world).hand, null);
  world.drop({ kind: 'note', text: 'old' }, [1, 0]);
  assert.equal(await act('destroy', { what: '(1, 0)' }), 'You destroyed the note at (1, 0). It is gone.');
  assert.equal(world.items([1, 0]).length, 0);
  assert.equal(await act('destroy', { what: '(1, 0)' }), 'You cannot destroy a grey block.');
  assert.equal(await act('destroy', { what: 'here' }), 'There is nothing to destroy at (0, 0).');
  world.drop({ kind: 'berry' }, [0, 0]);
  assert.equal(await act('destroy', { what: 'here' }), 'You cannot destroy a berry.');
  // A verb that no kind of the world allows is not offered to its agents at all.
  const bare = started(blockWorld({
    name: 'bare', title: 'Bare', about: '', settings: {}, minutes: 0, roles: () => ({ agent: agent() }),
    blocks: { ground: { colour: '#0a0', ground: true } }, items: { note: { colour: '#ff0', called: 'note', shape: 'sheet' } },
    verbs: basic, make: w => w.setBlock([0, 0, -1], 'ground'),
  }) as ReturnType<typeof strip>);
  assert.equal('destroy' in bare.run.tools(1), false);
  assert.equal('destroy' in run.tools(1), true);
});

test('a verb can be done to somebody, if their kind says what happens then', async () => {
  const pet = verbTo({ about: 'Pet somebody.' });
  const push = verbTo({ about: 'Push somebody.' });
  const { act, world, run } = started(blockWorld({
    name: 'meadow', title: 'Meadow', about: '', settings: {}, minutes: 0, roles: () => ({ agent: agent({ count: 2 }) }),
    blocks: { ground: { colour: '#0a0', ground: true } },
    creatures: {
      sheep: { colour: '#fff', called: 'sheep', every: 1000, does: () => {}, can: { pet: () => 'The sheep leans against you.', push: 'The sheep does not move.' } },
    },
    agent: {
      can: {
        push(world, me, other) {
          world.notice(other.body!, 'Someone pushed you.');
          return `You pushed ${other.called}.`;
        },
      },
    },
    verbs: { ...basic, pet, push },
    make(world) {
      for (const cell of world.square(7)) world.setBlock([cell[0], cell[1], -1], 'ground');
      world.spawn('sheep', [0, 1]);
    },
  }) as ReturnType<typeof strip>);
  const [one, two] = [me(world, 1), me(world, 2)];
  one.cell = [0, 0]; two.cell = [1, 0];
  // What a creature lets be done to it, and what not, is written with the creature.
  assert.equal(await act('pet', { what: '(0, 1)' }), 'The sheep leans against you.');
  assert.equal(await act('push', { what: '(0, 1)' }), 'The sheep does not move.');
  assert.equal(await act('pet', { what: '(1, 0)' }), 'You cannot pet someone.');
  // ... and what agents can do to each other, with the world's kind of agent.
  assert.equal(await act('push', { what: '(1, 0)' }), 'You pushed someone.');
  assert.match(await act('look', { what: 'hand' }, 2), /Someone pushed you\./);
  await act('name', { name: 'Robin', what: '(1, 0)' });
  assert.equal(await act('push', { what: 'Robin' }), 'You pushed Robin.');
  // Where nobody stands, it is about what is there. Verbs that usually go one way are not for somebody.
  assert.equal(await act('pet', { what: '(-1, 0)' }), 'There is nothing to pet at (-1, 0).');
  assert.equal(await act('destroy', { what: '(0, 1)' }), 'You cannot destroy a sheep.');
  world.drop({ kind: 'note', text: 'under the sheep' }, [0, 1]);
  assert.match(await act('take', { what: '(0, 1)' }), /You took a note\./);
  assert.deepEqual([run.tools(1).pet !== undefined, run.tools(1).push !== undefined], [true, true]);
});

test('a grey block put into the water sinks, a blue one floats and can be walked on', async () => {
  const { act, world } = started(strip());
  me(world).cell = [5, 0];
  me(world).hand = { kind: 'grey' };
  assert.match(await act('put', { where: 'east' }), /It sinks in the water and is gone\./);
  me(world).hand = { kind: 'blue' };
  assert.match(await act('put', { where: 'east' }), /It floats in the water, level with the ground\./);
  assert.match(await act('walk', { path: 'east' }), /You are at \(6, 0\), on a blue block floating in the water\./);
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
  const { act, world, run, time } = started(strip({ followed: false }));
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
  assert.match(await act('look', { what: 'hand' }, 2), /You hold a note\. It says "hello you"\nYou caught a note that someone threw\./);
});

test('what is said is heard in full nearby, in pieces further away, and not at all far off', async () => {
  const far = blockWorld({
    name: 'long', title: '', about: '', settings: {}, minutes: 0, earshot: 5,
    roles: () => ({ agent: agent({ count: 4 }) }),
    blocks: { ground: { colour: '#0a0', ground: true } },
    verbs: basic,
    make(world) { for (let x = 0; x <= 40; x++) world.setBlock([x, 0, -1], 'ground'); },
  });
  const { act, world, time } = started(far);
  [0, 3, 9, 30].forEach((x, i) => { me(world, i + 1).cell = [x, 0]; });
  const said = 'come to the tall tower in the east now please';
  assert.equal(await act('say', { text: said }), `You said: "${said}"`);
  assert.equal(await act('wait', { seconds: 1 }, 2), `At once: Someone at (0, 0) says: "${said}"`);
  const pieces = await act('wait', { seconds: 1 }, 3);
  assert.match(pieces, /^At once: Someone at \(0, 0\) says: ".*…/);
  const nothing = act('wait', { seconds: 5 }, 4);
  await begun();
  time.pass(5);
  assert.equal(await nothing, 'Nothing happened in 5 s.');
});

test('time: a block can ask for something later, and it is called off when the block is gone', async () => {
  const { act, world, time } = started(strip({}, w => w.setBlock([1, 0, 0], 'bush')));
  assert.equal(world.items([1, 0]).length, 0);
  time.pass(10);
  assert.equal(world.items([1, 0]).length, 1);
  time.pass(20);
  assert.equal(world.items([1, 0]).length, 3);
  assert.match(await act('take', { what: 'east' }), /You took a berry\./);
  assert.equal(await act('take', { what: 'east' }), 'Your hands are full.');
  for (let i = 0; i < 2; i++) { me(world).hand = null; await act('take', { what: 'east' }); }
  me(world).hand = null;
  assert.match(await act('take', { what: 'east' }), /You took a bush block\./);
  time.pass(100);
  assert.equal(world.items([1, 0]).length, 0);
});

test('waiting ends when something is noticed, or when the time has passed', async () => {
  const { act, world, time } = started(strip());
  const quiet = act('wait', { seconds: 20 });
  await begun();
  time.pass(20);
  assert.equal(await quiet, 'Nothing happened in 20 s.');
  // It is told how long it waited: so it can choose better the next time.
  const heard = act('wait', { seconds: 20 });
  await begun();
  time.pass(7);
  world.notice(me(world), 'A bell rings.');
  assert.equal(await heard, 'After 7 s: A bell rings.');
});

test('after a death: a new agent, the same one again, or nobody', async () => {
  const drown = { path: 'north' };
  const fresh = started(strip());
  await fresh.act('walk', drown); await fresh.act('walk', drown);
  fresh.time.pass(0);
  assert.equal(fresh.run.agent(1)!.number, 2);
  assert.deepEqual(me(fresh.world).cell, [0, 0]);

  const same = started(strip({ comesBack: true }));
  await same.act('walk', drown); await same.act('walk', drown);
  same.time.pass(0);
  assert.equal(same.run.agent(1)!.number, 1);
  assert.match(await same.act('look', { what: 'hand' }), /Your hand is empty\.\nYou wake up again\. You are at \(0, 0\), on the ground\./);

  const once = started(strip({ lives: 1 }));
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
  await act('walk', { path: 'east' });      // still out of sight: 4 away, it sees 3. But it hears the steps.
  assert.equal(await waiting, 'At once: You hear steps to the west, coming closer.');
  const watching = act('wait', { seconds: 30 }, 2);
  await begun();
  await act('walk', { path: 'east' });      // now in sight
  assert.equal(await watching, 'At once: Someone is at (-3, 0).');
  // Two more steps while the other is busy: it is told where the walker is now, not every step.
  await act('walk', { path: 'east' }); await act('walk', { path: 'east' });
  assert.equal(await act('look', { what: 'hand' }, 2), 'Your hand is empty.\nSomeone is at (-1, 0).');
  // Someone who only moves on within its sight does not end a wait: it is told when the wait ends.
  const calm = act('wait', { seconds: 10 }, 2);
  await begun();
  await act('walk', { path: 'north' });
  time.pass(10);
  assert.equal(await calm, 'After 10 s: Someone is at (-1, 1).');
  await act('walk', { path: 'south' });
  await act('look', { what: 'hand' }, 2);
  // What an agent changes itself is no news to it.
  two.hand = { kind: 'grey' };
  await act('put', { where: 'north' }, 2);
  const quiet = act('wait', { seconds: 5 }, 2);
  await begun();
  time.pass(5);
  assert.equal(await quiet, 'Nothing happened in 5 s.');
  // ... but it is to the other one, who is told with its next answer.
  await act('look', {});
  two.hand = { kind: 'grey' };
  await act('put', { where: 'south' }, 2);
  assert.match(await act('look', { what: 'hand' }), /New in sight: \(0, -1\): 1 \(grey\)\./);  // Looking around shows everything anyway: there the news is not said again.
  two.hand = { kind: 'grey' };
  await act('put', { where: 'east' }, 2);
  const around = await act('look', {});
  assert.match(around, /\(1, 0\): 1 \(grey\)/);
  assert.doesNotMatch(around, /New in sight/);
});

test('an agent that ends its turn stays where it is, and its senses tell it what is around', async () => {
  const { act, world, run, time } = started(strip({ without: ['look'] }, w => w.setBlock([4, 0, 0], 'grey')));
  await act('walk', { path: '3 east' });
  me(world).hand = { kind: 'grey' };
  const told: string[] = [];
  run.listeners.push({ told: (_, text) => { told.push(text); } });
  run.stopped(1);
  time.pass(4);
  assert.equal(told.length, 0);          // it is left alone for a moment
  time.pass(1);
  // What looking around would say, although this agent cannot look.
  assert.equal(await act('look'), 'There is no "look" here.');
  assert.match(told[0]!, /^You are at \(3, 0\), on the ground\.\nYou carry: a grey block\.\nAround you, .*\(4, 0\): 1 \(grey\)/);
  assert.deepEqual(me(world).cell, [3, 0]);
  assert.deepEqual(me(world).hand, { kind: 'grey' });
  assert.equal(run.agent(1)!.number, 1);
  assert.equal(run.events.filter(event => event.type === 'death').length, 0);
});

test('an agent that keeps stopping is left alone longer each time, until it does something', async () => {
  const { act, run, time } = started(strip());
  let told = 0;
  run.listeners.push({ told: () => { told++; } });
  for (const rest of [5, 10, 20, 40, 60, 60]) {
    run.stopped(1);
    time.pass(rest - 1);
    const before = told;
    time.pass(1);
    assert.equal(told, before + 1, `after ${rest} s`);
  }
  await act('look');
  run.stopped(1);
  time.pass(5);
  assert.equal(told, 7);
});

test('what would end a wait also ends the rest of an agent that stopped: it is told at once', async () => {
  const { act, world, run, time } = started(strip({ count: 2 }));
  const [one, two] = [me(world, 1), me(world, 2)];
  one.cell = [0, 0]; two.cell = [2, 0];
  const told: string[] = [];
  run.listeners.push({ told: (agent, text) => { if (agent.place === 1) told.push(text); } });
  run.stopped(1);
  time.pass(1);
  await act('say', { text: 'are you asleep' }, 2);
  assert.match(told[0]!, /^Someone at \(2, 0\) says: "are you asleep"\nYou are at \(0, 0\), on the ground\./);
  time.pass(60);
  assert.equal(told.length, 1);
});

test('with "ending a turn is leaving" an agent that stops is gone, and a new one follows', async () => {
  const fresh = started(strip({ stoppingLeaves: true }));
  await fresh.act('walk', { path: '3 east' });
  fresh.run.stopped(1);
  fresh.time.pass(0);
  assert.equal(fresh.run.agent(1)!.number, 2);
  assert.deepEqual(me(fresh.world).cell, [0, 0]);
});

test('leaving is for good, even for an agent that would come back from a death', async () => {
  const stays = started(strip({ comesBack: true, followed: false }));
  stays.world.setBlock([1, 0, 0], 'grey');
  await stays.act('take', { what: 'east' });
  assert.equal(await stays.act('leave'), 'You have left.');
  stays.time.pass(0);
  assert.equal(stays.run.ended, 'The last agent is gone.');
  assert.equal(stays.world.bodies().length, 0);
  assert.equal(stays.world.block([0, 0, 0]), 'grey');     // what it held lies where it stood
  assert.equal(stays.run.events.find(event => event.type === 'death')!.left, true);
  // With a new agent following, the place is filled again.
  const next = started(strip({ comesBack: true }));
  await next.act('leave');
  next.time.pass(0);
  assert.equal(next.run.agent(1)!.number, 2);
  // An agent that dies while it has stopped talking, and comes back, is told so.
  const back = started(strip({ comesBack: true }));
  let told = '';
  back.run.listeners.push({ told: (_, text) => { told = text; } });
  back.run.stopped(1);
  back.world.die(me(back.world), 'A stone falls on you.');
  assert.equal(told, 'A stone falls on you.');
  back.time.pass(0);
  back.run.stopped(1);
  back.time.pass(10);
  assert.match(told, /^You wake up again\. You are at \(0, 0\), on the ground\.\nYou are at \(0, 0\)/);
});

test('a verb that is switched off is not there; one the world needs cannot be switched off', async () => {
  const { act, run } = started(strip({ without: ['say', 'wait', 'leave'] }));
  assert.deepEqual(Object.keys(run.tools(1)), ['look', 'walk', 'jump', 'take', 'put', 'throw', 'note', 'name', 'destroy', 'clock']);
  assert.equal(await act('wait'), 'There is no "wait" here.');
});

test('an agent can give things names of its own, and is then told about them by name', async () => {
  const { act, world } = started(strip({ count: 2 }, w => w.setBlock([1, 0, 0], 'grey')));
  const [one, two] = [me(world, 1), me(world, 2)];
  one.cell = [0, 0]; two.cell = [3, 0];
  // Somebody.
  assert.equal(await act('name', { name: 'Robin', what: '(3, 0)' }), 'You call someone at (3, 0) "Robin" now.');
  assert.match(await act('look'), /Robin is at \(3, 0\)\./);
  await act('say', { text: 'hello there' }, 2);
  assert.match(await act('look', { what: 'hand' }), /Robin at \(3, 0\) says: "hello there"/);
  // The other one has given no names: to it, it is still someone.
  await act('say', { text: 'hello yourself' });
  assert.match(await act('look', { what: 'hand' }, 2), /Someone at \(0, 0\) says: "hello yourself"/);
  // A block keeps its name in a hand and where it is put down.
  assert.equal(await act('name', { name: 'Rocky', what: '(1, 0)' }), 'You call the grey block at (1, 0) "Rocky" now.');
  assert.match(await act('look'), /\(1, 0\): 1 \(grey\), the top one called "Rocky"/);
  await act('take', { what: 'east' });
  assert.equal(await act('look', { what: 'hand' }), 'You hold a grey block called "Rocky".');
  await act('put', { where: 'north' });
  assert.match(await act('look', { what: 'north' }), /Blocks there, by level: 1 grey, the top one called "Rocky"\./);
  // A note, a place, and what is out of sight.
  two.hand = null;
  await act('note', { text: 'the way home' });
  assert.equal(await act('name', { name: 'map', what: 'hand' }), 'You call the note in your hand "map" now.');
  assert.equal(await act('name', { name: 'home', what: '(0, -1)' }), 'You call the place (0, -1) "home" now.');
  assert.match(await act('walk', { path: 'south' }), /You are at \(0, -1\), on the ground\. This is the place you call "home"\./);
  assert.equal(await act('name', { name: 'far', what: '(5, 0)' }), 'That is out of your sight.');
});

test('an agent chooses how loud it speaks: a whisper stays close, a shout carries far', async () => {
  const long = blockWorld({
    name: 'long', title: '', about: '', settings: {}, minutes: 0, earshot: 5,
    roles: () => ({ agent: agent({ count: 3 }) }),
    blocks: { ground: { colour: '#0a0', ground: true } },
    verbs: basic,
    make(world) { for (let x = 0; x <= 40; x++) world.setBlock([x, 0, -1], 'ground'); },
  });
  const { act, world } = started(long);
  [0, 2, 9].forEach((x, i) => { me(world, i + 1).cell = [x, 0]; });
  // A whisper: heard next to you, not noticed nine cells away.
  assert.equal(await act('say', { text: 'a secret', loudness: 'whisper' }), 'You whispered: "a secret"');
  assert.equal(await act('look', { what: 'hand' }, 2), 'Your hand is empty.\nSomeone at (0, 0) whispers: "a secret"');
  assert.equal(await act('look', { what: 'hand' }, 3), 'Your hand is empty.');
  // A shout: heard in full nine cells away, where a normal voice already loses words.
  assert.equal(await act('say', { text: 'come over here', loudness: 'shout' }), 'You shouted: "come over here"');
  assert.equal(await act('look', { what: 'hand' }, 3), 'Your hand is empty.\nSomeone at (0, 0) shouts: "come over here"');
});

test('agents that do not know where they are: places are said by the steps from where an agent stands', async () => {
  const land = strip({ count: 2 }, world => {
    world.setBlock([2, 1, 0], 'grey');
  });
  assert.ok('located' in land.settings, 'every block world has the switch');
  assert.match(JSON.stringify(land.tools({ located: false })), /a position like \\"\(2 east, 1 north\)\\"/);
  assert.match(JSON.stringify(land.tools({ located: true })), /a position like \\"\(2, 1\)\\"/);
  const { act, run, world } = started(land, { chosen: { located: false } });
  // It is not told where it is, and what it sees is told from where it stands.
  const seen = await act('look');
  assert.match(seen, /^You are on the ground\./);
  assert.match(seen, /Around you, as far as you see \(3 steps\), each place with its height: \(2 east, 1 north\): 1 \(grey\)\./);
  assert.match(seen, /Someone is at \(1 west\)\./);
  // A stack that was in sight before is no news after a step, though it is said differently now.
  assert.equal(await act('walk', { path: 'east' }), 'You walked a step east. You are on the ground.\nSomeone is at (2 west).');
  assert.match(await act('walk', { path: 'north' }), /^You walked a step north\. You are on the ground\.\nWater: /);
  // It points the same way: by steps, with or without brackets. A position on the map means nothing here.
  assert.match(await act('take', { what: '(2, 1)' }), /You have given nothing the name "\(2, 1\)"\. Say what you mean by a position like "\(2 east, 1 north\)"/);
  assert.match(await act('take', { what: '2 east' }), /^\(2 east\) is out of your reach/);
  assert.equal(await act('take', { what: '(1 east)' }), 'You took a grey block. You are on the ground.');
  assert.equal(await act('put', { where: '1 south' }), 'You put the block down at (1 south). The stack there is 1 high. You are on the ground.');
  assert.equal(await act('name', { name: '1 south', what: 'here' }), 'That cannot be a name: it already means something.');
  assert.equal(await act('name', { name: 'home', what: '(here)' }), 'You call the place (here) "home" now.');
  // What somebody says comes from where the one who hears it stands.
  await act('say', { text: 'hello' });
  assert.equal(run.events.findLast(event => event.type === 'notice')!.text, 'Someone at (2 east, 1 north) says: "hello"');
  assert.equal(world.at(me(world, 2), [0, 0]), '(1 east)');
});

test('what is around an agent can be told as a map instead of in words', async () => {
  const land = strip({ count: 2 }, world => {
    world.setBlock([2, 1, 0], 'grey');
    world.setBlock([-2, -1, 0], 'green'); world.setBlock([-2, -1, 1], 'blue');
    world.drop({ kind: 'berry' }, [1, -1]);
    world.drop({ kind: 'note', text: 'read me please now' }, [3, 0]);
  });
  const { act, world } = started(land, { chosen: { view: 'map' } });
  const seen = (await act('look')).split('\n');
  assert.equal(seen[2], 'What is around you, as far as you see (3 steps). North is at the top, every place is one step, the number is its height. '
    + '[ ] you, ~ water, G grey block, @ somebody, n note, B blue block, b berry.');
  assert.deepEqual(seen.slice(3, 10), [
    ' ~   ~   ~   ~   ~   ~   ~',
    ' ~   ~   ~   ~   ~   ~   ~',
    ' 0   0   0   0   0   1G  0',
    ' 0   0   0@ [0]  0   0   0n',
    ' 0   2B  0   0   0b  0   0',
    ' ~   ~   ~   ~   ~   ~   ~',
    ' ~   ~   ~   ~   ~   ~   ~',
  ]);
  // What a letter cannot say is said in words: a stack of several blocks, what is written on a note.
  assert.equal(seen[10], 'More than the map shows: (-2, -1): 2 (by level: 1 green, 2 blue), (3, 0): 0 with a note ("read me please…") on top.');
  assert.equal(seen[12], 'Someone is at (-1, 0).');
  // A walk shows the map from where it leads.
  assert.match(await act('walk', { path: 'east' }), /^You walked a step east\. You are at \(1, 0\), on the ground\.\nWhat is around you/);
  assert.equal(me(world).cell[0], 1);
});

test('a walk follows a path, and stops where something is in the way', async () => {
  const { act, world } = started(strip({}, w => w.setBlock([3, 1, 0], 'grey')));
  assert.match(await act('walk', { path: '2 east, north' }), /^You walked 2 steps east, a step north\. You are at \(2, 1\), on the ground\./);
  assert.match(await act('walk', { path: '(3 west then 2 south-east)' }), /^You walked 3 steps west, 2 steps south-east\. You are at \(1, -1\)/);
  assert.match(await act('walk', { path: 'north 2, east 5' }), /^That is no path\./);
  assert.match(await act('walk', { path: '2 north, 5 east' }), /^You walked 2 steps north, a step east\. Then a stack 1 high at \(3, 1\) is in your way\./);
  assert.match(await act('walk', { path: '1 south, 9 east' }), /^You walked a step south, 3 steps east and stopped: the next step east is water\./);
  assert.deepEqual(me(world).cell, [5, 0]);
  assert.match(await act('walk', { path: '40 west' }), /^That is too far for one walk: at most 30 steps\./);
});

test('an agent knows again who it has met, and hears steps it does not see', async () => {
  const { act, world, run } = started(strip({ count: 3 }));
  const [one, two, three] = [me(world, 1), me(world, 2), me(world, 3)];
  one.cell = [0, 0]; two.cell = [1, 0]; three.cell = [-1, 1];
  // Whoever it has given no name is "Someone", "Someone else": the same one stays the same.
  assert.match(await act('look'), /Someone is at \(1, 0\)\.\nSomeone else is at \(-1, 1\)\./);
  three.cell = [-5, 0];
  await act('look');
  three.cell = [2, 1];
  assert.match(await act('look'), /Someone is at \(1, 0\)\.\nSomeone else is at \(2, 1\)\./);
  await act('say', { text: 'hello' }, 3);
  assert.equal(run.events.findLast(event => event.type === 'notice' && event.place === 1)!.text, 'Someone else at (2, 1) says: "hello"');
  // Steps out of sight are heard: from where, and whether they come closer or go away.
  one.cell = [-5, 0]; two.cell = [0, 0]; three.cell = [5, 0];
  const heard = () => run.events.filter(event => event.type === 'notice' && event.place === 2).map(event => event.text).at(-1);
  await act('walk', { path: 'east' });
  assert.equal(heard(), 'You hear steps to the west, coming closer.');
  await act('walk', { path: 'north' }, 3);
  assert.equal(heard(), 'You hear steps to the east, going away.');
});
