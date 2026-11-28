// The programs minds run as (Claude Code, Codex, pi): installed by the person themselves, or by
// Tinkerlings into a folder of its own, from npm. That needs no rights beyond the person's own.

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Where Tinkerlings keeps the AIs: what it installs for them, and what they keep (their logins).
 *  (Beside it, in ~/.tinkerlings, the installer puts Tinkerlings itself: see install.sh.) */
export const HOME = join(homedir(), '.tinkerlings', 'ais');
const TOOLS = join(HOME, 'tools');

/** The script of a program Tinkerlings installed itself, if it did: the one its package names. */
function own(name: string): string | null {
  const read = (path: string) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
  for (const pack of Object.keys(read(join(TOOLS, 'package.json'))?.dependencies ?? {})) {
    const { bin } = read(join(TOOLS, 'node_modules', pack, 'package.json')) ?? {};
    const script = typeof bin === 'string' ? bin : bin?.[name];
    if (script) return join(TOOLS, 'node_modules', pack, script);
  }
  return null;
}

/** Starts a program: Tinkerlings' own copy if it installed one (run by this Node, the same way on
 *  every system), else the one the person has. */
export function start(name: string, args: string[], options: SpawnOptions): ChildProcess {
  const script = own(name);
  return script ? spawn(process.execPath, [script, ...args], options) : spawn(name, args, options);
}

/** Runs a program to its end: what it printed, and how it ended. Not there: `code` is null. */
export function run(name: string, args: string[], { input, env }: { input?: string; env?: Record<string, string> } = {}):
  Promise<{ code: number | null; out: string }> {
  return new Promise(resolve => {
    const child = start(name, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    child.stdout!.on('data', chunk => out += chunk);
    child.stderr!.on('data', chunk => out += chunk);
    child.on('error', () => resolve({ code: null, out }));
    child.on('close', code => resolve({ code, out }));
    child.stdin!.end(input ?? '');
  });
}

/** The version of a program, if it is there. */
export async function version(name: string): Promise<string | null> {
  const { code, out } = await run(name, ['--version']);
  return code === 0 ? out.trim().split('\n').at(-1)!.trim() : null;
}

/** Installs an npm package into Tinkerlings' own folder, with the npm that came with this Node. */
export async function install(pack: string): Promise<void> {
  mkdirSync(TOOLS, { recursive: true });
  // (Beside node on Windows, in lib/ next to bin/ elsewhere.)
  const npm = [join(dirname(process.execPath), 'node_modules'), join(dirname(process.execPath), '..', 'lib', 'node_modules')]
    .map(modules => join(modules, 'npm', 'bin', 'npm-cli.js')).find(existsSync);
  const [command, args] = npm ? [process.execPath, [npm]] : ['npm', []];
  const done = await new Promise<{ code: number | null; out: string }>(resolve => {
    const child = spawn(command, [...args, 'install', '--prefix', TOOLS, '--no-fund', '--no-audit', `${pack}@latest`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', chunk => out += chunk);
    child.stderr.on('data', chunk => out += chunk);
    child.on('error', error => resolve({ code: null, out: String(error) }));
    child.on('close', code => resolve({ code, out }));
  });
  if (done.code !== 0) throw new Error(`Installing ${pack} did not work.\n${done.out.slice(-2000)}`);
}
