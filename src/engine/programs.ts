// The programs minds run as (Claude Code, Codex, pi): installed by the person themselves, or by
// AI Box into a folder of its own, from npm. That needs no rights beyond the person's own.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Where AI Box keeps what it installs, and what the minds keep (their logins). */
export const HOME = join(homedir(), '.ai-box');
const TOOLS = join(HOME, 'tools');

/** How to start a program: AI Box's own copy if it installed one, else the one the person has. */
export function program(name: string): string {
  const own = join(TOOLS, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
  return existsSync(own) ? own : name;
}

/** Runs a program to its end: what it printed, and how it ended. Not there: `code` is null. */
export function run(name: string, args: string[], { input, env }: { input?: string; env?: Record<string, string> } = {}):
  Promise<{ code: number | null; out: string }> {
  return new Promise(resolve => {
    const child = spawn(program(name), args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', chunk => out += chunk);
    child.stderr.on('data', chunk => out += chunk);
    child.on('error', () => resolve({ code: null, out }));
    child.on('close', code => resolve({ code, out }));
    child.stdin.end(input ?? '');
  });
}

/** The version of a program, if it is there. */
export async function version(name: string): Promise<string | null> {
  const { code, out } = await run(name, ['--version']);
  return code === 0 ? out.trim().split('\n').at(-1)!.trim() : null;
}

/** Installs an npm package into AI Box's own folder, with the npm that came with this Node. */
export async function install(pack: string): Promise<void> {
  mkdirSync(TOOLS, { recursive: true });
  const npm = join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const [command, args] = existsSync(npm) ? [process.execPath, [npm]] : ['npm', []];
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
