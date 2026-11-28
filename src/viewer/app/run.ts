// One run played back: the world, a time slider, and what the agents thought, said and did.
//
// A run is played by time, not by steps: the world has a clock of its own, so things
// happen between the agents' actions too.

import type { Event } from '../../engine/run.ts';
import type { Shown } from '../../engine/types.ts';
import type { WorldInfo } from './create.ts';
import { Film } from './film.ts';
import { EVENTS, icon } from './icons.ts';
import { $, api, clock, el, started } from './page.ts';
import { named, onRuns, readRuns, type About } from './runs.ts';
import { PLACE_COLOURS, Scene, type View } from './scene.ts';

const POLL = 1000;   // how often a run that is going is read again, in milliseconds

let about: About | null = null;   // the run on screen
let drawnAbove = '';              // what is over the agents' heads, as it was last drawn
let heard = 0;                    // when it was last read (performance.now())
let film = new Film();
let doings: Record<string, Shown> = {};   // how what its agents do is shown, as its world says
let scene: Scene | null = null;
let at = 0;                       // the moment on screen, in seconds since the run started
let shown = -2;                   // the event the picture shows
let playing = false;
let live = false;                 // following a run that is going, at its newest moment
let showing = false;              // the screen is open
let speed = 1;
let rows: HTMLElement[] = [];     // the conversation: one row per event that has one
let rowOf: number[] = [];         // ... and for every event, which row shows it (-1: none)
let marked: HTMLElement | undefined;   // the row of the moment on screen
let open: 'agents' | 'notes' | null = null;   // the panel on the drawing that is open

/** Opens a run. At `moment` (seconds) if given; else a run that is going is followed live. */
export async function openRun(id: string, moment?: number): Promise<void> {
  showing = true;
  if (about?.id === id && moment === undefined) {   // back to the run that was on screen
    if (about.going) { live = playing = true; at = whole(); }
    return draw();
  }
  const answer = await api<{ about: About; events: Event[]; shown?: Record<string, Shown> }>(`/api/runs/${id}`);
  if (!answer.about) return void (location.hash = '');
  about = answer.about;
  doings = answer.shown ?? {};
  heard = performance.now();
  film = new Film();
  film.add(answer.events);
  rows = []; rowOf = []; folded = new Map(); marked = undefined;
  kept.clear();
  $('log').replaceChildren();
  scene ??= new Scene($('scene'));
  scene.reset();
  live = moment === undefined && about.going;
  playing = live;
  at = moment === undefined ? (live ? whole() : 0) : Math.min(moment, whole());
  shown = -2;
  draw();
}

/** The screen is left: the run stops playing. */
export function leaveRun(): void {
  showing = false;
  playing = live = false;
}

/** The colour of the agent at a place, as the drawing has it. */
const colour = (place: number) => `#${PLACE_COLOURS[(place - 1) % PLACE_COLOURS.length]!.toString(16).padStart(6, '0')}`;

/** The icon of a tool, or of something else that happened (an `Event` type). */
const iconOf = (name: string) => doings[name]?.icon ?? EVENTS[name] ?? 'dot';

/** Where a row stands for an agent's folded doings (see Shown): more of them are added to it
 *  until the agent does something else (says, thinks, waits …), and while it is still one of
 *  the last rows. Further up a new row begins: the conversation never jumps back to an old one. */
interface Folded { row: number; counts: Map<string, number>; line: HTMLElement; calls: HTMLElement }
let folded = new Map<number, Folded>();
const RECENT = 4;   // ... one of this many last rows

/** A row of the conversation, with an icon, its colour the agent's. Clicked, the film goes there. */
function made(event: Event, index: number, kind: string, iconName: string, label: string, ...content: (Node | string | null)[]): HTMLElement {
  const node = el('div', `step ${kind}`, el('div', 'label', iconName ? icon(iconName) : null, label), ...content);
  if (typeof event.place === 'number') node.style.setProperty('--place', colour(event.place));
  node.onclick = () => seek(event.t);
  node.dataset.index = String(index);
  return node;
}

const seek = (t: number) => { at = t; playing = live = false; draw(); };
const call = (event: Event) => `${event.tool}(${Object.entries(event.args as object).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})`;

/** A row of the conversation for an event, if it gets one. */
function row(event: Event, index: number): HTMLElement | null {
  const who = `Agent ${event.number}`;
  switch (event.type) {
    case 'wake': return made(event, index, 'wake', iconOf('wake'), `${who} ${event.called ? 'is called in, and wakes up' : `wakes up${event.again ? ' again, remembering' : ''}`} · ${event.model}`);
    case 'think': return made(event, index, 'think', iconOf('think'), `${who} thinks`, el('div', 'text', String(event.text)));
    case 'write': return made(event, index, 'think', iconOf('write'), `${who} writes · nobody reads it`, el('div', 'text', String(event.text)));
    case 'waits': return made(event, index, 'act', iconOf('wait'), `${who} waits`, el('div', 'call', `for up to ${event.seconds} s`));
    case 'act': {
      const tool = String(event.tool);
      if (tool === 'say') {
        // Said out loud in the world. What it heard meanwhile comes after its own words.
        const [, ...heard] = String(event.answer).split('\n');
        const loud = (event.args as { loudness?: string }).loudness;
        return made(event, index, 'say', iconOf('say'), `${who} ${loud === 'whisper' ? 'whispers' : loud === 'shout' ? 'shouts' : 'says out loud'}`, el('div', 'text', String((event.args as { text?: string }).text ?? '')),
                    heard.length ? el('div', 'heard', heard.join('\n')) : null);
      }
      if (doings[tool]?.folded) return foldedRow(event, index, tool, who);
      return made(event, index, 'act', iconOf(tool), tool === 'wait' ? `${who} stops waiting` : `${who} does`, el('div', 'call', call(event)), el('div', 'text', String(event.answer)));
    }
    // An agent that had stopped talking is told what is around it: its next turn begins.
    case 'senses': return made(event, index, 'act turn', iconOf('senses'), `${who} looks up`,
      el('div', 'turnline', `Turn ${event.turn} · after ${event.after} s of silence`),
      el('div', 'text', String(event.text)));
    case 'death': return made(event, index, 'death', iconOf('death'), event.left ? `${who} has left` : `${who} died`, el('div', 'text', String(event.why)));
    case 'error': return made(event, index, 'death', iconOf('error'), 'A mistake in the world', el('div', 'text', String(event.error)));
    case 'end': return made(event, index, 'stop', iconOf('end'), 'The world ends', el('div', 'text', String(event.why)));
    default: return null;
  }
}

/** A folded doing: "Agent 1 does  walk (3) · look (4)". What each was, and what the world
 *  answered, is folded away in it. */
function foldedRow(event: Event, index: number, tool: string, who: string): HTMLElement {
  const calls = el('div', 'calls'), line = el('span', 'doings');
  const node = made(event, index, 'act folded', '', `${who} does`, el('details', '', el('summary', '', line), calls));
  folded.set(event.place as number, { row: rows.length, counts: new Map(), line, calls });
  addFolded(folded.get(event.place as number)!, event, tool);
  return node;
}

function addFolded(open: Folded, event: Event, tool: string): void {
  open.counts.set(tool, (open.counts.get(tool) ?? 0) + 1);
  open.line.replaceChildren(...[...open.counts].map(([name, count]) => el('span', 'doing', icon(iconOf(name)), `${name}${count > 1 ? ` (${count})` : ''}`)));
  const one = el('div', 'one', el('div', 'call', call(event)), el('div', 'text', String(event.answer)));
  one.onclick = click => { click.stopPropagation(); seek(event.t); };
  open.calls.append(one);
}

/** Sets a text or a property of the page only if it is different: the page is drawn up to
 *  60 times a second while a run plays, and most of the time nothing but the clock moves. */
const kept = new Map<string, string>();
function once(key: string, value: string, set: () => void): void {
  if (kept.get(key) === value) return;
  kept.set(key, value);
  set();
}

/** Draws everything about the run on screen: called when something about the run changed
 *  (another run, more of its record, its review). */
function draw(): void {
  if (!showing || !about) return;
  const run = about;
  // The head: the run's name, and what the reviewer wrote about it.
  once('head', JSON.stringify([run.id, run.review, run.going, run.ended]), () => {
    $('title').replaceChildren(named(run),
      el('span', 'chip', run.title), ...run.models.map(model => el('span', 'chip', model)), el('span', 'chip', started(run.id)));
    $('summary').textContent = run.review?.summary ?? (run.going ? 'This run gets a name and a summary when it ends.' : run.ended ?? '');
    $('stop').hidden = !run.going;
    $('live').hidden = !run.going;
  });
  // The conversation: rows are only added, never built again.
  const added: HTMLElement[] = [];
  for (let i = rowOf.length; i < film.events.length; i++) {
    const event = film.events[i]!, place = event.place as number;
    // A folded doing of an agent whose last row is one of folded doings: counted in there.
    const open = folded.get(place);
    if (event.type === 'act' && doings[String(event.tool)]?.folded && open && rows.length - open.row <= RECENT) {
      addFolded(open, event, String(event.tool));
      rowOf.push(open.row);
      continue;
    }
    const made = row(event, i);
    rowOf.push(made ? rows.length : -1);
    if (!made) continue;
    if (!made.classList.contains('folded') && typeof event.place === 'number') folded.delete(place);
    rows.push(made);
    added.push(made);
  }
  if (added.length) $('log').append(...added);
  drawMoment();
}

/** Draws the moment on screen: the clock, and the world and the marked row if the film has
 *  moved on to another event. Called for every frame while a run plays. */
function drawMoment(): void {
  if (!showing || !about) return;
  // (The very beginning shows the world as it started, before anything happened.)
  const length = Math.max(whole(), 0.001), index = film.events.length ? Math.max(film.indexAt(at), 0) : -1;
  const slider = $('slider') as HTMLInputElement;
  once('length', String(length), () => { slider.max = String(length); });
  slider.value = String(at);
  once('count', `${clock(at)} / ${clock(length)}`, () => { $('count').textContent = `${clock(at)} / ${clock(length)}`; });
  once('play', String(playing), () => { $('play').textContent = playing ? '❚❚' : '▶'; });
  once('live', String(live), () => { $('live').classList.toggle('on', live); $('speed').hidden = live; });
  // (What is over an agent's head goes away after a while, also when nothing else happens.)
  const aboves = index >= 0 ? film.above(index, at, doings) : new Map();
  const above = JSON.stringify([...aboves]);
  if ((index !== shown || above !== drawnAbove) && index >= 0) {
    drawnAbove = above;
    const forward = index >= shown && index - shown < 20;
    // A throw is played when the film runs onto it, not when jumping around in the run.
    if (forward && playing) {
      for (let i = Math.max(shown + 1, 0); i <= index; i++) {
        const event = film.events[i]!, data = event.data as { path: number[][]; kind: string } | undefined;
        if (event.type === 'fact' && event.what === 'flight' && data) scene!.throw(data.path, film.at(i).kinds[data.kind]?.colour ?? '#ccc');
      }
    }
    const view = film.at(index);
    scene!.show(view, aboves, !forward);
    drawFacts(view, index);
    // The row of the newest thing that happened is marked, and kept in sight.
    let last = index;
    while (last >= 0 && rowOf[last] === -1) last--;
    const now = last >= 0 ? rows[rowOf[last]!] : undefined;
    if (now !== marked) marked?.classList.remove('now');
    marked = now;
    if (now) {
      now.classList.add('now');
      const box = $('log');
      if (now.offsetTop < box.scrollTop || now.offsetTop + now.offsetHeight > box.scrollTop + box.clientHeight)
        box.scrollTop = now.offsetTop + now.offsetHeight - box.clientHeight + 12;
    }
    shown = index;
  }
}

/** What is written on the drawing: the agents there have been up to this moment, and the
 *  notes that are in the world now, lying somewhere or held by an agent. Each is a button
 *  that opens a list of them. */
function drawFacts(view: View, index: number): void {
  const agents = agentsUntil(index);
  once('agents', JSON.stringify([agents, view.bodies, open]), () => {
    $('agentsButton').replaceChildren(icon(open === 'agents' ? 'x' : 'users'), `${agents.length} agent${agents.length === 1 ? '' : 's'} so far`);
    $('agentList').hidden = open !== 'agents';
    $('agentList').replaceChildren(...agents.map(agent => {
      const body = view.bodies.find(found => found.number === agent.number && !found.dead);
      const who = el('button', 'who', el('span', 'dot'),
        el('span', 'what', el('b', '', `Agent ${agent.number}`), el('small', '', [agent.model, agent.gone].filter(Boolean).join(' · '))),
        body?.over ? el('span', 'has', icon(body.over.icon), body.over.text) : null);
      who.style.setProperty('--place', colour(agent.place));
      who.disabled = !body;
      who.title = body ? 'Look at it' : '';
      who.onclick = () => body && scene!.centre(body);
      return who;
    }));
  });
  const notes = [
    ...view.items.filter(item => item[4] !== undefined).map(([x, y, , , text]) => ({ where: `at (${x}, ${y})`, text: text! })),
    ...view.bodies.filter(body => body.holds !== undefined).map(body => ({ where: `in the hand of agent ${body.number}`, text: body.holds! })),
  ];
  once('notes', JSON.stringify([notes, open]), () => {
    $('notesButton').replaceChildren(icon(open === 'notes' ? 'x' : 'sticky-note'), `${notes.length} note${notes.length === 1 ? '' : 's'}`);
    $('notes').hidden = open !== 'notes';
    $('notes').replaceChildren(...(notes.length ? notes.map(note =>
      el('div', 'note', el('div', 'where', note.where), el('div', 'text', note.text)))
      : [el('div', 'note', 'There are no notes in the world at this moment.')]));
  });
}

/** The agents that have woken up until an event: the model each thinks with, and whether it
 *  is gone by then. (One that wakes up again, remembering, is the same agent.) */
function agentsUntil(index: number): { number: number; place: number; model: string; gone?: string }[] {
  const agents = new Map<number, { number: number; place: number; model: string; gone?: string }>();
  for (let i = 0; i <= index; i++) {
    const event = film.events[i]!, number = event.number as number;
    if (event.type === 'wake') agents.set(number, { number, place: event.place as number, model: String(event.model ?? '') });
    if (event.type === 'death' && agents.has(number)) agents.get(number)!.gone = event.left ? 'has left' : 'died';
  }
  return [...agents.values()];
}

/** How long the run is, in seconds. A run that is going goes on between the times it is read,
 *  also while nothing happens in it. */
function whole(): number {
  return about?.going ? Math.max(film.length, about.seconds + (performance.now() - heard) / 1000) : film.length;
}

// Playing: time goes on. Followed live, the film is at the run's own time. A run that is going
// grows on screen even while it does not play.
let before = performance.now();
function tick(): void {
  requestAnimationFrame(tick);
  const now = performance.now(), passed = (now - before) / 1000;
  before = now;
  if (!showing || !about || document.hidden) return;
  if (playing) {
    at = live ? whole() : Math.min(at + passed * speed, whole());
    if (at >= whole() && !about.going) playing = false;
  } else if (!about.going) return;
  drawMoment();
}
requestAnimationFrame(tick);

// A run that is going grows: its new events are read every second.
setInterval(async () => {
  if (!showing || !about?.going || document.hidden) return;
  const id = about.id;
  const answer = await api<{ about: About; events: Event[] }>(`/api/runs/${id}?from=${film.events.length}`);
  if (about?.id !== id) return;   // another run is on screen by now
  const ended = about.going && !answer.about.going;
  about = answer.about;
  heard = performance.now();
  film.add(answer.events);
  if (live) { at = whole(); playing = about.going; }
  if (answer.events.length || ended) draw();
  if (ended) void readRuns();
}, POLL);
// (The review arrives a moment after the run has ended.)
onRuns(runs => {
  const mine = runs.find(run => run.id === about?.id);
  if (mine && about && JSON.stringify(mine.review) !== JSON.stringify(about.review)) { about = { ...about, review: mine.review }; draw(); }
});

// ---------------------------------------------------------------- buttons

$('play').onclick = () => {
  if (!about) return;
  if (!playing && at >= whole() && !about.going) at = 0;   // play it again from the start
  playing = !playing;
  live = false;
  draw();
};
$('slider').oninput = event => {
  at = Number((event.target as HTMLInputElement).value);
  playing = live = false;
  draw();
};
for (const panel of ['agents', 'notes'] as const) {
  $(`${panel}Button`).onclick = () => {
    open = open === panel ? null : panel;
    shown = -2;   // (drawn again, with the panel)
    draw();
  };
}
// How the run on screen was set up: its settings, and who lived in it. (What differs from
// what is usual for the world now is marked.)
$('setupButton').onclick = async () => {
  if (!about) return;
  const run = about, world = (await api<WorldInfo[]>('/api/worlds')).find(found => found.name === run.world);
  const said = (value: unknown) => (value === true ? 'on' : value === false ? 'off' : value === '' ? '–' : Array.isArray(value) ? value.join(', ') || '–' : String(value));
  const fact = (title: string, value: unknown, usual?: unknown) =>
    el('div', `fact${usual !== undefined && JSON.stringify(usual) !== JSON.stringify(value) ? ' changed' : ''}`, el('span', '', title), el('b', '', said(value)));
  $('setupTitle').textContent = `${run.title} · ${started(run.id)}`;
  $('setupBody').replaceChildren(
    el('h3', '', 'The world'),
    fact('It ends after', run.minutes ? `${run.minutes} minute${run.minutes === 1 ? '' : 's'}` : 'no time limit', world && (world.minutes ? `${world.minutes} minute${world.minutes === 1 ? '' : 's'}` : 'no time limit')),
    ...Object.entries(run.chosen ?? {}).map(([name, value]) => fact(world?.settings[name]?.title ?? name, value, world?.settings[name]?.usual)),
    ...Object.entries(run.roles ?? {}).flatMap(([name, role]) => {
      // (All of them the same, or each set up on its own.)
      const each = role.each?.length ? role.each.map(own => ({ ...role, ...own })) : [role];
      return [
        el('h3', '', role.title),
        fact('At the start', role.count),
        ...each.flatMap((agent, i) => [
          ...(each.length > 1 ? [el('h4', '', `${role.title} ${i + 1}`)] : []),
          fact('Model', agent.model, world?.roles[name]?.model),
          fact("The world's message to an agent that wakes up", agent.told),
          fact('Cannot', agent.without.join(', ') || 'nothing is switched off', agent.without.length ? null : undefined),
        ]),
      ];
    }));
  ($('runSetup') as HTMLDialogElement).showModal();
};
$('speed').onchange = event => { speed = Number((event.target as HTMLSelectElement).value); };
$('live').onclick = () => { live = playing = true; at = whole(); draw(); };
$('stop').onclick = () => about && api(`/api/runs/${about.id}/stop`, {});
