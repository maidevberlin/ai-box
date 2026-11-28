// One run played back: the world, a time slider, and what the agents thought, said and did.
//
// A run is played by time, not by steps: the world has a clock of its own, so things
// happen between the agents' actions too.

import type { Event } from '../../engine/run.ts';
import type { Shown } from '../../engine/types.ts';
import { logo, makerOf } from './brands.ts';
import { startLike, type WorldInfo } from './create.ts';
import { Film } from './film.ts';
import { EVENTS, icon } from './icons.ts';
import { $, api, clock, el, started } from './page.ts';
import { named, onRuns, readRuns, type About } from './runs.ts';
import { PLACE_COLOURS, Scene, type Above, type View } from './scene.ts';

const POLL = 1000;   // how often a run that is going is read again, in milliseconds

let about: About | null = null;   // the run on screen
let whyNot: string | null = null;  // why it cannot go on, once it is over (null: it can)
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
let rows: { t: number; node: HTMLElement }[] = [];   // the conversation: a row for every event that has one
let read = 0;                     // the events there are rows for already
let written = new Map<string, { who: string; place: number; t: number }>();   // who wrote a note first, by its words
let open: 'notes' | null = null;   // the panel on the drawing that is open

/** Opens a run. At `moment` (seconds) if given; else a run that is going is followed live. */
export async function openRun(id: string, moment?: number): Promise<void> {
  showing = true;
  if (about?.id === id && moment === undefined) {   // back to the run that was on screen
    if (about.going) { live = playing = true; at = whole(); }
    return draw();
  }
  const answer = await api<{ about: About; events: Event[]; shown?: Record<string, Shown>; whyNot: string | null }>(`/api/runs/${id}`);
  if (!answer.about) return void (location.hash = '');
  about = answer.about;
  whyNot = answer.whyNot;
  doings = answer.shown ?? {};
  heard = performance.now();
  film = new Film();
  film.add(answer.events);
  rows = []; read = 0; names.clear(); written = new Map();
  kept.clear();
  $('side').replaceChildren();
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

/** A row of the conversation, with an icon, its colour the agent's. */
function made(event: Event, kind: string, iconName: string, label: string, ...content: (Node | string | null)[]): HTMLElement {
  const node = el('div', `step ${kind}`, el('div', 'label', icon(iconName), label), ...content);
  if (typeof event.place === 'number') node.style.setProperty('--place', colour(event.place));
  return node;
}

/** What the viewer calls an agent: its name, if it has one; else its number. */
const names = new Map<number, string>();
function nameOf(event: Event): string {
  if (event.type === 'wake' && event.name) names.set(event.number as number, String(event.name));
  return names.get(event.number as number) ?? `Tinkerling ${event.number}`;
}

/** A row of the conversation for an event, if it gets one: what is thought and said, and what
 *  stands out (see Shown). Whatever else is done is seen in the world. */
function row(event: Event): HTMLElement | null {
  const who = nameOf(event);
  switch (event.type) {
    case 'wake': return made(event, 'wake', iconOf('wake'), `${who} ${event.called ? 'is called in, and wakes up' : `wakes up${event.again ? ' again, remembering' : ''}`}`);
    case 'think': return made(event, 'think', iconOf('think'), `${who} thinks`, el('div', 'text', String(event.text)));
    case 'write': return made(event, 'think', iconOf('write'), `${who} writes · nobody reads it`, el('div', 'text', String(event.text)));
    case 'act': {
      const tool = String(event.tool), args = event.args as Record<string, unknown>;
      if (!doings[tool]?.standsOut) return null;
      if (tool === 'say') {
        const loud = args.loudness;
        return made(event, 'say', iconOf('say'), `${who} ${loud === 'whisper' ? 'whispers' : loud === 'shout' ? 'shouts' : 'says'}`, el('div', 'text', String(args.text ?? '')));
      }
      // (What it did, in the world's own words: the first line of its answer.)
      return made(event, 'act', iconOf(tool), `${who} · ${tool}`, el('div', 'text', String(event.answer).split('\n')[0]!));
    }
    case 'death': return made(event, 'death', iconOf('death'), event.left ? `${who} has left` : `${who} died`, el('div', 'text', String(event.why)));
    case 'end': return made(event, 'stop', iconOf('end'), 'The world ends', el('div', 'text', String(event.why)));
    case 'resume': return made(event, 'stop', iconOf('resume'), 'The world goes on');
    default: return null;
  }
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
  // The head: the run's name, and an (i) for what there is to know about it (see showInfo).
  once('head', JSON.stringify([run.id, run.review, run.going, run.ended, whyNot, infoOpen]), () => {
    const name = el('span', 'named', named(run)), info = el('button', `info${infoOpen ? ' on' : ''}`, icon('info'));
    info.title = 'About this run';
    name.onclick = info.onclick = () => { infoOpen = !infoOpen; draw(); };
    $('title').replaceChildren(name,
      el('span', 'chip', run.title), ...run.models.map(model => el('span', 'chip', model)), el('span', 'chip', started(run.id)), info);
    void showInfo(run);
    $('stop').hidden = !run.going;
    $('live').hidden = !run.going;
    const goOn = $('goOn') as HTMLButtonElement;
    goOn.hidden = run.going;
    goOn.disabled = !!whyNot;
    goOn.title = whyNot ?? 'Let the world go on from where it ended';
  });
  // The conversation: rows are only added, never built again.
  const added: HTMLElement[] = [];
  for (; read < film.events.length; read++) {
    const event = film.events[read]!, node = row(event);
    const words = event.type === 'act' && event.tool === 'note' ? String((event.args as { text?: string }).text ?? '').slice(0, 1000) : null;
    if (words !== null && !written.has(words)) written.set(words, { who: nameOf(event), place: event.place as number, t: event.t });
    if (!node) continue;
    rows.push({ t: event.t, node });
    added.push(node);
  }
  if (added.length) $('side').append(...added);
  drawMoment();
}

/** Draws the moment on screen: the clock, the conversation, and the world if the film has
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
    drawFacts(view, index, aboves);
    shown = index;
  }
  drawConversation();
}

/** The conversation at the moment on screen: what happened in the last while, the newest at
 *  the bottom, each fading out as it gets older. The while is longer when the film runs faster,
 *  so there is time to read. Earlier things are found by going back on the time line. */
const LINGER = 12;   // seconds (at 1×)
const FADING = 3;    // ... the last of which it fades out
const MOST = 6;      // rows at most
function drawConversation(): void {
  const linger = LINGER * (live ? 1 : speed), fading = FADING * (live ? 1 : speed);
  let shownRows = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const { t, node } = rows[i]!, age = at - t;
    const on = age >= 0 && age < linger && shownRows < MOST;
    if (on) shownRows++;
    const opacity = on ? String(Math.round(Math.min(1, (linger - age) / fading) * 20) / 20) : '';
    if (node.classList.contains('on') !== on) node.classList.toggle('on', on);
    if (node.style.opacity !== opacity) node.style.opacity = opacity;
  }
}

/** What is written on the drawing: a legend of the agents that are alive at this moment
 *  (their colour, whose model, their name, what they did last, whether they are talking, and what their world puts over
 *  them), and a button for the notes that are in the world now, lying somewhere or held by an
 *  agent, that opens a list of them. Clicking an agent of the legend centres the view on it. */
function drawFacts(view: View, index: number, aboves: Map<number, Above>): void {
  const agents = new Map(agentsUntil(index).map(agent => [agent.number, agent]));
  const last = film.lastDoing(index);
  const alive = view.bodies.filter(body => body.number !== undefined && !body.dead && agents.has(body.number));
  const legend = alive.map(body => ({ body, agent: agents.get(body.number!)!, doing: last.get(agents.get(body.number!)!.place) }));
  const talks = (place: number) => !!aboves.get(place)?.talks;
  once('legend', JSON.stringify(legend.map(({ agent, doing, body }) => [agent, doing, body.over, talks(agent.place)])), () => {
    $('legend').replaceChildren(...legend.map(({ body, agent, doing }) => {
      const who = el('button', `who${talks(agent.place) ? ' talks' : ''}`, el('span', 'swatch'), logo(makerOf(agent.model), '', 18), el('b', '', body.itself ?? agent.name),
        el('span', 'doing', talks(agent.place) ? icon(iconOf('say')) : doing ? icon(iconOf(doing)) : ''),
        body.over ? el('span', 'has', icon(body.over.icon), body.over.text) : null);
      who.style.setProperty('--place', colour(agent.place));
      who.title = [body.itself && `calls itself ${body.itself}`, agent.model, doing && `last: ${doing}`].filter(Boolean).join(' · ');
      who.onclick = () => scene!.centre(body);
      return who;
    }));
  });
  // The notes: who wrote one and when is in the record (they never sign them), as the first
  // note written with its words. One nobody wrote, the world put there.
  const notes = [
    ...view.items.filter(item => item[4] !== undefined).map(([x, y, , , text]) => ({ where: `lies at (${x}, ${y})`, text: text! })),
    ...view.bodies.filter(body => body.holds !== undefined).map(body => ({ where: `${names.get(body.number!) ?? `Tinkerling ${body.number}`} holds it`, text: body.holds! })),
  ].map(note => ({ ...note, by: written.get(note.text) }))
    .sort((a, b) => (b.by?.t ?? -1) - (a.by?.t ?? -1));
  once('notes', JSON.stringify([notes, open]), () => {
    $('notesButton').replaceChildren(icon('sticky-note'), `${notes.length} note${notes.length === 1 ? '' : 's'}`);
    $('notesButton').classList.toggle('on', open === 'notes');
    $('notes').hidden = open !== 'notes';
    $('notes').replaceChildren(...(notes.length ? notes.map(({ text, where, by }) => {
      const when = by ? el('button', 'when', clock(by.t)) : null;
      if (when) {
        when.title = 'Go to the moment it was written';
        when.onclick = () => { at = by!.t; playing = live = false; draw(); };
      }
      const note = el('div', 'note', el('div', 'text', text),
        el('div', 'by', ...(by ? [el('b', '', by.who), 'wrote it at', when] : ['Left by the world']), '·', where));
      if (by) note.style.setProperty('--place', colour(by.place));
      note.firstElementChild!.addEventListener('click', () => note.classList.toggle('whole'));
      return note;
    }) : [el('div', 'empty', 'There are no notes in the world at this moment.')]));
  });
}

/** The agents that have woken up until an event: the model each thinks with, and whether it
 *  is gone by then. (One that wakes up again, remembering, is the same agent.) */
function agentsUntil(index: number): { number: number; place: number; name: string; model: string; gone?: string }[] {
  const agents = new Map<number, { number: number; place: number; name: string; model: string; gone?: string }>();
  for (let i = 0; i <= index; i++) {
    const event = film.events[i]!, number = event.number as number;
    if (event.type === 'wake') agents.set(number, { number, place: event.place as number, name: nameOf(event), model: String(event.model ?? '') });
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
  if (ended) whyNot = (await api<{ whyNot: string | null }>(`/api/runs/${id}`)).whyNot;
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
// The conversation can be put away, to see all of the world.
const drawToggle = () => {
  const closed = $('side').classList.contains('closed');
  $('sideToggle').replaceChildren(icon(closed ? 'message-square-text' : 'panel-right-close'), closed ? 'Conversation' : '');
  $('sideToggle').title = closed ? 'Show what the tinkerlings think, say and do' : 'Hide the conversation';
};
$('sideToggle').onclick = () => {
  $('side').classList.toggle('closed');
  drawToggle();
};
drawToggle();
$('notesButton').onclick = () => {
  open = open ? null : 'notes';
  shown = -2;   // (drawn again, with the notes)
  draw();
};
// About the run on screen, in a panel over the right of the screen: what the reviewer wrote,
// how it was set up (its settings, and who lived in it; what differs from what is usual for the
// world now is marked), and a button to start a run like it.
let infoOpen = false;
async function showInfo(run: About): Promise<void> {
  $('info').hidden = !infoOpen;
  if (!infoOpen) return;
  const world = (await api<WorldInfo[]>('/api/worlds')).find(found => found.name === run.world);
  if (about?.id !== run.id) return;   // (another run is on screen by now)
  const said = (value: unknown) => (value === true ? 'on' : value === false ? 'off' : value === '' ? '–' : Array.isArray(value) ? value.join(', ') || '–' : String(value));
  const fact = (title: string, value: unknown, usual?: unknown) =>
    el('div', `fact${usual !== undefined && JSON.stringify(usual) !== JSON.stringify(value) ? ' changed' : ''}`, el('span', '', title), el('b', '', said(value)));
  const close = el('button', 'close', icon('x'));
  close.title = 'Close';
  close.onclick = () => { infoOpen = false; draw(); };
  const again = el('button', 'button main', 'Start a run like this');
  again.onclick = () => startLike(run);
  $('info').replaceChildren(close,
    el('h2', '', named(run)),
    el('p', 'summary', run.review?.summary ?? (run.going ? 'This run gets a name and a summary when it ends.' : run.ended ?? '')),
    el('h3', '', 'The world'),
    fact('World', run.title),
    fact('Started', started(run.id)),
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
          fact("The world's message to a tinkerling that wakes up", agent.told),
          fact('Cannot', agent.without.join(', ') || 'nothing is switched off', agent.without.length ? null : undefined),
        ]),
      ];
    }),
    el('div', 'actions', again));
}
document.addEventListener('keydown', key => {
  if (key.key === 'Escape' && infoOpen && showing) { infoOpen = false; draw(); }
});
$('speed').onchange = event => { speed = Number((event.target as HTMLSelectElement).value); };
$('live').onclick = () => { live = playing = true; at = whole(); draw(); };
$('stop').onclick = () => about && api(`/api/runs/${about.id}/stop`, {});
// A run that is over goes on: asked for how long, as long as it went the first time.
$('goOn').onclick = () => {
  if (!about) return;
  ($('goOnMinutes') as HTMLInputElement).value = String(about.minutes ? Math.max(1, Math.round(about.minutes)) : 0);
  $('goOnTrouble').hidden = true;
  ($('goOnDialog') as HTMLDialogElement).showModal();
};
$('goOnStart').onclick = async () => {
  if (!about) return;
  const id = about.id, button = $('goOnStart') as HTMLButtonElement;
  button.disabled = true;
  button.textContent = 'Playing it again…';
  const answer = await api<{ ok?: true; error?: string }>(`/api/runs/${id}/resume`,
                                                         { minutes: Number(($('goOnMinutes') as HTMLInputElement).value) || 0 });
  button.disabled = false;
  button.textContent = 'Go on';
  if (answer.error) {
    $('goOnTrouble').textContent = answer.error;
    $('goOnTrouble').hidden = false;
    return;
  }
  ($('goOnDialog') as HTMLDialogElement).close();
  about = null;   // (its record is read again from the start: its end is gone)
  void readRuns();
  await openRun(id);
};
