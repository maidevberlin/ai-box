// A run that ended goes on: it is played again from its record, exactly as it went, and then
// goes on in real time with the agents that were alive.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Run, whyNotGoOn, type Event } from '../src/engine/run.ts';
import { heldTime } from '../src/engine/time.ts';
import type { Agent } from '../src/engine/types.ts';
import orchard from '../src/worlds/orchard.ts';

const chosen = { hunger: true, rabbits: true };

/** A run in the orchard where two agents look, walk, dig and wait a while, ended by hand. */
async function went(): Promise<Run> {
  const time = heldTime();
  const run = new Run(orchard, { time, seed: 11, minutes: 0, chosen, roles: { agent: { count: 2 } }, began: Date.UTC(2026, 10, 28, 9) });
  run.start();
  const at = async (seconds: number, place: number, tool: string, args: Record<string, unknown> = {}) => {
    await time.catchUp(seconds);   // (in real time, nothing else happens at the very same moment)
    return run.act(place, tool, args);
  };
  run.session(1, 'one');
  run.session(2, 'two');
  await at(1.5, 1, 'look');
  await at(3.25, 2, 'walk', { to: '(2, 1)' });
  await at(4, 1, 'dig', { what: '(1, 0)' });
  await time.catchUp(9);
  const waiting = run.act(2, 'wait', { seconds: 20 });
  await time.catchUp(40);
  await waiting;
  run.stopped(1);
  await time.catchUp(131);
  void run.act(2, 'wait', { seconds: 60 });   // (still waiting when it ends)
  await time.catchUp(140);
  run.end('Ended by hand.');
  return run;
}

const again = (run: Run) => new Run(orchard, { time: heldTime(), seed: 11, minutes: 0, chosen, roles: { agent: { count: 2 } }, began: Date.UTC(2026, 10, 28, 9) });

test('played again, a run goes exactly as it went, up to where it ended', async () => {
  const run = await went();
  assert.equal(whyNotGoOn(run.events), null);
  const replayed = again(run);
  assert.equal(await replayed.replay(run.events), null);
  // (Without its end, and without the wait that was still going then.)
  const end = run.events.findIndex(event => event.type === 'end');
  const kept = run.events.slice(0, end).filter(event => !(event.type === 'waits' && event.t > 130));
  assert.deepEqual(replayed.events.map(event => event.type), kept.map(event => event.type));
});

test('a world that works otherwise now cannot go on', async () => {
  const run = await went();
  const changed: Event[] = run.events.map(event => (event.type === 'act' && event.tool === 'look' ? { ...event, answer: 'Something else.' } : event));
  assert.match(await again(run).replay(changed) ?? '', /went otherwise than before after 2 s \(act look\)/);
});

test('it goes on with the agents that were alive, each told the world goes on', async () => {
  const run = await went();
  const replayed = again(run);
  await replayed.replay(run.events);
  const resumed: [Agent, string][] = [];
  replayed.listeners.push({ resumed: (agent, _role, told) => resumed.push([agent, told]) });
  replayed.goOn(5);
  try {
    assert.deepEqual(resumed.map(([agent]) => agent.place), [1, 2]);
    assert.ok(resumed.every(([, told]) => told.startsWith('The world goes on.')));
    assert.equal(replayed.left(), 300);
    assert.equal(replayed.events.filter(event => event.type === 'resume').length, 1);
    // (Played again later, it goes on there again.)
    const later = again(run);
    assert.equal(await later.replay(replayed.events), null);
  } finally {
    replayed.end('Ended by hand.');
  }
});

test('only a run that ended by hand or in time, whose agents keep their sessions, can go on', async () => {
  const run = await went();
  const ended = (how: string) => run.events.map(event => (event.type === 'end' ? { ...event, how } : event));
  assert.equal(whyNotGoOn(ended('time')), null);
  assert.match(whyNotGoOn(ended('world'))!, /came to an end/);
  assert.match(whyNotGoOn(run.events.filter(event => event.type !== 'session'))!, /Not every tinkerling/);
  assert.match(whyNotGoOn(run.events.map(event => (event.type === 'start' ? { ...event, seed: undefined } : event)))!, /before runs could go on/);
});
