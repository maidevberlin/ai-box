// The viewer: a small web server on this computer, and the page it serves (app/).
// Runs that are started from the page live in this process, in memory, and write their
// record to runs/<id>/. Finished runs are read from there.
//
//   npm start        then open http://127.0.0.1:8765      (PORT=8766 npm start for another port)
//
//   GET  /api/minds             the AIs on this computer (Claude Code, Codex …), with their models
//   GET  /api/setup             every AI there could be: installed? logged in?
//   GET  /api/setup/<ai>/providers           the providers it takes an API key for
//   POST /api/setup/<ai>/install | login | logout     install it, log in to it, log out
//   POST /api/setup/<ai>/key     { provider, key }: keep an API key, and try it
//   POST /api/setup/<ai>/forget  { provider }: forget an API key
//   GET  /api/worlds            the worlds, with their settings, roles and tools
//   GET  /api/worlds/<name>?chosen=<json>   one world's roles and tools with these settings
//   GET  /api/runs              the runs, newest first
//   GET  /api/runs/<id>?from=N  one run: what it is about, and its record from line N on (from 0:
//                               also how what its agents do is shown, and why it cannot go on)
//   POST /api/runs              start a run: { world, chosen, minutes, roles }
//   POST /api/runs/<id>/stop    end a run that is going
//   POST /api/runs/<id>/resume  { minutes }: a run that is over goes on (see Run.goOn)
//   GET  /api/settings          what Tinkerlings keeps, and where
//   POST /api/forget            { what: 'runs' | 'everything' }: delete all runs, or start over

import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { ask, MINDS, minds, populate, usualModel } from '../engine/agents.ts';
import { keepAwake } from '../engine/awake.ts';
import { HOME } from '../engine/programs.ts';
import { Doors } from '../engine/doors.ts';
import { review } from '../engine/review.ts';
import { Run, runId, WAIT, whyNotGoOn, type Event } from '../engine/run.ts';
import { heldTime } from '../engine/time.ts';
import { showing } from '../engine/shown.ts';
import type { WorldDefinition } from '../engine/types.ts';
import { settingsOf, usual } from '../engine/types.ts';
import { WORLDS } from '../worlds/index.ts';

const HERE = import.meta.dirname;
const RUNS = join(HERE, '..', '..', 'runs');
const PORT = Number(process.env.PORT) || 8765;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);   // the only names this page is served under
const RUN_ID = /^\d{8}-\d{6}$/;

const all = Object.fromEntries(WORLDS.map(world => [world.name, world]));
const going = new Map<string, Run>();
const doors = new Doors();
await doors.open();

/** The page's code, put together from app/*.ts when the viewer starts. */
async function app(): Promise<string> {
  const built = await build({ entryPoints: [join(HERE, 'app', 'main.ts')], bundle: true, format: 'esm', write: false,
                              sourcemap: 'inline', target: 'es2022', logLevel: 'silent' });
  return built.outputFiles[0]!.text;
}
let code = await app();

const read = (path: string): any => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

/** What the list of runs shows about one run. */
function about(id: string): Record<string, unknown> | null {
  const live = going.get(id);
  const known = live ? live.about() : read(join(RUNS, id, 'about.json'));
  if (!known) return null;
  // (A run whose viewer was closed while it was going never ended: it is shown as ended.)
  return { ...known, going: !!live && !live.ended, review: read(join(RUNS, id, 'review.json')) };
}

function record(id: string, from: number): Event[] {
  const live = going.get(id);
  if (live) return live.events.slice(from);
  const path = join(RUNS, id, 'record.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(from).map(line => JSON.parse(line));
}

async function start(wish: Record<string, any>): Promise<string | null> {
  const definition = all[wish.world];
  if (!definition) return null;
  // (A role whose model was not chosen gets the usual one of the first AI there is.)
  const model = await usualModel();
  const roles = Object.fromEntries(Object.keys(definition.roles({ ...usual(settingsOf(definition)), ...wish.chosen })).map(name =>
    [name, { ...wish.roles?.[name], model: wish.roles?.[name]?.model || model || undefined }]));
  const id = runId();
  if (going.has(id)) return null;   // one started this very second already
  const folder = join(RUNS, id);
  const run = new Run(definition, { id, folder, chosen: wish.chosen, roles,
                                    minutes: wish.minutes === undefined ? undefined : Number(wish.minutes) });
  peopled(run, folder);
  run.start();
  keepAwake(run);
  return id;
}

/** A run that is going in this process gets its agents, and is reviewed when it ends. */
function peopled(run: Run, folder: string): void {
  going.set(run.id, run);
  populate(run, doors.let(run));
  const [reviewer] = run.about().models as string[];
  if (reviewer) run.listeners.push({ ended: () => void review(run.events, folder, reviewer) });
}

/** Why a run that is over cannot go on. Null: it can. */
function whyNot(id: string): string | null {
  if (going.get(id) && !going.get(id)!.ended) return 'It is going.';
  if (!all[String(about(id)?.world)]) return 'Its world is not there any more.';
  return whyNotGoOn(record(id, 0));
}

/** A run that is over goes on for some more minutes (0: with no time limit): played again from
 *  its record first, so its world is as it was. Says why not, if it cannot. */
const resuming = new Set<string>();
async function goOn(id: string, minutes: number): Promise<string | null> {
  const why = resuming.has(id) ? 'It is going on already.' : whyNot(id);
  if (why) return why;
  resuming.add(id);
  try {
    return await playedAgain(id, minutes);
  } finally {
    resuming.delete(id);
  }
}

async function playedAgain(id: string, minutes: number): Promise<string | null> {
  const events = record(id, 0), known = read(join(RUNS, id, 'about.json')), [start] = events;
  const folder = join(RUNS, id);
  const run = new Run(all[String(start!.world)]!, { id, folder, chosen: start!.chosen as Record<string, unknown>, roles: known.roles,
                                                    seed: Number(start!.seed), began: Number(start!.began), time: heldTime(), minutes: 0 });
  const otherwise = await run.replay(events);
  if (otherwise) return otherwise;
  rmSync(join(folder, 'review.json'), { force: true });   // (it is reviewed again when it ends)
  peopled(run, folder);
  run.goOn(minutes);
  keepAwake(run);
  return null;
}

/** Every AI there could be, and how far it is set up on this computer. */
function setups(): Promise<Record<string, unknown>[]> {
  return Promise.all(Object.entries(MINDS).map(async ([kind, mind]) => ({
    kind, title: mind.title, about: mind.about, site: mind.site, local: !!mind.local,
    installs: !!mind.install, logs: !!mind.login, keys: mind.keys ? await mind.keys.kept() : null,
    ...await mind.setup().catch(() => ({ there: false })),
  })));
}

/** Something done to set up an AI, from the page. */
async function setUp(kind: string, action: string, wish: Record<string, any>): Promise<Record<string, unknown>> {
  const mind = MINDS[kind];
  if (!mind) return { error: 'There is no such AI.' };
  if (action === 'install' && mind.install) {
    await mind.install();
    return { ok: true };
  }
  if (action === 'login' && mind.login) {
    const { url, done } = await mind.login();
    void done;   // (the page asks again until it sees who is logged in)
    return { ok: true, url };
  }
  if (action === 'logout' && mind.logout) {
    await mind.logout();
    return { ok: true };
  }
  if (action === 'key' && mind.keys && wish.provider && wish.key) {
    // Kept, then tried with one short question to one of its models. A key that does not work is forgotten again.
    await mind.keys.keep(wish.provider, wish.key);
    const model = (await mind.providers().catch(() => [])).find(provider => provider.id === wish.provider)?.models[0];
    const tried = model
      ? await Promise.race([ask(`${kind}/${model.id}`, '', 'Answer with the one word: ready'),
                            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No answer within 90 seconds.')), 90_000))])
        .then(() => null, (error: Error) => error.message.trim() || 'It did not answer.')
      : 'pi has no models for this provider.';
    if (tried) await mind.keys.forget(wish.provider);
    return tried ? { error: `The key did not work. ${wish.provider} said: ${tried}` } : { ok: true };
  }
  if (action === 'forget' && mind.keys && wish.provider) {
    await mind.keys.forget(wish.provider);
    return { ok: true };
  }
  return { error: 'That cannot be done.' };
}

/** The runs kept in the runs folder, and the ones going in this process. */
const runIds = () => [...new Set([...(existsSync(RUNS) ? readdirSync(RUNS) : []), ...going.keys()])].filter(found => RUN_ID.test(found));

/** Deletes every run, and with `everything` Tinkerlings' own folder too: its installs, its logins,
 *  the API keys. Not while a run is going: its agents think with what would be deleted. */
function forget(everything: boolean): Record<string, unknown> {
  if ([...going.values()].some(run => !run.ended)) return { error: 'End the runs that are going first.' };
  going.clear();
  for (const id of runIds()) rmSync(join(RUNS, id), { recursive: true, force: true });
  if (everything) rmSync(HOME, { recursive: true, force: true });
  return { ok: true };
}

/** What the start screen shows of a world: with the usual settings, or with the ones chosen so far. */
function shown(world: WorldDefinition<any>, chosen: Record<string, unknown> = {}): Record<string, unknown> {
  const all = { ...usual(settingsOf(world)), ...chosen };
  const tools = Object.entries({ ...world.tools(all), wait: WAIT }).map(([name, tool]) => ({ name, about: tool.about, needed: tool.needed, on: 'on' in tool ? tool.on : undefined }));
  return { name: world.name, title: world.title, about: world.about, settings: settingsOf(world), minutes: world.minutes, ends: world.ends,
           roles: world.roles(all), tools };
}

function send(response: ServerResponse, body: unknown, type = 'application/json', status = 200): void {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': type.startsWith('model') ? 'max-age=86400' : 'no-store' });
  response.end(data);
}

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!HOSTS.has(request.headers.host ?? '')) return send(response, { error: 'not allowed' }, undefined, 403);
  const url = new URL(request.url ?? '/', 'http://x'), path = url.pathname;
  const [, , , id, action] = path.split('/');   // /api/runs/<id>/<action>, /api/worlds/<name>
  if (request.method === 'GET') {
    if (path === '/') return send(response, readFileSync(join(HERE, 'app', 'index.html')), 'text/html; charset=utf-8');
    if (path === '/app.js') {
      if (process.env.DEV) code = await app();   // while working on the page: built again for every load
      return send(response, code, 'text/javascript; charset=utf-8');
    }
    if (path === '/assets/robot.glb') return send(response, readFileSync(join(HERE, 'assets', 'robot.glb')), 'model/gltf-binary');
    if (/^\/assets\/worlds\/[a-z]+\.jpg$/.test(path) && existsSync(join(HERE, path))) return send(response, readFileSync(join(HERE, path)), 'image/jpeg');
    if (path === '/api/minds') return send(response, await minds());
    if (path === '/api/setup') return send(response, await setups());
    if (path.startsWith('/api/setup/') && action === 'providers') return send(response, await MINDS[id ?? '']?.keys?.providers() ?? []);
    if (path === '/api/worlds') return send(response, Object.values(all).map(world => shown(world)));
    if (path.startsWith('/api/worlds/') && all[id ?? ''])
      return send(response, shown(all[id!]!, JSON.parse(url.searchParams.get('chosen') || '{}')));
    if (path === '/api/runs') return send(response, runIds().sort().reverse().map(about).filter(Boolean));
    if (path === '/api/settings') {
      return send(response, { runs: runIds().length, going: [...going.values()].filter(run => !run.ended).length, folder: RUNS, home: HOME });
    }
    if (path.startsWith('/api/runs/') && RUN_ID.test(id ?? '') && about(id!)) {
      const known = about(id!)!, from = Number(url.searchParams.get('from')) || 0, world = all[String(known.world)];
      // (How what the agents do is shown: with the beginning of the record.)
      return send(response, { about: known, from, events: record(id!, from),
                              ...!from && { shown: world && showing(world, (known.chosen ?? {}) as Record<string, unknown>), whyNot: whyNot(id!) } });
    }
    return send(response, { error: 'not found' }, undefined, 404);
  }
  // Only this page may start or end runs, not some other website open in the browser.
  if (request.method !== 'POST' || !HOSTS.has((request.headers.origin ?? '').replace('http://', '')))
    return send(response, { error: 'not allowed' }, undefined, 403);
  let body = '';
  for await (const chunk of request) body += chunk;
  if (path === '/api/runs') {
    const started = await start(JSON.parse(body || '{}'));
    return started ? send(response, { id: started }) : send(response, { error: 'That did not start.' }, undefined, 400);
  }
  if (path === '/api/forget') {
    const done = forget(JSON.parse(body || '{}').what === 'everything');
    return send(response, done, undefined, done.error ? 400 : 200);
  }
  if (path.startsWith('/api/setup/')) {
    const done = await setUp(id ?? '', action ?? '', JSON.parse(body || '{}')).catch((error: Error) => ({ error: error.message }));
    return send(response, done, undefined, done.error ? 400 : 200);
  }
  if (action === 'resume' && RUN_ID.test(id ?? '') && about(id!)) {
    const why = await goOn(id!, Number(JSON.parse(body || '{}').minutes) || 0);
    return why ? send(response, { error: why }, undefined, 400) : send(response, { ok: true });
  }
  if (action === 'stop' && going.get(id ?? '')) {
    going.get(id!)!.end('Ended by hand.');
    return send(response, { ok: true });
  }
  send(response, { error: 'not found' }, undefined, 404);
}

const server = createServer((request, response) => {
  serve(request, response).catch(error => send(response, { error: String(error) }, undefined, 500));
});
server.on('error', () => {
  console.error(`Port ${PORT} is already in use, maybe by another viewer.\nStart this one on another port:  PORT=${PORT + 1} npm start`);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => console.log(`Viewer: http://127.0.0.1:${PORT}   (Ctrl+C to stop)`));
process.on('SIGINT', () => {
  for (const run of going.values()) run.end('Ended by hand.');
  process.exit(0);
});
