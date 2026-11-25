// The page: the list of runs, one run played back (the world, a time slider, and what the
// agents thought, said and did), and the screen for starting a world.
//
// A run is played by time, not by steps: the world has a clock of its own, so things
// happen between the agents' actions too.

import type { Event } from '../../engine/run.ts';
import { openCreate } from './create.ts';
import { Film } from './film.ts';
import { $, api, clock, el, started } from './page.ts';
import { PLACE_COLOURS, Scene } from './scene.ts';

interface About {
  id: string; world: string; title: string; minutes: number; models: string[];
  ended: string | null; seconds: number; going: boolean;
  review: { name: string; summary: string } | null;
}

const LIST = 4000;   // how often the list of runs is read again, in milliseconds
const POLL = 1000;   // ... and a run that is going

let about: About | null = null;   // the run on screen
let film = new Film();
let scene: Scene | null = null;
let at = 0;                       // the moment on screen, in seconds since the run started
let shown = -2;                   // the event the picture shows
let playing = false;
let live = false;                 // following a run that is going, at its newest moment
let creating = false;
let speed = 1;
let rows: HTMLElement[] = [];     // the conversation: one row per event that has one
let rowOf: number[] = [];         // ... and for every event, which row shows it (-1: none)

// ---------------------------------------------------------------- the list of runs

let listed = '';
async function listRuns(): Promise<About[]> {
  const runs = await api<About[]>('/api/runs');
  const text = JSON.stringify([runs, about?.id, creating]);
  if (text === listed) return runs;
  listed = text;
  $('runs').replaceChildren(...runs.map(run => {
    const name = el('div', 'name', run.going && el('i', 'dot'), el('span', '', run.review?.name ?? (run.going ? 'Running' : 'No name yet')));
    const facts = el('div', 'facts', el('span', 'chip', run.title), ...run.models.map(model => el('span', 'chip', model)),
                     el('span', 'when', `${started(run.id)} · ${clock(run.seconds)}`));
    const card = el('button', `run${!creating && about?.id === run.id ? ' on' : ''}`, name, facts);
    card.onclick = () => open(run.id);
    return card;
  }));
  return runs;
}

// ---------------------------------------------------------------- one run

async function open(id: string, follow = false): Promise<void> {
  const answer = await api<{ about: About; events: Event[] }>(`/api/runs/${id}`);
  if (!answer.about) return;
  creating = false;
  about = answer.about;
  film = new Film();
  film.add(answer.events);
  rows = []; rowOf = [];
  $('log').replaceChildren();
  scene ??= new Scene($('scene'));
  scene.reset();
  live = follow && about.going;
  playing = live;
  at = live ? film.length : 0;
  shown = -2;
  location.hash = id;
  draw();
  listRuns();
}

/** A row of the conversation for an event, if it gets one. */
function row(event: Event, index: number): HTMLElement | null {
  const who = `Agent ${event.number}`;
  const made = (kind: string, label: string, ...content: (Node | string | null)[]) => {
    const node = el('div', `step ${kind}`, el('div', 'label', label), ...content);
    if (typeof event.place === 'number') node.style.setProperty('--place', `#${PLACE_COLOURS[(event.place - 1) % PLACE_COLOURS.length]!.toString(16).padStart(6, '0')}`);
    node.onclick = () => { at = event.t; playing = live = false; draw(); };
    node.dataset.index = String(index);
    return node;
  };
  switch (event.type) {
    case 'wake': return made('wake', `${who} wakes up${event.again ? ' again, remembering' : ''} · ${event.model}`);
    case 'think': return made('think', `${who} thinks`, el('div', 'text', String(event.text)));
    case 'write': return made('think', `${who} writes · nobody reads it`, el('div', 'text', String(event.text)));
    case 'act': {
      if (event.tool !== 'say') break;
      // Said out loud in the world. What it heard meanwhile comes after its own words.
      const [, ...heard] = String(event.answer).split('\n');
      return made('say', `${who} says out loud`, el('div', 'text', String((event.args as { text?: string }).text ?? '')),
                  heard.length ? el('div', 'heard', heard.join('\n')) : null);
    }
  }
  switch (event.type) {
    case 'act': return made('act', `${who} does`,
      el('div', 'call', `${event.tool}(${Object.entries(event.args as object).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})`),
      el('div', 'text', String(event.answer)));
    case 'death': return made('death', `${who} is gone`, el('div', 'text', String(event.why)));
    case 'error': return made('death', 'A mistake in the world', el('div', 'text', String(event.error)));
    case 'end': return made('stop', 'The world ends', el('div', 'text', String(event.why)));
    default: return null;
  }
}

function draw(): void {
  $('create').hidden = !creating;
  $('stage').hidden = $('side').hidden = creating;
  if (creating || !about) return;
  // The head: the run's name, and what the reviewer wrote about it.
  $('title').replaceChildren(about.review?.name ?? (about.going ? 'Running' : 'No name yet'),
    el('span', 'chip', about.title), ...about.models.map(model => el('span', 'chip', model)), el('span', 'chip', started(about.id)));
  $('summary').textContent = about.review?.summary ?? (about.going ? 'This run gets a name and a summary when it ends.' : about.ended ?? '');
  $('stop').hidden = !about.going;
  // The conversation: rows are only added, never built again.
  for (let i = rowOf.length; i < film.events.length; i++) {
    const made = row(film.events[i]!, i);
    rowOf.push(made ? rows.length : -1);
    if (made) { rows.push(made); $('log').append(made); }
  }
  // The moment on screen.
  // (The very beginning shows the world as it started, before anything happened.)
  const length = Math.max(film.length, 0.001), index = film.events.length ? Math.max(film.indexAt(at), 0) : -1;
  const slider = $('slider') as HTMLInputElement;
  slider.max = String(length);
  slider.value = String(at);
  $('count').textContent = `${clock(at)} / ${clock(length)}`;
  $('play').textContent = playing ? '❚❚' : '▶';
  $('live').hidden = !about.going;
  $('live').classList.toggle('on', live);
  if (index !== shown && index >= 0) {
    const forward = index > shown && index - shown < 20;
    // A throw is played when the film runs onto it, not when jumping around in the run.
    if (forward && playing) {
      for (let i = shown + 1; i <= index; i++) {
        const event = film.events[i]!, data = event.data as { path: number[][]; kind: string } | undefined;
        if (event.type === 'fact' && event.what === 'flight' && data) scene!.throw(data.path, film.at(i).kinds[data.kind]?.colour ?? '#ccc');
      }
    }
    scene!.show(film.at(index), film.bubbles(index, at), !forward);
    // The row of the newest thing that happened is marked, and kept in sight.
    let last = index;
    while (last >= 0 && rowOf[last] === -1) last--;
    $('log').querySelector('.now')?.classList.remove('now');
    const now = last >= 0 ? rows[rowOf[last]!] : undefined;
    if (now) {
      now.classList.add('now');
      const box = $('log');
      if (now.offsetTop < box.scrollTop || now.offsetTop + now.offsetHeight > box.scrollTop + box.clientHeight)
        box.scrollTop = now.offsetTop + now.offsetHeight - box.clientHeight + 12;
    }
    shown = index;
  }
}

// Playing: time goes on. At the end of a run that is going, the film waits for more.
let before = performance.now();
function tick(): void {
  requestAnimationFrame(tick);
  const now = performance.now(), passed = (now - before) / 1000;
  before = now;
  if (!playing || creating || !about || document.hidden) return;
  at = Math.min(at + passed * speed, film.length);
  if (at >= film.length && !about.going) playing = false;
  draw();
}
requestAnimationFrame(tick);

// A run that is going grows: its new events are read every second.
setInterval(async () => {
  if (!about?.going || document.hidden) return;
  const id = about.id;
  const answer = await api<{ about: About; events: Event[] }>(`/api/runs/${id}?from=${film.events.length}`);
  if (about?.id !== id) return;   // another run is on screen by now
  const ended = about.going && !answer.about.going;
  about = answer.about;
  film.add(answer.events);
  if (live) { at = film.length; playing = about.going; }
  if (answer.events.length || ended) draw();
  if (ended) listRuns();
}, POLL);
setInterval(() => document.hidden || listRuns().then(runs => {
  // (The review arrives a moment after the run has ended.)
  const mine = runs.find(run => run.id === about?.id);
  if (mine && about && JSON.stringify(mine.review) !== JSON.stringify(about.review)) { about = { ...about, review: mine.review }; draw(); }
}), LIST);

// ---------------------------------------------------------------- buttons

$('play').onclick = () => {
  if (!about) return;
  if (!playing && at >= film.length && !about.going) at = 0;   // play it again from the start
  playing = !playing;
  live = false;
  draw();
};
$('slider').oninput = event => {
  at = Number((event.target as HTMLInputElement).value);
  playing = live = false;
  draw();
};
$('speed').onchange = event => { speed = Number((event.target as HTMLSelectElement).value); };
$('live').onclick = () => { live = playing = true; at = film.length; draw(); };
$('stop').onclick = () => about && api(`/api/runs/${about.id}/stop`, {});
$('new').onclick = async () => {
  creating = true;
  playing = false;
  draw();
  listRuns();
  await openCreate(id => open(id, true));
};

// Open on the run named in the address, or on the newest one; with no runs, on a new world.
// (#<run id>/<seconds> opens a run at a moment of it.)
const [wanted, moment] = location.hash.slice(1).split('/');
listRuns().then(async runs => {
  const first = runs.find(run => run.id === wanted) ?? runs[0];
  if (!first || wanted === 'new') return $('new').click();
  await open(first.id, first.going && !moment);
  if (moment) { at = Number(moment) || 0; draw(); }
});
