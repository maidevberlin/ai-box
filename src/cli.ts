// Runs a world from the command line and prints what happens:
//
//   node src/cli.ts magic                        with the world's usual settings
//   node src/cli.ts magic --minutes 2 --model claude/haiku --agents 2 --set size=small
//
// Without --model, the usual model of the first AI on this computer (see engine/agents.ts).
//
// The record is written to runs/<id>/. The viewer (npm start) does the same from a web page.

import { join } from 'node:path';
import { populate, usualModel } from './engine/agents.ts';
import { keepAwake } from './engine/awake.ts';
import { Doors } from './engine/doors.ts';
import { Run, runId, type Event } from './engine/run.ts';
import { settingsOf } from './engine/types.ts';
import { WORLDS } from './worlds/index.ts';

const [name, ...rest] = process.argv.slice(2);
const all = Object.fromEntries(WORLDS.map(world => [world.name, world]));
const definition = all[name ?? ''];
if (!definition) {
  console.error(`Which world? One of: ${Object.keys(all).join(', ')}`);
  process.exit(1);
}
const options: Record<string, string> = {}, chosen: Record<string, unknown> = {};
for (let i = 0; i < rest.length; i += 2) {
  const [flag, value] = [rest[i]!, rest[i + 1] ?? ''];
  if (flag === '--set') {
    const [key, given] = value.split('=') as [string, string];
    const setting = settingsOf(definition)[key];
    chosen[key] = setting?.type === 'number' ? Number(given) : setting?.type === 'switch' ? given === 'true' : given;
  } else options[flag.replace(/^--/, '')] = value;
}

const model = options.model || await usualModel();
if (!model) {
  console.error('No AI is set up on this computer: neither Claude Code nor Codex answered.');
  process.exit(1);
}
const roles = Object.fromEntries(Object.keys(definition.roles({ ...chosen } as never) ?? {}).map(role => [role, {
  model, ...(options.told ? { told: options.told } : {}), ...(options.agents ? { count: Number(options.agents) } : {}),
}]));
const id = runId();
const run = new Run(definition, {
  id, chosen, roles, folder: join(import.meta.dirname, '..', 'runs', id),
  minutes: options.minutes ? Number(options.minutes) : undefined,
});

const doors = new Doors();
await doors.open();
populate(run, doors.let(run));

const said = (event: Event): string | null => {
  const who = `agent ${event.number}`;
  switch (event.type) {
    case 'wake': return `--- ${who} wakes up${event.again ? ' again' : ''} (${event.model})`;
    case 'think': return `${who} thinks: ${event.text}`;
    case 'write': return `${who} writes: ${event.text}`;
    case 'waits': return `${who} waits for up to ${event.seconds} s`;
    case 'act': return `${who} does ${event.tool}(${JSON.stringify(event.args)})\n    ${String(event.answer).replaceAll('\n', '\n    ')}`;
    case 'senses': return `--- ${who} had stopped talking, and is told what is around it`;
    case 'death': return `--- ${who} ${event.left ? 'has left' : 'died'}: ${event.why}`;
    case 'error': return `!!! ${event.error}`;
    case 'end': return `=== ${event.why}`;
    default: return null;
  }
};
run.listeners.push({
  event(event) {
    const line = said(event);
    if (line) console.log(`[${String(Math.round(event.t)).padStart(4)}s] ${line}`);
  },
  ended() {
    doors.close();
    console.log(`The record is in runs/${id}/`);
  },
});
process.on('SIGINT', () => run.end('Ended by hand.'));
run.start();
keepAwake(run);
