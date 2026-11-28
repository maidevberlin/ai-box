// While a run is going, the computer stays awake: a world's time is real time, and a computer
// that sleeps would stop its agents in the middle while the world's time goes on.
// On a Mac that is `caffeinate`; elsewhere the computer is left to itself.

import { spawn, type ChildProcess } from 'node:child_process';
import type { Run } from './run.ts';

let keeping: ChildProcess | null = null;
const going = new Set<Run>();

/** Keeps the computer awake until the run has ended (and every other run too). */
export function keepAwake(run: Run): void {
  if (process.platform !== 'darwin' || run.ended) return;
  going.add(run);
  run.listeners.push({ ended() {
    going.delete(run);
    if (!going.size) { keeping?.kill(); keeping = null; }
  } });
  // (-i: no idle sleep. -w: it ends by itself when this process does.)
  keeping ??= spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }).on('error', () => { keeping = null; });
}
