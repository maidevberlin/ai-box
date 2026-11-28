// The programs minds run as (Claude Code, Codex, pi, Antigravity): installed by the person
// themselves, or by Tinkerlings into a folder of its own, from npm or as its maker publishes it.
// That needs no rights beyond the person's own.

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Where Tinkerlings keeps the AIs: what it installs for them, and what they keep (their logins).
 *  (Beside it, in ~/.tinkerlings, the installer puts Tinkerlings itself: see install.sh.) */
export const HOME = join(homedir(), '.tinkerlings', 'ais');
const TOOLS = join(HOME, 'tools');
/** Where the programs it installs as files go (not from npm). */
const PLACED = join(TOOLS, 'bin');
const placed = (name: string) => join(PLACED, process.platform === 'win32' ? `${name}.exe` : name);

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

/** Whether a file is a script for Node, not a program of its own (some packages put their
 *  program where their script was, once installed). */
function scripted(path: string): boolean {
  const start = readFileSync(path).subarray(0, 64).toString('latin1');
  return /\.[cm]?js$/.test(path) || (start.startsWith('#!') && start.split('\n')[0]!.includes('node'));
}

/** Starts a program: Tinkerlings' own copy if it installed one (a script run by this Node, the
 *  same way on every system, or a program of its own), else the one the person has. */
export function start(name: string, args: string[], options: SpawnOptions): ChildProcess {
  if (existsSync(placed(name))) return spawn(placed(name), args, options);
  const script = own(name);
  if (!script) return spawn(name, args, options);
  return scripted(script) ? spawn(process.execPath, [script, ...args], options) : spawn(script, args, options);
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

/** Installs an npm package into Tinkerlings' own folder, with the npm that came with this Node.
 *  `env`: what its own install script is to know (where its program's home is). */
export async function install(pack: string, env: Record<string, string> = {}): Promise<void> {
  mkdirSync(TOOLS, { recursive: true });
  // (Beside node on Windows, in lib/ next to bin/ elsewhere.)
  const npm = [join(dirname(process.execPath), 'node_modules'), join(dirname(process.execPath), '..', 'lib', 'node_modules')]
    .map(modules => join(modules, 'npm', 'bin', 'npm-cli.js')).find(existsSync);
  const [command, args] = npm ? [process.execPath, [npm]] : ['npm', []];
  const done = await new Promise<{ code: number | null; out: string }>(resolve => {
    const child = spawn(command, [...args, 'install', '--prefix', TOOLS, '--no-fund', '--no-audit', `${pack}@latest`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', chunk => out += chunk);
    child.stderr.on('data', chunk => out += chunk);
    child.on('error', error => resolve({ code: null, out: String(error) }));
    child.on('close', code => resolve({ code, out }));
  });
  if (done.code !== 0) throw new Error(`Installing ${pack} did not work.\n${done.out.slice(-2000)}`);
}

/** Installs a program as its maker publishes it, into Tinkerlings' own folder, as `name`: the
 *  program itself, or packed in a .tar.gz. Only if it is what the maker says it is (`sha512`). */
export async function place(name: string, url: string, sha512: string): Promise<void> {
  const answer = await fetch(url);
  if (!answer.ok) throw new Error(`${name} could not be fetched (${answer.status}).`);
  const bytes = Buffer.from(await answer.arrayBuffer());
  if (createHash('sha512').update(bytes).digest('hex') !== sha512.toLowerCase()) throw new Error(`${name} was not what it should be: it was not installed.`);
  mkdirSync(PLACED, { recursive: true });
  const folder = mkdtempSync(join(PLACED, '.new-'));
  try {
    let program = join(folder, name);
    if (url.endsWith('.tar.gz') || url.endsWith('.tgz')) {
      writeFileSync(join(folder, 'packed.tar.gz'), bytes);
      const unpacked = await new Promise<number | null>(resolve => spawn('tar', ['-xzf', 'packed.tar.gz'], { cwd: folder, stdio: 'ignore' })
        .on('error', () => resolve(null)).on('close', resolve));
      if (unpacked !== 0) throw new Error(`${name} could not be unpacked.`);
      rmSync(join(folder, 'packed.tar.gz'));
      // (The one program in it.)
      const files = readdirSync(folder, { recursive: true, encoding: 'utf8' }).map(file => join(folder, file)).filter(file => statSync(file).isFile());
      if (files.length !== 1) throw new Error(`${name} was not packed as it should be.`);
      program = files[0]!;
    } else {
      writeFileSync(program, bytes);
    }
    chmodSync(program, 0o755);
    renameSync(program, placed(name));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
