// The dashboard: what is going on, the runs so far, and, for someone new, the way in: first
// an AI to think with, then a world to start.

import { $, api, clock, el, started } from './page.ts';
import { named, onRuns, runs, type About } from './runs.ts';

interface Ready { kind: string; title: string; local: boolean; there: boolean; account?: string; keys: string[] | null }

let showing = false;
let ready: Ready[] | null = null;   // the AIs that are set up (null: not known yet)

export function openHome(): void {
  showing = true;
  draw();
  // (Asking every AI how it is set up takes a moment: the rest is shown meanwhile.)
  void api<Ready[]>('/api/setup').then(all => {
    ready = all.filter(ai => ai.there && (ai.local || ai.account || ai.keys?.length));
    draw();
  });
}

export function leaveHome(): void {
  showing = false;
}

onRuns(() => draw());

/** A run as a card: its name, what the reviewer wrote, its world and models. */
function card(run: About): HTMLElement {
  const made = el('a', `card${run.going ? ' going' : ''}`,
    el('div', 'name', run.going && el('i', 'dot'), el('b', '', named(run))),
    el('p', '', run.review?.summary ?? (run.going ? 'Going on right now.' : run.ended ?? '')),
    el('div', 'facts', el('span', 'chip', run.title), ...run.models.map(model => el('span', 'chip', model)),
       el('span', 'when', `${started(run.id)} · ${clock(run.seconds)}`)));
  made.href = `#run/${run.id}`;
  return made;
}

function stat(value: string | number, label: string, href?: string): HTMLElement {
  const made = el('a', 'stat', el('b', '', String(value)), el('span', '', label));
  if (href) made.href = href;
  return made;
}

/** The steps for someone new, with what is done ticked off. */
function steps(): HTMLElement {
  const step = (done: boolean, title: string, text: string, href: string, action: string, next: boolean) =>
    el('li', `${done ? 'done' : ''}${next ? ' next' : ''}`, el('span', 'tick', done ? '✓' : ''),
       el('div', '', el('b', '', title), el('p', '', text)),
       !done && action && Object.assign(el('a', next ? 'button main' : 'button', action), { href }));
  const connected = !!ready?.length, started = runs.length > 0;
  return el('section', 'welcome',
    el('h2', '', 'Getting started'),
    el('ol', 'steps',
      step(connected, 'Connect an AI', 'The tinkerlings think with an AI you already use: Claude, ChatGPT, a provider with an API key, or models on this computer.', '#ais', 'Connect an AI', !connected),
      step(started, 'Start a run', 'Pick a world, decide who lives in it and what they are told, and start it.', '#new', 'New run', connected && !started),
      step(false, 'Watch what they do', 'Every run is kept: play it back, see what each tinkerling thought, said and did.', '#new', '', false)));
}

function draw(): void {
  if (!showing) return;
  const going = runs.filter(run => run.going), done = runs.filter(run => !run.going);
  const fresh = ready !== null && (!ready.length || !runs.length);
  $('homeBody').replaceChildren(
    ...(fresh ? [steps()] : []),
    el('div', 'stats',
      stat(going.length, going.length === 1 ? 'run going now' : 'runs going now'),
      stat(runs.length, runs.length === 1 ? 'run so far' : 'runs so far'),
      stat(ready === null ? '…' : ready.length, ready?.length === 1 ? 'AI connected' : 'AIs connected', '#ais')),
    ...(going.length ? [el('h2', '', 'Going now'), el('div', 'cards', ...going.map(card))] : []),
    el('h2', '', 'Runs so far'),
    done.length ? el('div', 'cards', ...done.map(card))
      : el('p', 'empty', 'No run has ended yet. Start one with “New run”: it is kept here, to be played back.'));
}
