// The runs there are: read again every few seconds, and shown wherever they are listed (the
// side bar, the dashboard). A card of a run looks the same everywhere.

import { api, clock, el, started } from './page.ts';

export interface About {
  id: string; world: string; title: string; minutes: number; models: string[];
  ended: string | null; seconds: number; going: boolean;
  review: { name: string; summary: string } | null;
  chosen?: Record<string, unknown>;
  roles?: Record<string, { title: string; count: number; model: string; told: string; without: string[] }>;
}

const EVERY = 4000;   // how often the runs are read again, in milliseconds

export let runs: About[] = [];
const told: ((runs: About[]) => void)[] = [];

/** `listener` is told the runs whenever they changed, and once now if they are known. */
export function onRuns(listener: (runs: About[]) => void): void {
  told.push(listener);
}

let last = '';
/** Reads the runs again. Listeners are told only if something changed. */
export async function readRuns(): Promise<About[]> {
  const now = await api<About[]>('/api/runs');
  const text = JSON.stringify(now);
  if (text !== last) {
    last = text;
    runs = now;
    for (const listener of told) listener(runs);
  }
  return runs;
}
setInterval(() => document.hidden || void readRuns(), EVERY);

export const named = (run: About) => run.review?.name ?? (run.going ? 'Running' : 'No name yet');

/** A run as a line in a list: its name, its world, its models, when and how long. */
export function runLine(run: About, on: boolean): HTMLElement {
  const line = el('a', `run${on ? ' on' : ''}`,
    el('div', 'name', run.going && el('i', 'dot'), el('span', '', named(run))),
    el('div', 'facts', el('span', 'chip', run.title), ...run.models.map(model => el('span', 'chip', model)),
       el('span', 'when', `${started(run.id)} · ${clock(run.seconds)}`)));
  line.href = `#run/${run.id}`;
  return line;
}
