// One run of a world: its agents come and go, time passes, everything is recorded.
//
// This file does not start any AI. It keeps the places agents live in and answers what
// they do. Who actually sits in a place is someone else's business: in a real run an AI
// agent (see agents.ts), in a test the test itself, calling `act`.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chance, realTime, type Time } from './time.ts';
import { usual, type Agent, type Arg, type Args, type Host, type Role, type Tool, type World, type WorldDefinition } from './types.ts';

/** One line of the record. `t` is seconds since the world started. */
export interface Event { t: number; type: string; [more: string]: unknown }

export interface RunOptions {
  /** Settings that differ from the world's usual ones. */
  chosen?: Record<string, unknown>;
  /** What a person changed about the roles: model, count, what they know and are told. */
  roles?: Record<string, Partial<Role>>;
  /** The world ends after this many minutes. 0: no time limit. Left out: the world's own. */
  minutes?: number;
  seed?: number;
  time?: Time;
  /** Where the record is written. Left out: it is only kept in memory. */
  folder?: string;
  id?: string;
}

/** Whoever puts agents into the places listens to this. */
export interface Listener {
  /** An agent woke up in a place. `again`: the same one as before, with its memory. */
  woke?(agent: Agent, role: Role): void;
  /** An agent that stopped talking is told something, and goes on. */
  told?(agent: Agent, text: string): void;
  /** The agent in this place is gone: end it. */
  gone?(place: number): void;
  ended?(why: string): void;
  event?(event: Event): void;
}

interface Seat {
  place: number;
  roleName: string;
  role: Role;
  agent: Agent | null;
  /** How often an agent woke up here. */
  filled: number;
  /** What its agent has noticed and not been told yet. */
  notices: { text: string | (() => string); about?: string; quiet?: boolean }[];
  /** Ends a `wait`, if its agent is waiting. */
  stopWaiting: (() => void) | null;
  /** What its agent is doing: one action finishes before its next begins. */
  busy: Promise<unknown>;
  acting: boolean;
  /** It died or left, and what comes after has not been done yet. (If it happened during
   *  its own action, that is answered first.) */
  fate: 'died' | 'left' | null;
  /** How often it stopped talking since it last did something. */
  rests: number;
  /** It has stopped talking, and has not been told anything since. */
  resting: boolean;
  /** Which turn its agent is in: the first begins when it wakes up, the next each time it
   *  is told something after it stopped talking. */
  turn: number;
  /** Opened for an agent that was called in: when that one is gone, no new agent follows. */
  extra: boolean;
}

/** How long an agent that stopped talking is left alone before its senses tell it something:
 *  longer every time it stops again without having done anything, up to a minute. */
const REST = 5, LONGEST_REST = 60;

/** The one tool the engine brings itself, in every world. */
export const WAIT: Tool<unknown, unknown, { seconds: Arg }> = {
  about: 'Wait until something happens around you, at most for some seconds.',
  args: { seconds: { type: 'number', min: 1, max: 60, optional: true } },
  run: () => '',   // (done by the run itself: see `act`)
};

export class Run {
  readonly id: string;
  readonly world: World;
  readonly roles: Record<string, Role>;
  readonly chosen: Record<string, any>;
  readonly minutes: number;
  readonly events: Event[] = [];
  readonly listeners: Listener[] = [];
  /** Why the world ended, once it has. */
  ended: string | null = null;
  readonly folder: string | undefined;
  private readonly time: Time;
  private readonly seats = new Map<number, Seat>();
  private born = 0;
  private started = false;
  /** How many seconds it lasted, once it has ended. */
  private lasted: number | null = null;

  readonly definition: WorldDefinition<any>;

  constructor(definition: WorldDefinition<any>, options: RunOptions = {}) {
    this.definition = definition;
    this.id = options.id ?? runId();
    this.time = options.time ?? realTime();
    this.chosen = { ...usual(definition.settings), ...options.chosen };
    this.minutes = options.minutes ?? definition.minutes;
    this.folder = options.folder;
    const declared = definition.roles(this.chosen);
    this.roles = Object.fromEntries(Object.entries(declared).map(([name, role]) => [name, { ...role, ...options.roles?.[name] }]));
    const random = chance(options.seed ?? Math.floor(Math.random() * 2 ** 31));
    const host: Host = {
      notice: (place, text, how) => this.notice(place, text, how),
      died: (place, why) => this.gone(place, why, 'died'),
      left: (place, why) => this.gone(place, why, 'left'),
      call: (role, greeting) => this.call(role, greeting),
      over: why => this.end(why),
      random,
      now: () => this.time.now(),
      after: (seconds, what) => this.time.after(seconds, () => {
        if (this.ended) return;
        what();
        this.changed();
      }),
      record: (what, data) => this.record({ type: 'fact', what, data }),
    };
    this.world = definition.create(this.chosen, host);
  }

  // ---------------------------------------------------------------- the run

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.folder) {
      mkdirSync(this.folder, { recursive: true });
      this.writeAbout();
    }
    this.world.changes();   // (what making the world changed is in the first picture)
    this.record({ type: 'start', world: this.definition.name, title: this.definition.title,
                  drawnBy: this.definition.drawnBy, chosen: this.chosen, picture: this.world.picture() });
    let place = 0;
    for (const [roleName, role] of Object.entries(this.roles)) {
      for (let i = 0; i < role.count; i++) {
        place++;
        this.seats.set(place, { place, roleName, role, agent: null, filled: 0, notices: [], stopWaiting: null,
                                busy: Promise.resolve(), acting: false, fate: null, rests: 0, resting: false, turn: 1, extra: false });
      }
    }
    if (this.minutes) this.time.after(this.minutes * 60, () => this.end(`The world's time was up after ${this.minutes} minutes.`));
    for (const seat of [...this.seats.values()]) this.wake(seat, false);
    if (!this.seats.size) this.end('The world has no agents.');
  }

  end(why: string): void {
    if (this.ended) return;
    this.ended = why;
    this.lasted = this.time.now();
    this.time.stop();
    this.record({ type: 'end', why });
    for (const seat of this.seats.values()) seat.stopWaiting?.();
    if (this.folder) this.writeAbout();
    for (const listener of this.listeners) listener.ended?.(why);
  }

  /** How many seconds are left until the world's time is up. Nothing: it has no time limit. */
  left(): number | null {
    return this.minutes ? Math.max(0, Math.round(this.minutes * 60 - this.time.now())) : null;
  }

  /** The agent that is alive in a place, if one is. */
  agent(place: number): Agent | null {
    return this.seats.get(place)?.agent ?? null;
  }

  /** The places of this world, with the role of each. */
  places(): { place: number; role: string }[] {
    return [...this.seats.values()].map(seat => ({ place: seat.place, role: seat.roleName }));
  }

  // ---------------------------------------------------------------- what agents do

  /** What the agent in a place can do: its world's tools without the ones switched off for
   *  its role, and `wait`. */
  tools(place: number): Record<string, Tool<any, any, any>> {
    const seat = this.seats.get(place);
    if (!seat?.agent) return {};
    const off = new Set(seat.role.without ?? []);
    const offered = Object.entries({ ...this.world.tools(seat.agent), wait: WAIT }).filter(([name, tool]) => tool.needed || !off.has(name));
    return Object.fromEntries(offered);
  }

  /** The agent in a place uses a tool. The answer is what it reads. */
  act(place: number, tool: string, args: unknown): Promise<string> {
    const seat = this.seats.get(place);
    if (!seat) return Promise.resolve('You are not in this world.');
    const done = seat.busy.then(() => this.doAct(seat, tool, args));
    seat.busy = done.catch(() => {});
    return done;
  }

  private async doAct(seat: Seat, name: string, given: unknown): Promise<string> {
    const agent = seat.agent;
    if (this.ended) return 'The world has ended.';
    if (!agent) return 'You are not in this world.';
    const tool = this.tools(seat.place)[name];
    if (!tool) return `There is no "${name}" here.`;
    const args = checked(tool.args, given);
    if (typeof args === 'string') return args;
    seat.acting = true;
    seat.rests = 0;
    seat.resting = false;
    let answer: string;
    try {
      answer = name === 'wait' ? await this.wait(seat, Number(args.seconds ?? 30))
        : await this.world.act(agent, name, args);
    } catch (error) {   // a mistake in the world's code: say so in the record, and keep the world going
      this.record({ type: 'error', place: seat.place, tool: name, error: String((error as Error)?.stack ?? error) });
      answer = 'That did not work.';
    }
    seat.acting = false;
    answer = [answer, ...this.noticed(seat)].filter(Boolean).join('\n');
    this.record({ type: 'act', place: seat.place, number: agent.number, tool: name, args, answer,
                  changes: this.world.changes() ?? undefined });
    if (seat.fate) this.time.after(0, () => this.after(seat));
    return answer;
  }

  /** Waits until the agent in a place has something to be told, or the time has passed. */
  private async wait(seat: Seat, seconds: number): Promise<string> {
    const since = this.time.now(), until = since + seconds;
    for (;;) {
      // It is told how long it waited: so it can choose better how long to wait the next time.
      const waited = Math.round(this.time.now() - since);
      const left = until - this.time.now(), over = left <= 0 || this.ended || seat.fate;
      // (What is only noticed quietly does not end the wait: it is told when the wait ends.)
      if (over || seat.notices.some(notice => !notice.quiet)) {
        const noticed = this.noticed(seat);
        if (noticed.length) return `${waited ? `After ${waited} s` : 'At once'}: ${noticed.join('\n')}`;
        if (over) return `Nothing happened in ${waited} s.`;
      }
      await new Promise<void>(resolve => {
        const go = () => {
          cancel();
          seat.stopWaiting = null;
          resolve();
        };
        const cancel = this.time.after(left, go);
        seat.stopWaiting = go;
      });
    }
  }

  /** What the agent in a place has noticed and is told now. */
  private noticed(seat: Seat): string[] {
    return seat.notices.splice(0).map(({ text }) => {
      if (typeof text === 'string') return text;
      const now = text();   // worked out only now: how things are at this moment
      if (now && seat.agent) this.record({ type: 'notice', place: seat.place, number: seat.agent.number, text: now });
      return now;
    }).filter(Boolean);
  }

  /** What went on in the agent in a place, for the record: what it thought, or what it wrote
   *  as a message. Neither reaches the world: nobody there hears it. (What an agent says out
   *  loud is an action like any other: the world's tool for it.) */
  inner(place: number, kind: 'think' | 'write', text: string): void {
    const agent = this.agent(place);
    if (agent && !this.ended) this.record({ type: kind, place, number: agent.number, text });
  }

  /** The agent in a place ended its turn: it stopped talking. Nobody answers it.
   *
   *  Usually nothing happens to it in the world. It stays where it is, and after a while it
   *  is told what its senses tell it, like someone who dozed off and looks up again. The while
   *  gets longer every time it stops without having done anything, and ends early when
   *  something happens that would end a `wait`.
   *
   *  If its role says that stopping is leaving, it has left. */
  stopped(place: number): void {
    const seat = this.seats.get(place);
    const agent = seat?.agent;
    if (!seat || !agent || seat.fate || this.ended) return;
    if (seat.role.stoppingLeaves) return this.gone(place, 'It ended its turn.', 'left');
    this.rest(seat, Math.min(LONGEST_REST, REST * 2 ** seat.rests++));
  }

  /** Leaves an agent that stopped talking alone for some seconds, then tells it what its senses tell it. */
  private rest(seat: Seat, rest: number): void {
    const agent = seat.agent!, place = seat.place;
    seat.resting = true;
    const tell = () => {
      cancel();
      if (seat.stopWaiting === tell) seat.stopWaiting = null;
      if (this.ended || seat.agent !== agent || seat.fate) return;
      seat.resting = false;
      // (First what it has noticed, then how things are: what it noticed may be over already.)
      const text = [...this.noticed(seat), this.world.senses?.(agent)].filter(Boolean).join('\n') || 'Nothing has changed.';
      this.record({ type: 'senses', place, number: agent.number, text, after: rest, turn: ++seat.turn });
      for (const listener of this.listeners) listener.told?.(agent, text);
    };
    const cancel = this.time.after(rest, tell);
    seat.stopWaiting = tell;
  }

  // ---------------------------------------------------------------- waking and dying

  /** One more agent of a role is called into the world (see Host.call). */
  private call(roleName: string, greeting: unknown): boolean {
    const role = this.roles[roleName];
    if (!role?.most || this.ended) return false;
    this.time.after(0, () => {   // (a moment later: not in the middle of the action that called it)
      if (this.ended) return;
      const mine = [...this.seats.values()].filter(seat => seat.roleName === roleName);
      if (mine.length < role.most!) {
        let place = 1;
        while (this.seats.has(place)) place++;
        const seat: Seat = { place, roleName, role, agent: null, filled: 0, notices: [], stopWaiting: null,
                             busy: Promise.resolve(), acting: false, fate: null, rests: 0, resting: false, turn: 1, extra: true };
        this.seats.set(place, seat);
        return this.wake(seat, false, greeting);
      }
      // The world is full: the one that has been alive longest is gone, the new one takes its place.
      const oldest = mine.filter(seat => seat.agent).sort((a, b) => a.agent!.number - b.agent!.number)[0];
      if (!oldest) return;
      this.record({ type: 'death', place: oldest.place, number: oldest.agent!.number, replaced: true,
                    why: 'Someone was called in. The world was full, and it had been alive longest.' });
      oldest.stopWaiting?.();
      for (const listener of this.listeners) listener.gone?.(oldest.place);
      this.wake(oldest, false, greeting);
    });
    return true;
  }

  private wake(seat: Seat, again: boolean, greeting?: unknown): void {
    seat.filled++;
    seat.fate = null;
    seat.rests = 0;
    // (One that died while it had stopped talking, and comes back: it is told so, or it would never go on.)
    const dozing = again && seat.resting;
    if (!again) seat.turn = 1;
    seat.resting = false;
    const agent: Agent = { place: seat.place, number: again && seat.agent ? seat.agent.number : ++this.born, role: seat.roleName, again,
                           ...(greeting === undefined ? {} : { called: greeting }) };
    seat.agent = agent;
    if (!again) seat.notices = [];
    this.world.wake(agent);
    this.record({ type: 'wake', place: seat.place, number: agent.number, role: seat.roleName, again, called: greeting !== undefined,
                  model: seat.role.model, changes: this.world.changes() ?? undefined });
    for (const listener of this.listeners) listener.woke?.(agent, seat.role);
    if (dozing) this.rest(seat, 0);
  }

  private notice(place: number, text: string | (() => string), { about, quiet }: { about?: string; quiet?: boolean } = {}): void {
    const seat = this.seats.get(place);
    if (!seat?.agent || this.ended) return;
    const known = about === undefined ? undefined : seat.notices.find(notice => notice.about === about);
    if (known) known.quiet &&= quiet;   // (told once; and if one of them is not quiet, it ends a wait)
    else seat.notices.push({ text, about, quiet });
    if (typeof text === 'string') this.record({ type: 'notice', place, number: seat.agent.number, text });
    if (!quiet) seat.stopWaiting?.();
  }

  /** The agent in a place died, or left for good. */
  private gone(place: number, why: string, fate: 'died' | 'left'): void {
    const seat = this.seats.get(place);
    if (!seat?.agent || seat.fate || this.ended) return;
    seat.fate = fate;
    this.record({ type: 'death', place, number: seat.agent.number, why, ...(fate === 'left' ? { left: true } : {}) });
    seat.stopWaiting?.();
    // (After its own action is answered, or at once if it was not its own doing.)
    if (!seat.acting) this.time.after(0, () => this.after(seat));
  }

  /** What comes after an agent died or left: it comes back, a new one follows, or nobody. */
  private after(seat: Seat): void {
    if (this.ended || !seat.fate || this.seats.get(seat.place) !== seat) return;
    const { role } = seat, more = role.lives === undefined || seat.filled <= role.lives;
    if (seat.fate === 'died' && role.comesBack && more) return this.wake(seat, true);
    for (const listener of this.listeners) listener.gone?.(seat.place);
    // (An agent that was called in is one more than the world started with: nobody follows it.)
    if (role.followed && more && !seat.extra) return this.wake(seat, false);
    seat.agent = null;
    this.seats.delete(seat.place);
    this.world.remove(seat.place);
    this.changed();
    if (!this.seats.size) this.end('The last agent is gone.');
  }

  // ---------------------------------------------------------------- the record

  private changed(): void {
    const changes = this.world.changes();
    if (changes) this.record({ type: 'world', changes });
  }

  private record(entry: { type: string; [more: string]: unknown }): void {
    const event: Event = { ...entry, t: Math.round(this.time.now() * 1000) / 1000 };
    this.events.push(event);
    if (this.folder) appendFileSync(join(this.folder, 'record.jsonl'), JSON.stringify(event) + '\n');
    for (const listener of this.listeners) listener.event?.(event);
  }

  /** What a list of runs shows about this one, without reading its record. */
  about(): Record<string, unknown> {
    return { id: this.id, world: this.definition.name, title: this.definition.title, minutes: this.minutes,
             chosen: this.chosen, models: [...new Set(Object.values(this.roles).map(role => role.model))],
             ended: this.ended, seconds: Math.round(this.lasted ?? this.time.now()) };
  }

  private writeAbout(): void {
    writeFileSync(join(this.folder!, 'about.json'), JSON.stringify(this.about(), null, 2));
  }
}

/** A name for a run: the moment it starts, like 20261125-220619. */
export function runId(): string {
  const now = new Date(), two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}

/** What an agent gave for a tool's arguments, checked. A sentence if something is wrong. */
export function checked(args: Args, given: unknown): Record<string, unknown> | string {
  const from = (given && typeof given === 'object' ? given : {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [name, arg] of Object.entries(args)) {
    const value = from[name], Name = name[0]!.toUpperCase() + name.slice(1);
    if (value === undefined || value === null || value === '') {
      if (arg.optional) continue;
      return `${Name} is missing.`;
    }
    if (arg.type === 'number') {
      const number = Number(value);
      const range = arg.min !== undefined && arg.max !== undefined ? ` from ${arg.min} to ${arg.max}`
        : arg.min !== undefined ? `, ${arg.min} or more` : arg.max !== undefined ? `, ${arg.max} or less` : '';
      const wrong = Number.isNaN(number) || (arg.whole && !Number.isInteger(number))
        || (arg.min !== undefined && number < arg.min) || (arg.max !== undefined && number > arg.max);
      if (wrong) return `${Name} must be a ${arg.whole ? 'whole ' : ''}number${range}.`;
      result[name] = number;
    } else if (arg.type === 'one of') {
      if (!arg.options.includes(String(value))) return `${Name} must be one of: ${arg.options.join(', ')}.`;
      result[name] = String(value);
    } else {
      result[name] = String(value);
    }
  }
  return result;
}

/** A tool's arguments in the form agents are shown them (JSON Schema). */
export function schema(args: Args): { type: 'object'; properties: Record<string, unknown>; required: string[] } {
  const properties = Object.fromEntries(Object.entries(args).map(([name, arg]) => [name, {
    ...(arg.type === 'number' ? { type: arg.whole ? 'integer' : 'number', minimum: arg.min, maximum: arg.max }
      : arg.type === 'one of' ? { type: 'string', enum: arg.options } : { type: 'string' }),
    description: arg.about,
  }]));
  return { type: 'object', properties, required: Object.keys(args).filter(name => !args[name]!.optional) };
}
