// Agents' names: each has one of its own (unless switched off), the same again when it comes
// back, and a new one for whoever follows it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Event } from '../src/engine/run.ts';
import { Run } from '../src/engine/run.ts';
import { chance, heldTime } from '../src/engine/time.ts';
import { namer } from '../src/engine/names.ts';
import orchard from '../src/worlds/orchard.ts';

const woken = (run: Run) => run.events.filter((event: Event) => event.type === 'wake');

test('every agent has a name of its own, and the same seed gives the same names', () => {
  const names = (seed: number) => {
    const run = new Run(orchard, { time: heldTime(), seed, minutes: 0, roles: { agent: { count: 5 } } });
    run.start();
    return woken(run).map(event => event.name);
  };
  const first = names(3);
  assert.equal(first.length, 5);
  assert.equal(new Set(first).size, 5);
  assert.ok(first.every(name => typeof name === 'string' && /^[A-Z][a-z]+$/.test(name as string)));
  assert.deepEqual(names(3), first);
});

test('switched off, agents have no names', () => {
  const run = new Run(orchard, { time: heldTime(), seed: 3, minutes: 0, chosen: { named: false }, roles: { agent: { count: 2 } } });
  run.start();
  assert.ok(woken(run).every(event => event.name === undefined));
  assert.ok(run.places().every(({ place }) => run.agent(place)!.name === undefined));
});

test('one that comes back keeps its name; one that follows gets a new one', () => {
  for (const dying of [false, true]) {
    const time = heldTime();
    const run = new Run(orchard, { time, seed: 3, minutes: 0, chosen: { dying, followed: true, rabbits: false } });
    run.start();
    const name = run.agent(1)!.name;
    (run as any).gone(1, 'It drowned.', 'died');
    time.pass(0);
    if (dying) assert.notEqual(run.agent(1)!.name, name, 'a new one followed it');
    else assert.equal(run.agent(1)!.name, name, 'it came back');
  }
});

test('names run out only after every one was given, then come again with a number', () => {
  const next = namer(chance(1)), given = Array.from({ length: 30 }, next);
  assert.equal(new Set(given).size, 30);
  assert.ok(given.slice(0, 22).every(name => !/\d/.test(name)));
  assert.match(given[22]!, / 2$/);
});

test('an agent can give itself a name: the picture shows it, nobody else hears of it', async () => {
  const run = new Run(orchard, { time: heldTime(), seed: 3, minutes: 0, chosen: { named: false, rabbits: false } });
  run.start();
  assert.equal(await run.act(1, 'name', { name: 'Sol', what: 'yourself' }), 'You call yourself "Sol" now.');
  assert.match(await run.act(1, 'name', { name: 'yourself', what: 'yourself' }), /cannot be a name/);
  const picture = (run.world as unknown as { picture(): { bodies: { place?: number; itself?: string }[] } }).picture();
  assert.equal(picture.bodies.find(body => body.place === 1)?.itself, 'Sol');
});
