// How what agents do is shown to a person who watches: as the tools say, unless the world
// says otherwise. And what a world puts over an agent's head.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Picture } from '../src/blocks/world.ts';
import { Run } from '../src/engine/run.ts';
import { showing } from '../src/engine/shown.ts';
import { heldTime } from '../src/engine/time.ts';
import { usual, type Settings } from '../src/engine/types.ts';
import { drawing, EVENTS } from '../src/viewer/app/icons.ts';
import { WORLDS } from '../src/worlds/index.ts';
import orchard from '../src/worlds/orchard.ts';

const exists = (name: string) => drawing(name) !== undefined;

test('every doing is shown as its tool says, and the run\'s own doings too', () => {
  const shown = showing(orchard, {});
  assert.deepEqual(shown.walk, { icon: 'footprints' });
  assert.deepEqual(shown.say, { icon: 'message-circle', standsOut: true, overHead: true });
  assert.equal(shown.look!.overHead, true);
  assert.deepEqual(shown.wait, { icon: 'hourglass', overHead: true });
  assert.equal(shown.think!.icon, 'brain');
});

test('a world can show a doing differently, and only in what it says', () => {
  const shown = showing({ ...orchard, shown: { look: { overHead: false }, think: { icon: 'cloud' } } }, {});
  assert.deepEqual(shown.look, { icon: 'eye', overHead: false });
  assert.deepEqual(shown.think, { icon: 'cloud', overHead: true });
});

test('in the orchard, an agent\'s strength is over its head while hunger takes it', () => {
  for (const hunger of [true, false]) {
    const run = new Run(orchard, { time: heldTime(), seed: 1, minutes: 0, chosen: { hunger }, roles: { agent: {} } });
    run.start();
    const over = (run.world as unknown as { picture(): Picture }).picture().bodies.find(body => body.place === 1)!.over;
    assert.deepEqual(over, hunger ? { icon: 'zap', text: '20/20' } : undefined);
    if (over) assert.ok(exists(over.icon), over.icon);
  }
});

test('every icon a world or the run names is one there is', () => {
  for (const name of Object.values(EVENTS)) assert.ok(exists(name), name);
  for (const world of WORLDS) {
    // (Its tools with the usual settings, and with each switch the other way: some bring tools.)
    const switches = Object.entries(world.settings as Settings).filter(([, setting]) => setting.type === 'switch');
    for (const chosen of [{}, ...switches.map(([name]) => ({ [name]: !usual(world.settings)[name] }))]) {
      for (const [doing, shown] of Object.entries(showing(world, chosen))) assert.ok(exists(shown.icon), `${world.name}: ${doing} (${shown.icon})`);
    }
  }
});
