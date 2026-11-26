// The viewer: a small web server on this computer, and the page it serves (app/).
// Runs that are started from the page live in this process, in memory, and write their
// record to runs/<id>/. Finished runs are read from there.
//
//   npm start        then open http://127.0.0.1:8765      (PORT=8766 npm start for another port)
//
//   GET  /api/worlds            the worlds, with their settings, roles and tools
//   GET  /api/worlds/<name>?chosen=<json>   one world's roles and tools with these settings
//   GET  /api/runs              the runs, newest first
//   GET  /api/runs/<id>?from=N  one run: what it is about, and its record from line N on
//   POST /api/runs              start a run: { world, chosen, minutes, roles }
//   POST /api/runs/<id>/stop    end a run that is going

import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { populate } from '../engine/agents.ts';
import { Doors } from '../engine/doors.ts';
import { review } from '../engine/review.ts';
import { Run, runId, WAIT, type Event } from '../engine/run.ts';
import type { WorldDefinition } from '../engine/types.ts';
import { usual } from '../engine/types.ts';
import { worlds } from '../worlds/index.ts';

const HERE = import.meta.dirname;
const RUNS = join(HERE, '..', '..', 'runs');
const PORT = Number(process.env.PORT) || 8765;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);   // the only names this page is served under
const RUN_ID = /^\d{8}-\d{6}$/;

const all = await worlds();
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

function start(wish: Record<string, any>): string | null {
  const definition = all[wish.world];
  if (!definition) return null;
  const id = runId();
  if (going.has(id)) return null;   // one started this very second already
  const folder = join(RUNS, id);
  const run = new Run(definition, { id, folder, chosen: wish.chosen, roles: wish.roles,
                                    minutes: wish.minutes === undefined ? undefined : Number(wish.minutes) });
  going.set(id, run);
  populate(run, doors.let(run));
  run.listeners.push({ ended: () => void review(run.events, folder) });
  run.start();
  return id;
}

/** What the start screen shows of a world: with the usual settings, or with the ones chosen so far. */
function shown(world: WorldDefinition<any>, chosen: Record<string, unknown> = {}): Record<string, unknown> {
  const all = { ...usual(world.settings), ...chosen };
  const tools = Object.entries({ ...world.tools(all), wait: WAIT }).map(([name, tool]) => ({ name, about: tool.about, needed: tool.needed, on: 'on' in tool ? tool.on : undefined }));
  return { name: world.name, title: world.title, about: world.about, settings: world.settings, minutes: world.minutes,
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
    if (path === '/api/worlds') return send(response, Object.values(all).map(world => shown(world)));
    if (path.startsWith('/api/worlds/') && all[id ?? ''])
      return send(response, shown(all[id!]!, JSON.parse(url.searchParams.get('chosen') || '{}')));
    if (path === '/api/runs') {
      const ids = new Set([...(existsSync(RUNS) ? readdirSync(RUNS) : []), ...going.keys()]);
      return send(response, [...ids].filter(found => RUN_ID.test(found)).sort().reverse().map(about).filter(Boolean));
    }
    if (path.startsWith('/api/runs/') && RUN_ID.test(id ?? '') && about(id!))
      return send(response, { about: about(id!), from: Number(url.searchParams.get('from')) || 0,
                              events: record(id!, Number(url.searchParams.get('from')) || 0) });
    return send(response, { error: 'not found' }, undefined, 404);
  }
  // Only this page may start or end runs, not some other website open in the browser.
  if (request.method !== 'POST' || !HOSTS.has((request.headers.origin ?? '').replace('http://', '')))
    return send(response, { error: 'not allowed' }, undefined, 403);
  let body = '';
  for await (const chunk of request) body += chunk;
  if (path === '/api/runs') {
    const started = start(JSON.parse(body || '{}'));
    return started ? send(response, { id: started }) : send(response, { error: 'That did not start.' }, undefined, 400);
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
