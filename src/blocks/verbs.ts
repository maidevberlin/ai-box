// The verbs every block world can give its agents: what an agent can do. A world takes the
// ones it wants (`verbs: basic`, or `verbs: { look: basic.look, ... }`) and adds its own.
//
// What a verb does to a special thing is not written here: it comes from the kind of the
// thing (sticky, floats, what can be done to it and how, its reactions: see types.ts).

import type { Blocks } from './world.ts';
import type { Tool } from '../engine/types.ts';
import { DIRECTIONS, WAYS, verb, verbTo, type AgentKind, type BlockKind, type BlockWorld, type Body, type Cell, type CreatureKind, type Deed, type Item, type ItemKind, type Loudness, type Place, type Thing, type Verb } from './types.ts';

const BEGINNING = 3;       // how many words of a note can be made out without looking at it
const REACH = 2;           // put reaches stacks at most this much higher or lower than your feet
const GRAVITY = 9.8;       // blocks per second squared
const THROW_SPEED = 1.5;   // blocks per second, per point of power
const HAND = 1.5;          // a throw starts this high above your feet

const at = (cell: Cell) => `(${cell[0]}, ${cell[1]})`;
const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
const inner = (world: BlockWorld<any>) => world as Blocks<any>;

// ---------------------------------------------------------------- what things look like

/** A thing as it looks from a distance: a note shows how it begins. */
function fromAfar(world: BlockWorld<any>, me: Body, item: Item): string {
  const what = `a ${world.called(item)}${called(world, me, item)}`;
  if (item.text === undefined) return what;
  const words = item.text.split(/\s+/);
  return `${what} ("${words.slice(0, BEGINNING).join(' ')}${words.length > BEGINNING ? '…' : ''}")`;
}

/** The things lying on a cell, as they look from a distance. */
function pile(world: BlockWorld<any>, me: Body, cell: Cell): string {
  const items = world.items(cell);
  return items.length === 1 ? fromAfar(world, me, items[0]!) : `${items.length} things (on top: ${fromAfar(world, me, items.at(-1)!)})`;
}

/** What a column is made of, by level, lowest first: "1-4 green, 5 blue". The ground is
 *  left out. Blocks of one kind lying directly on each other are said together. */
export function pattern(world: BlockWorld<any>, cell: Cell): string {
  const runs: [first: number, last: number, kind: string][] = [];
  for (const [z, kind] of world.column(cell)) {
    if (world.blockKind(kind)!.ground) continue;
    const last = runs.at(-1);
    if (last && last[2] === kind && last[1] === z - 1) last[1] = z;
    else runs.push([z, z, kind]);
  }
  const name = (kind: string) => world.called(kind).replace(/ block$/, '');
  const levels = (first: number, last: number, kind: string) => (first === last ? `${first + 1} ${name(kind)}` : `${first + 1}-${last + 1} ${name(kind)}`);
  // (A block below level 1 lies in the water's surface: it floats, or hangs on the land.)
  return runs.map(([first, last, kind]) => (first >= 0 ? levels(first, last, kind)
    : `${name(kind)} in the water${last >= 0 ? `, ${levels(0, last, kind)}` : ''}`)).join(', ');
}

/** What looking around shows of a cell, after "(x, y): ". */
function described(world: BlockWorld<any>, me: Body, cell: Cell): string {
  const high = world.height(cell);
  const made = pattern(world, cell);
  const loose = world.column(cell).filter(([, kind]) => !world.blockKind(kind)!.ground);
  const said = high < 0 ? `a hole ${-high} deep`
    : loose.length === 1 && loose[0]![0] <= 0 ? `${high} (${made.replace(/^1 /, '')})`
    : made ? `${high} (by level: ${made})` : `${high}`;
  return said + names(world, me, cell);
}

/** The names an agent gave to the top block of a cell and to the place itself, to add to what is said of it. */
function names(world: BlockWorld<any>, me: Body, cell: Cell): string {
  const top = world.column(cell).at(-1);
  const block = top && !world.blockKind(top[1])!.ground ? inner(world).nameFor(me, [cell[0], cell[1], top[0]]) : undefined;
  const place = inner(world).nameFor(me, cell);
  return (block ? `, the top one called "${block}"` : '') + (place ? `, the place you call "${place}"` : '');
}

/** What looking straight at a cell shows. */
function lookedAt(world: BlockWorld<any>, me: Body, cell: Cell): string {
  const column = world.column(cell), items = world.items(cell);
  const under = column.some(([, kind]) => world.blockKind(kind)!.ground) ? 'ground' : 'water';
  const made = pattern(world, cell);
  const there = world.bodyAt(cell);
  const who = there && there !== me ? ` ${someone(world, me, there)} stands there${holding(world, there)}.` : '';
  const place = inner(world).nameFor(me, cell), spot = place ? ` This is the place you call "${place}".` : '';
  if (!made && !items.length) {
    // Only ground (or water). If the ground is not flat, or its top has a name, that is said.
    const high = world.height(cell), top = world.top(cell), named = top ? world.blockKind(top)!.called : undefined;
    const ground = under === 'water' ? 'There is only water.'
      : high === 0 && !named ? `There is nothing at ${at(cell)}, only ground.`
      : `At ${at(cell)} the ground is ${high < 0 ? `${-high} deep` : high === 0 ? 'level' : `${high} high`}.${named ? ` On top is a ${named}.` : ''}`;
    return ground + spot + who;
  }
  let said = `At ${at(cell)}, ${world.height(cell)} high, over ${under}.${spot}`;
  if (made) said += ` Blocks there, by level: ${made}${names(world, me, cell).replace(/, the place you call .*/, '')}.`;
  if (items.length) {
    const top = items.at(-1)!;
    said += items.length === 1 ? ` A ${world.called(top)}${called(world, me, top)} lies there.` : ` ${items.length} things lie there, on top a ${world.called(top)}${called(world, me, top)}.`;
    if (top.text !== undefined) said += ` It says "${top.text}"`;
  }
  return said + who;
}

/** How an agent speaks of somebody else: by the name it gave them, or "Someone" (for a
 *  creature what it is: "A rabbit"). `inside`: in the middle of a sentence. */
function someone(world: BlockWorld<any>, me: Body, body: Body, inside = false): string {
  const name = inner(world).nameFor(me, body);
  if (name) return name;
  const said = body.creature ? `A ${inner(world).definition.creatures![body.creature]!.called}` : 'Someone';
  return inside ? said.toLowerCase() : said;
}
/** ` called "Rocky"`, if the agent gave the thing a name. */
const called = (world: BlockWorld<any>, me: Body, thing: Item | Place | Cell) => {
  const name = inner(world).nameFor(me, thing);
  return name ? ` called "${name}"` : '';
};
const holding = (world: BlockWorld<any>, body: Body) => (body.hand ? `, holding a ${world.called(body.hand)}` : '');

interface Seen {
  stacks: Map<string, string>;
  water: Map<string, string>;
  beings: string[];
  /** Who is in sight (their ids). */
  who: Set<number>;
  also: string[];
  feet: string;
  at: Cell;
  reach: number;
}

/** What is in sight from where a body stands, in parts, so that it can be compared with
 *  what it saw the last time (see `news`). */
function around(world: BlockWorld<any>, me: Body): Seen {
  const [x, y] = me.cell, reach = world.sight(me);
  const stacks = new Map<string, string>();
  for (let cx = x - reach; cx <= x + reach; cx++) {
    for (let cy = y - reach; cy <= y + reach; cy++) {
      const cell: Cell = [cx, cy];
      if (same(cell, me.cell)) continue;
      const column = world.column(cell), lying = world.items(cell).length;
      const worth = lying || inner(world).nameFor(me, cell) || column.some(([, kind]) => !world.blockKind(kind)!.ground) || (column.length && world.height(cell) < 0);
      if (worth) stacks.set(at(cell), described(world, me, cell) + (lying ? ` with ${pile(world, me, cell)} on top` : ''));
    }
  }
  // How much there is to stand on in each direction before the water, if the water is in sight.
  // (Said as ground left, not as distance to the water: agents walked exactly the distance, and drowned.)
  const water = new Map<string, string>();
  for (const [direction, [dx, dy]] of Object.entries(DIRECTIONS)) {
    let steps = 0;
    while (steps < reach && world.standable([x + dx * (steps + 1), y + dy * (steps + 1)])) steps++;
    if (steps < reach) water.set(direction, steps ? `${steps} step(s) of ground left, then water` : 'no ground left, the next step is water');
  }
  // The others in sight. (Nothing is said if nobody is: an agent is not told it has company.)
  const others = world.bodies().filter(other => other !== me && Math.abs(other.cell[0] - x) <= reach && Math.abs(other.cell[1] - y) <= reach);
  const beings = others
    .map(other => `${someone(world, me, other)} is at ${at(other.cell)}${world.height(other.cell) ? `, ${world.height(other.cell)} high` : ''}${holding(world, other)}.`);
  const lying = world.items(me.cell);
  const said = lying.length ? pile(world, me, me.cell) : '';
  const feet = said ? ` ${said[0]!.toUpperCase()}${said.slice(1)} ${lying.length === 1 ? 'lies' : 'lie'} at your feet.` : '';
  return { stacks, water, beings, who: new Set(others.map(other => other.id)), also: inner(world).definition.alsoSeen?.(world, me) ?? [], feet, at: me.cell, reach };
}

/** What is in sight now that was not when the body last saw its surroundings, in lines.
 *  `keep`: from now on, this is what it has seen. */
export function glimpse(world: BlockWorld<any>, me: Body, keep: boolean): string[] {
  const before = inner(world).sawLast.get(me) as Seen | undefined;
  const now = around(world, me);
  const [x, y] = now.at;
  const fresh = [...now.stacks].filter(([cell, text]) => before?.stacks.get(cell) !== text).map(([cell, text]) => `${cell}: ${text}`);
  const gone = [...(before?.stacks.keys() ?? [])].filter(cell => {
    const [cx, cy] = cell.slice(1, -1).split(', ').map(Number) as [number, number];
    return !now.stacks.has(cell) && !(cx === x && cy === y) && Math.abs(cx - x) <= now.reach && Math.abs(cy - y) <= now.reach;
  });
  const water = [...now.water].filter(([direction, text]) => before?.water.get(direction) !== text).map(([direction, text]) => `${direction}: ${text}`);
  const known = [...(before?.beings ?? []), ...(before?.also ?? [])];
  const lines = [
    ...(fresh.length ? [`New in sight: ${fresh.join(', ')}.`] : []),
    ...(gone.length ? [`Nothing is at ${gone.join(', ')} any more.`] : []),
    ...(water.length ? [`Water: ${water.join('; ')}.`] : []),
    ...[...now.beings, ...now.also].filter(line => !known.includes(line)),
  ];
  if (keep) inner(world).sawLast.set(me, now);
  return lines;
}

/** Is there something new in a body's sight that it should not miss: something that changed
 *  in the world, or somebody who was not in sight before? (Somebody who only moved on within
 *  its sight is news too, but not worth ending a wait for.) */
export function startles(world: BlockWorld<any>, me: Body): boolean {
  const before = inner(world).sawLast.get(me) as Seen | undefined, now = around(world, me);
  const said = glimpse(world, me, false);
  const moved = now.beings.filter(line => !before?.beings.includes(line));
  return said.length > moved.length || [...now.who].some(id => !before?.who.has(id));
}

/** What it sees now is what it has seen: nothing of it is news any more. */
export function seenNow(world: BlockWorld<any>, me: Body): void {
  inner(world).sawLast.set(me, around(world, me));
}

/** Where a body is and what is new in its sight: so a walk tells it what it walks into,
 *  without telling it everything again. */
function news(world: BlockWorld<any>, me: Body): string {
  const lines = glimpse(world, me, true);
  const lying = world.items(me.cell), said = lying.length ? pile(world, me, me.cell) : '';
  const feet = said ? ` ${said[0]!.toUpperCase()}${said.slice(1)} ${lying.length === 1 ? 'lies' : 'lie'} at your feet.` : '';
  return `${world.where(me)}${feet}\n${lines.join('\n') || 'Nothing new in sight.'}`;
}

/** Everything a body sees around it, as it is told. From then on, this is what it has seen.
 *  It is what looking around answers, and what an agent's senses tell it when it has
 *  stopped talking (whether it can `look` or not). */
export function surroundings(world: BlockWorld<any>, me: Body): string {
  const seen = around(world, me);
  inner(world).sawLast.set(me, seen);
  return [
    world.where(me) + seen.feet,
    `You carry: ${me.hand ? `a ${world.called(me.hand)}${called(world, me, me.hand)}` : 'nothing'}.`,
    `Stacks in sight (up to ${seen.reach} away), as position: height: ${[...seen.stacks].map(([cell, text]) => `${cell}: ${text}`).join(', ') || 'none'}.`,
    `Water in sight: ${[...seen.water].map(([direction, text]) => `${direction}: ${text}`).join('; ') || 'none'}.`,
    ...seen.beings,
    ...seen.also,
  ].join('\n');
}

// ---------------------------------------------------------------- pointing at things

/** How an agent says what a verb is done to. */
export const WHAT = { type: 'text', about: 'a position like "(2, 1)", or "here", or "hand", or a name you gave something' } as const;

/** What an agent pointed at. */
export interface Target {
  /** It is what the agent holds. */
  hand: boolean;
  /** Where it is. (For what the agent holds: where the agent stands.) */
  cell: Cell;
  /** The agent pointed by a name it gave: it means this one thing, wherever it is in its
   *  cell. (Pointing at a position means whatever is on top there.) */
  item?: Item;
  block?: Place;
  body?: Body;
}

/** Makes out what an agent points at: by a position, "here", "hand", or a name it gave.
 *  `within`: how far a verb reaches. "reach" is the agent's own cell and the four next to
 *  it, "sight" is as far as it sees. If it cannot be made out, or is too far: the sentence
 *  that says so. */
export function aim(world: BlockWorld<any>, me: Body, said: string, within: 'reach' | 'sight' = 'reach'): Target | string {
  const text = said.trim();
  let target: Target;
  const position = text.match(/^\(?\s*(-?\d+)\s*[,;\s]\s*(-?\d+)\s*\)?$/);
  if (/^(my |the )?hand$/i.test(text)) return { hand: true, cell: me.cell };
  if (/^here$/i.test(text)) target = { hand: false, cell: me.cell };
  else if (position) target = { hand: false, cell: [Number(position[1]), Number(position[2])] };
  else {
    const thing = inner(world).named(me, text);
    if (!thing) return `You have given nothing the name "${text}". Say what you mean by a position like "(2, 1)", by "here", by "hand", or by a name you gave.`;
    if ('item' in thing) {
      if (me.hand === thing.item) return { hand: true, cell: me.cell };
      const lies = inner(world).whereLies(thing.item);
      if (!lies) return `You do not know where "${text}" is now.`;
      target = { hand: false, cell: lies, item: thing.item };
    } else if ('block' in thing) target = { hand: false, cell: [thing.block[0], thing.block[1]], block: thing.block };
    else if ('body' in thing) target = { hand: false, cell: thing.body.cell, body: thing.body };
    else target = { hand: false, cell: thing.place };
  }
  const dx = Math.abs(target.cell[0] - me.cell[0]), dy = Math.abs(target.cell[1] - me.cell[1]);
  if (within === 'sight' ? Math.max(dx, dy) > world.sight(me) : dx + dy > 1)
    return within === 'sight' ? 'That is out of your sight.' : `${at(target.cell)} is out of your reach: you reach where you stand and one step north, south, east or west of it. ${world.where(me)}`;
  return target;
}

type VerbTo = Extract<Verb, { to: 'thing' }>;
type Kind = BlockKind | ItemKind | CreatureKind | AgentKind;

/** What doing a verb to a thing of a kind comes to: what happens (the kind's own way, or
 *  the way the verb usually goes), or the sentence that says why it cannot be done, or
 *  nothing if it just cannot. */
function deed(name: string, made: VerbTo, kind: Kind, somebody: boolean): Deed | string | undefined {
  const said = kind.can?.[name] ?? (!somebody && made.usually?.(kind as BlockKind | ItemKind));
  if (said === true && !made.does) throw new Error(`"${name}" has no usual way of being done: a kind it can be done to has to say what happens.`);
  return said === true ? made.does : said || undefined;
}

/** A verb that is done to a thing, as the agent uses it: it points at something, and the
 *  verb is done to what is on top there, if it can be done to a thing of that kind. */
function doneTo(name: string, made: VerbTo, world: BlockWorld<any>, me: Body, args: { what: string }): string {
  const target = aim(world, me, args.what);
  if (typeof target === 'string') return target;
  const { cell } = target, things: Thing[] = [];
  const ofItem = (item: Item, inHand: boolean) => {
    // (What is held can be a block that was taken: then the kind of block says what can be done.)
    const kind = world.itemKind(item.kind) ?? world.blockKind(item.kind);
    if (kind) things.push({ called: world.called(item), kind, item, cell, inHand });
  };
  const ofBlock = (place: Place) => {
    const kind = world.blockKind(world.block(place) ?? '');
    if (kind) things.push({ called: world.called(world.block(place)!), kind, block: place, cell, inHand: false });
  };
  const ofBody = (body: Body) => {
    const { creatures, agent } = inner(world).definition;
    const kind = body.creature ? creatures![body.creature]! : agent ?? {};
    things.push({ called: inner(world).nameFor(me, body) ?? (body.creature ? creatures![body.creature]!.called : 'someone'), kind, body, cell, inHand: false });
  };
  const there = world.bodyAt(cell), lying = world.items(cell).at(-1), top = world.column(cell).at(-1);
  if (target.hand) {
    if (!me.hand) return 'Your hand is empty.';
    ofItem(me.hand, true);
  } else if (target.body) {
    ofBody(target.body);
  } else if (target.item || target.block) {
    // Pointed at by its name: this one thing, and only if nothing is on top of it.
    if (target.item ? lying !== target.item : lying || top?.[0] !== target.block![2]) return 'Something lies on top of it.';
    if (target.item) ofItem(target.item, false);
    else ofBlock(target.block!);
  } else {
    // A position: who stands there, or what lies on top there, or else the block under it.
    if (there && there !== me) ofBody(there);
    if (lying) ofItem(lying, false);
    if (top) ofBlock([cell[0], cell[1], top[0]]);
    if (!things.length) return 'There is only water.';
  }
  const found = things.map(thing => [thing, deed(name, made, thing.kind, !!thing.body)] as const);
  const [thing, does] = found.find(([, does]) => typeof does === 'function') ?? [];
  if (!thing || typeof does !== 'function') {
    const why = found.map(([, said]) => said).find(said => typeof said === 'string');
    // (The sentence is about something loose there, or else about what is on top.)
    const bare = (other: Thing) => !!other.block && !!(other.kind as BlockKind).ground;
    const first = things.find(other => !other.body && !bare(other)) ?? things[0]!;
    const named = first.body ? someone(world, me, first.body, true) : `a ${first.called}`;
    return why || (bare(first) ? `There is nothing to ${name} at ${at(cell)}.` : `You cannot ${name} ${named}.`);
  }
  if (!thing.inHand) {
    const out = outOfReach(world, me, cell, !!thing.block);
    if (out) return out;
  }
  return does(world, me, thing, args);
}

/** The verbs of a world as the engine hands them to the agents: as tools. A verb that is
 *  done to a thing gets the argument `what`, and is left out if no kind of the world lets
 *  it be done. `on` says, for the start screen, what such a verb can be done to. */
export function asTools(verbs: Record<string, Verb>, kinds: { things: Record<string, BlockKind | ItemKind>; creatures: Record<string, CreatureKind>; agent: AgentKind }): Record<string, Tool<BlockWorld<any>, Body, any> & { on?: string[] }> {
  const tools: ReturnType<typeof asTools> = {};
  for (const [name, made] of Object.entries(verbs)) {
    if (made.to !== 'thing') {
      tools[name] = { about: made.about, args: made.args, needed: made.needed, run: (world, me, args) => made.does(world, me, args) };
      continue;
    }
    const can = (kind: Kind, somebody: boolean) => typeof deed(name, made, kind, somebody) === 'function';
    const on = [
      ...Object.entries(kinds.things).filter(([, kind]) => can(kind, false)).map(([kindName, kind]) => kind.called ?? `${kindName} block`),
      ...Object.values(kinds.creatures).filter(kind => can(kind, true)).map(kind => kind.called),
      ...(can(kinds.agent, true) ? ['other agents'] : []),
    ];
    if (!on.length) continue;
    tools[name] = { about: made.about, args: { what: WHAT, ...made.args }, needed: made.needed, on: made.usually ? undefined : on,
                    run: (world, me, args: { what: string }) => doneTo(name, made, world, me, args) };
  }
  return tools;
}

// ---------------------------------------------------------------- the verbs

const look = verb({
  about: 'Look around, or closely at something next to you.',
  args: { what: { ...WHAT, about: `left out: all around you. Or ${WHAT.about}`, optional: true } },
  does(world, me, { what }) {
    if (what === undefined || /^(all )?around$/i.test(what.trim())) return surroundings(world, me);
    const target = aim(world, me, what);
    if (typeof target === 'string') return target;
    if (target.hand) {
      if (!me.hand) return 'Your hand is empty.';
      return `You hold a ${world.called(me.hand)}${called(world, me, me.hand)}.${me.hand.text === undefined ? '' : ` It says "${me.hand.text}"`}`;
    }
    return lookedAt(world, me, target.cell);
  },
});

const walk = verb({
  about: 'Walk in a direction: one step, or more, up to as far as you see. Tells what is new in sight then.',
  args: {
    direction: { type: 'one of', options: Object.keys(WAYS) },
    steps: { type: 'number', min: 1, whole: true, optional: true },
  },
  does(world, me, args) {
    const steps = args.steps ?? 1, far = world.sight(me), { direction } = args;
    if (steps > far) return `You can only walk as far as you see: ${far} steps from here. ${world.where(me)}`;
    const walked = (n: number) => (n === 1 ? 'a step' : `${n} steps`);
    for (let done = 0; done < steps; done++) {
      const ahead = world.next(me.cell, direction);
      if (!world.standable(ahead)) {
        // Several steps at once stop at the edge: agents walked on without looking again
        // and drowned. Only a single step, asked for as such, goes into the water.
        if (steps > 1) return `${done ? `You walked ${walked(done)} ${direction} and stopped` : 'You did not move'}: the next step ${direction} is water. ${news(world, me)}`;
        if (world.top(ahead)) return `You cannot stand on the ${world.called(world.top(ahead)!)} at ${at(ahead)}. ${world.where(me)}`;
        world.move(me, ahead);
        return `You stepped ${direction}, off the land. ${world.die(me, 'You are in the water. You drown.')}`;
      }
      const there = world.bodyAt(ahead);
      if (there) return `${done ? `You walked ${walked(done)} ${direction}. Then ${someone(world, me, there, true)}` : someone(world, me, there)} at ${at(ahead)} is in your way. ${news(world, me)}`;
      const rise = world.height(ahead) - world.height(me.cell);
      if (rise > (inner(world).definition.climb ?? 0)) {
        const before = done ? `You walked ${walked(done)} ${direction}. Then ` : '';
        const what = world.blockKind(world.top(ahead)!)!.ground ? `the ground at ${at(ahead)} rises ${rise}: too steep to walk up`
          : `a stack ${world.height(ahead)} high at ${at(ahead)} is in your way`;
        return `${before}${before ? what : what[0]!.toUpperCase() + what.slice(1)}. ${news(world, me)}`;
      }
      world.move(me, ahead);
    }
    return `You walked ${walked(steps)} ${direction}. ${news(world, me)}`;
  },
});

const jump = verb({
  about: 'Jump in a direction. More strength gets you further and higher.',
  args: {
    direction: { type: 'one of', options: Object.keys(DIRECTIONS) },
    strength: { type: 'number', min: 1, whole: true },
  },
  does(world, me, { direction, strength }) {
    const strongest = inner(world).definition.jump ?? 2;
    if (strength > strongest) return `Strength must be a whole number from 1 to ${strongest}.`;
    const [dx, dy] = DIRECTIONS[direction as keyof typeof DIRECTIONS], own = world.height(me.cell);
    let landing: Cell | null = null, wall: Cell | null = null;
    for (let cells = 1; cells <= strength; cells++) {
      const cell: Cell = [me.cell[0] + dx * cells, me.cell[1] + dy * cells];
      const rise = world.height(cell) - own;
      if (rise > strength || world.bodyAt(cell)) {   // too high to get onto or over, or somebody is there
        wall = cell;
        break;
      }
      if (world.standable(cell)) landing = cell;
      if (rise === strength) break;   // just reached: comes down on top of it
    }
    if (!landing && wall) {
      const there = world.bodyAt(wall);
      return there ? `${someone(world, me, there)} at ${at(wall)} is in your way. ${world.where(me)}`
        : `You jumped ${strength} high, but the stack at ${at(wall)} is ${world.height(wall) - own} above you. ${world.where(me)}`;
    }
    if (!landing) {
      world.move(me, [me.cell[0] + dx, me.cell[1] + dy]);
      return `You jumped ${direction}, off the land. ${world.die(me, 'You are in the water. You drown.')}`;
    }
    world.move(me, landing);
    const under = world.height(landing) - 1, kind = world.top(landing)!;
    const said = inner(world).react(world.blockKind(kind)!.on?.jumpedOn, { at: [landing[0], landing[1], under], by: me });
    return `You jumped ${direction}.${said} ${world.where(me)}`;
  },
});

/** Nothing if the top of a cell can be reached, else the sentence saying why not. Whatever
 *  can be put somewhere can be taken back: a block put on a stack 2 above the feet makes it
 *  3 high, so taking a block reaches one level higher than putting. */
function outOfReach(world: BlockWorld<any>, me: Body, cell: Cell, takingBlock = false): string | null {
  const above = world.height(cell) - world.height(me.cell);
  if (above < -REACH || above > REACH + (takingBlock ? 1 : 0)) return `The stack there is ${world.height(cell)} high. That is out of your reach.`;
  return null;
}

const take = verbTo({
  about: 'Take something: what lies on top where you point.',
  usually: kind => !('ground' in kind && kind.ground),   // anything loose
  does(world, me, thing) {
    if (thing.body) return 'You cannot carry somebody.';
    if (thing.inHand) return 'You hold it already.';
    if (me.hand) return 'Your hands are full.';
    let said = '';
    if (thing.item) {
      world.removeItem(thing.item);
      me.hand = thing.item;
    } else {
      const place = thing.block!, kind = world.block(place)!;
      me.hand = { kind };
      inner(world).carryName(place, me.hand);   // (what it was called, it is still called in a hand)
      world.removeBlock(place);
      said = inner(world).react(world.blockKind(kind)!.on?.taken, { at: place, by: me });
    }
    return `You took a ${thing.called}.${said} ${world.where(me)}`;
  },
});

const put = verb({
  about: 'Put down what you carry.',
  args: { where: { type: 'text', about: 'a position like "(2, 1)", or "here", or a name you gave a place or a thing there' } },
  does(world, me, { where }) {
    const thing = me.hand;
    if (!thing) return 'You carry nothing.';
    const target = aim(world, me, where);
    if (typeof target === 'string') return target;
    if (target.hand) return 'Say where to put it down.';
    const { cell } = target, [x, y] = cell;
    const there = world.bodyAt(cell);
    if (there && there !== me) return `${someone(world, me, there)} stands there.`;
    if (!world.blockKind(thing.kind)) {   // a note, a fruit: it lies on top
      me.hand = null;
      if (!world.column(cell).length) {
        inner(world).react(world.itemKind(thing.kind)?.on?.sunk, { at: [x, y, -1], by: me, item: thing });
        return `You put the ${world.called(thing)} down. It falls into the water and is gone.`;
      }
      const out = outOfReach(world, me, cell);
      if (out) return (me.hand = thing, out);
      world.drop(thing, cell);
      return `You put the ${world.called(thing)} down at ${at(cell)}. ${world.where(me)}`;
    }
    const out = world.column(cell).length ? outOfReach(world, me, cell) : null;
    if (out) return out;
    // The block is let go at the height of your hands and falls from there. Usually it comes
    // down on top of what is there. A block that something holds on its way stays where it is held.
    const before = world.height(cell);
    const from = same(cell, me.cell) ? before : Math.max(before, world.height(me.cell) + 1);
    me.hand = null;
    const rest = world.release([x, y, from], thing.kind);
    if (!rest) return 'You put the block down. It sinks in the water and is gone.';
    inner(world).carryName(thing, rest);
    const said = inner(world).react(world.blockKind(thing.kind)!.on?.put, { at: rest, by: me });
    const how = rest[2] === -1 ? (world.blockKind(thing.kind)!.floats ? 'It floats in the water, level with the ground.' : 'It sticks to the side of the land, level with the ground.')
      : rest[2] > before ? `It sticks there, ${rest[2] + 1} high, with nothing under it.`
      : `The stack there is ${world.height(cell)} high.`;
    return `You put the block down at ${at(cell)}. ${how}${said} ${world.where(me)}`;
  },
});

const throwIt = verb({
  about: 'Throw what you carry.',
  args: {
    direction: { type: 'number', about: 'compass degrees: 0 is north, 90 is east' },
    angle: { type: 'number', about: 'degrees above the ground, 0 to 90', min: 0, max: 90 },
    power: { type: 'number', about: '1 to 10', min: 1, max: 10 },
  },
  does(world, me, { direction, angle, power }) {
    const thing = me.hand;
    if (!thing) return 'You carry nothing.';
    me.hand = null;
    const isBlock = !!world.blockKind(thing.kind), threw = `You threw the ${world.called(thing)}. `;
    const speed = power * THROW_SPEED, radians = (degrees: number) => (degrees * Math.PI) / 180;
    const forward = speed * Math.cos(radians(angle)), up = speed * Math.sin(radians(angle));
    const dx = Math.sin(radians(direction)), dy = Math.cos(radians(direction));   // 0 degrees is north
    const start = world.height(me.cell) + HAND, from = me.cell;
    const path: number[][] = [[from[0] + 0.5, from[1] + 0.5, start]];
    const flight: Record<string, unknown> = { place: me.agent?.place, path, kind: thing.kind };
    const done = (said: string) => {
      world.record('flight', flight);
      return threw + said;
    };

    /** It comes down on a cell: caught, lying there, or gone in the water. */
    const comeDown = (cell: Cell): string => {
      const catcher = world.bodyAt(cell);
      if (catcher && catcher !== me && catcher.agent && !catcher.hand) {
        catcher.hand = thing;
        path.push([cell[0] + 0.5, cell[1] + 0.5, world.height(cell) + HAND]);
        flight.caught = true;
        world.notice(catcher, `You caught a ${world.called(thing)} that ${someone(world, catcher, me, true)} threw.`);
        return `${someone(world, me, catcher)} at ${at(cell)} caught it.`;
      }
      const mine = same(cell, me.cell);
      if (!isBlock) {
        if (!world.column(cell).length) {
          path.push([cell[0] + 0.5, cell[1] + 0.5, -0.5]);
          flight.lost = true;
          inner(world).react(world.itemKind(thing.kind)?.on?.sunk, { at: [cell[0], cell[1], -1], by: me, item: thing, from });
          return 'It fell into the water and is gone.';
        }
        path.push([cell[0] + 0.5, cell[1] + 0.5, world.height(cell)]);
        world.drop(thing, cell);
        return mine ? `It landed at your feet. ${world.where(me)}` : `It landed at ${at(cell)}.`;
      }
      const rest = world.release([cell[0], cell[1], Math.max(world.height(cell), 0)], thing.kind);
      if (!rest) {
        path.push([cell[0] + 0.5, cell[1] + 0.5, -0.5]);
        flight.lost = true;
        return 'It fell into the water and is gone.';
      }
      path.push([rest[0] + 0.5, rest[1] + 0.5, rest[2] + 0.5]);
      inner(world).carryName(thing, rest);
      const said = inner(world).react(world.blockKind(thing.kind)!.on?.landed, { at: rest, by: me, power, from });
      const how = rest[2] === -1 ? ' It floats in the water, level with the ground.' : ` The stack there is ${world.height(cell)} high.`;
      return `It landed at ${at(cell)}.${how}${said}${mine ? ` ${world.where(me)}` : ''}`;
    };

    let over = me.cell;   // the cell it is flying over
    for (let step = 1; step < 100_000; step++) {
      const t = step * 0.005;
      const z = start + up * t - (GRAVITY * t * t) / 2;
      const x = from[0] + 0.5 + dx * forward * t, y = from[1] + 0.5 + dy * forward * t;
      const ahead: Cell = [Math.floor(x), Math.floor(y)];
      if (step % 10 === 0) path.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100]);
      // A block that something beside it holds stops in the air. (Not over the thrower's own
      // cell: there it is still at the thrower's hand.)
      const level = Math.floor(z);
      if (isBlock && !same(over, from) && level >= Math.max(world.height(over), 0) && !world.block([over[0], over[1], level])) {
        const beside = Object.values(DIRECTIONS).map(([sx, sy]): Cell => [over[0] + sx, over[1] + sy])
          .find(cell => {
            const kind = world.block([cell[0], cell[1], level]);
            return kind !== undefined && (world.blockKind(thing.kind)!.sticky || world.blockKind(kind)!.sticky);
          });
        if (beside) {
          world.setBlock([over[0], over[1], level], thing.kind);
          inner(world).carryName(thing, [over[0], over[1], level]);
          path.push([over[0] + 0.5, over[1] + 0.5, level + 0.5]);
          return done(`It stuck to the side of the block at ${at(beside)} and hangs at ${at(over)}, ${level + 1} high.`);
        }
      }
      if (!same(ahead, over)) {
        // Flew into the side of a stack: drops in front of it. (Only a real stack has a side.)
        if (world.height(ahead) > 0 && z < world.height(ahead) && world.column(ahead).length)
          return done(`It hit the side of the stack at ${at(ahead)} and dropped. ${comeDown(over)}`);
        over = ahead;
      }
      if (z <= world.height(over)) return done(comeDown(over));   // came down on top of whatever is there
    }
    return done('It flew out of sight.');
  },
});

const say = verb({
  about: 'Say something out loud.',
  args: { text: { type: 'text' }, loudness: { type: 'one of', options: ['whisper', 'normal', 'shout'], optional: true } },
  does(world, me, { text, loudness }) {
    const said = text.slice(0, 500), how = (loudness ?? 'normal') as Loudness;
    world.say(me, said, how);
    return `You ${{ whisper: 'whispered', normal: 'said', shout: 'shouted' }[how]}: "${said}"`;
  },
});

const note = verb({
  about: 'Write a note.',
  args: { text: { type: 'text' } },
  does(_world, me, { text }) {
    if (me.hand) return 'Your hands are full.';
    me.hand = { kind: 'note', text: text.slice(0, 1000) };
    return 'You wrote a note. You hold it in your hand.';
  },
});

const name = verb({
  about: 'Give something a name of your own: what you hold, or someone or something you see. You can point at it by that name then.',
  args: { name: { type: 'text' }, what: WHAT },
  does(world, me, args) {
    const given = args.name.trim().slice(0, 40), names = inner(world);
    if (!given) return 'Name is missing.';
    if (/^(here|hand|around)$/i.test(given) || /^\(?\s*-?\d+\s*[,;\s]\s*-?\d+\s*\)?$/.test(given)) return 'That cannot be a name: it already means something.';
    const target = aim(world, me, args.what, 'sight');
    if (typeof target === 'string') return target;
    if (target.hand) {
      if (!me.hand) return 'Your hand is empty.';
      names.callIt(me, me.hand, given);
      return `You call the ${world.called(me.hand)} in your hand "${given}" now.`;
    }
    const { cell } = target;
    // Pointed at by a name it has: that one thing gets the new name. By a position: who
    // stands there, or what lies on top, or the top block, or else the place itself.
    const pointed = target.body || target.item || target.block;
    const there = target.body ?? (pointed ? undefined : world.bodyAt(cell));
    const lying = target.item ?? (pointed ? undefined : world.items(cell).at(-1));
    const top = target.block ? [target.block[2], world.block(target.block)!] as const : pointed ? undefined : world.column(cell).at(-1);
    if (there && there !== me) {
      const before = someone(world, me, there, true);
      names.callIt(me, there, given);
      return `You call ${before} at ${at(cell)} "${given}" now.`;
    }
    if (lying) {
      names.callIt(me, lying, given);
      return `You call the ${world.called(lying)} at ${at(cell)} "${given}" now.`;
    }
    if (!top) return 'There is only water.';
    if (!world.blockKind(top[1])!.ground) {
      names.callIt(me, [cell[0], cell[1], top[0]], given);
      return `You call the ${world.called(top[1])} at ${at(cell)} "${given}" now.`;
    }
    names.callIt(me, cell, given);
    return `You call the place ${at(cell)} "${given}" now.`;
  },
});

/** Whether something can be destroyed is up to its kind. Usually only notes can. */
const destroy = verbTo({
  about: 'Destroy something for good.',
  does(world, me, thing) {
    if (thing.body) return world.die(thing.body, 'You were destroyed.') && `You destroyed ${someone(world, me, thing.body, true)}.`;
    if (thing.item) world.removeItem(thing.item);
    else world.removeBlock(thing.block!);
    return `You destroyed the ${thing.called}${thing.inHand ? ' in your hand' : ` at ${at(thing.cell)}`}. It is gone.`;
  },
});

/** Pushing moves what is next to you one step further away from you. What is pushed off
 *  an edge falls, and what is pushed into the water is in the water. Nothing can be pushed
 *  unless its kind says so. */
const push = verbTo({
  about: 'Push something or somebody next to you away from you.',
  does(world, me, thing) {
    const [x, y] = thing.cell, dx = x - me.cell[0], dy = y - me.cell[1];
    if (thing.inHand) return 'You hold it.';
    if (!dx && !dy) return 'You cannot push what is under you.';
    const to: Cell = [x + dx, y + dy], behind = world.bodyAt(to);
    if (behind) return `${someone(world, me, behind)} at ${at(to)} is in the way.`;
    if (thing.body) {
      const other = thing.body, who = someone(world, me, other, true), pusher = someone(world, other, me);
      if (world.column(to).length && (!world.standable(to) || world.height(to) > world.height(thing.cell)))
        return `You pushed ${who}, but what is at ${at(to)} is in the way.`;
      world.move(other, to);
      if (!world.standable(to)) {
        world.die(other, `${pusher} pushed you into the water. You drown.`);
        return `You pushed ${who} into the water.`;
      }
      world.notice(other, `${pusher} pushed you. ${world.where(other)}`);
      return `You pushed ${who} to ${at(to)}.`;
    }
    if (thing.item) {
      world.removeItem(thing.item);
      world.drop(thing.item, to);
      return `You pushed the ${thing.called} to ${at(to)}.${world.column(to).length ? '' : ' It fell into the water and is gone.'}`;
    }
    const place = thing.block!, kind = world.block(place)!, moving = { kind };
    if (world.bodyAt(thing.cell)) return 'Somebody stands on it.';
    if (world.height(to) > place[2]) return `You pushed the ${thing.called}, but what is at ${at(to)} is in the way.`;
    inner(world).carryName(place, moving);   // (what it was called, it is still called where it comes to rest)
    world.removeBlock(place);
    const rest = world.release([to[0], to[1], place[2]], kind);
    if (!rest) return `You pushed the ${thing.called} into the water. It sinks and is gone.`;
    inner(world).carryName(moving, rest);
    const how = rest[2] === -1 ? 'It floats in the water, level with the ground.' : `The stack there is ${world.height(to)} high.`;
    return `You pushed the ${thing.called} to ${at(to)}. ${how}`;
  },
});

const clock = verb({
  about: 'Look at your watch.',
  args: {},
  does: () => `It is ${new Date().toTimeString().slice(0, 8)}.`,
});

const leave = verb({
  about: 'Leave this world for good.',
  args: {},
  does: (world, me) => world.leave(me, 'It left the world.') && 'You have left.',
});

/** The verbs every block world can give its agents. */
export const basic: Record<'look' | 'walk' | 'jump' | 'take' | 'put' | 'throw' | 'say' | 'note' | 'name' | 'destroy' | 'push' | 'clock' | 'leave', Verb> =
  { look, walk, jump, take, put, throw: throwIt, say, note, name, destroy, push, clock, leave };
