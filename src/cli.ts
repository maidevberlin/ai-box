// Runs a world from the command line and prints what happens:
//
//   node src/cli.ts island                       with the world's usual settings
//   node src/cli.ts island --minutes 2 --model haiku --set size=12 --set agents=2
//
// The record is written to runs/<id>/. The viewer (npm start) does the same from a web page.

import { join } from 'node:path';
import { populate } from './engine/agents.ts';
import { Doors } from './engine/doors.ts';
import { Run, runId, type Event } from './engine/run.ts';
import { worlds } from './worlds/index.ts';

const [name, ...rest] = process.argv.slice(2);
const all = await worlds();
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
    const setting = definition.settings[key];
    chosen[key] = setting?.type === 'number' ? Number(given) : setting?.type === 'switch' ? given === 'true' : given;
  } else options[flag.replace(/^--/, '')] = value;
}

const roles = Object.fromEntries(Object.keys(definition.roles({ ...chosen } as never) ?? {}).map(role => [role, {
  ...(options.model ? { model: options.model } : {}), ...(options.told ? { told: options.told } : {}),
}]));
const id = runId();
const run = new Run(definition, {
  id, chosen, roles, folder: join(import.meta.dirname, '..', 'runs', id),
  minutes: options.minutes ? Number(options.minutes) : undefined,
  agents: options.agents ? Number(options.agents) : undefined,
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
    case 'act': return `${who} does ${event.tool}(${JSON.stringify(event.args)})\n    ${String(event.answer).replaceAll('\n', '\n    ')}`;
    case 'death': return `--- ${who} is gone: ${event.why}`;
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
