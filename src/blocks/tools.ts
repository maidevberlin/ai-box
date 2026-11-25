// The tools every block world can hand to its agents. A world takes the ones it wants
// (`tools: basic`, or `tools: { look: basic.look, ... }`) and adds its own.
//
// What a tool does differently for a special block is not written here: it comes from
// the kind of block (sticky, floats, or its reactions, see types.ts).

import type { Blocks } from './world.ts';
import { DIRECTIONS, WAYS, tool, type BlockTool, type BlockWorld, type Body, type Cell, type Item, type Loudness, type Place } from './types.ts';

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

// ---------------------------------------------------------------- the tools

const look = tool({
  about: 'Look around, or at something.',
  args: { at: { type: 'one of', options: ['around', 'hand', 'here', 'north', 'south', 'east', 'west'], optional: true } },
  run(world, me, args) {
    const where = args.at ?? 'around';
    if (where === 'hand') {
      if (!me.hand) return 'Your hand is empty.';
      return `You hold a ${world.called(me.hand)}${called(world, me, me.hand)}.${me.hand.text === undefined ? '' : ` It says "${me.hand.text}"`}`;
    }
    if (where !== 'around') return lookedAt(world, me, world.next(me.cell, where));
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
  },
});

const walk = tool({
  about: 'Walk in a direction: one step, or more, up to as far as you see. Tells what is new in sight then.',
  args: {
    direction: { type: 'one of', options: Object.keys(WAYS) },
    steps: { type: 'number', min: 1, whole: true, optional: true },
  },
  run(world, me, args) {
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

const jump = tool({
  about: 'Jump in a direction. More strength gets you further and higher.',
  args: {
    direction: { type: 'one of', options: Object.keys(DIRECTIONS) },
    strength: { type: 'number', min: 1, whole: true },
  },
  run(world, me, { direction, strength }) {
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

const take = tool({
  about: 'Take what lies on top.',
  args: { where: { type: 'one of', options: ['here', 'north', 'south', 'east', 'west'] } },
  run(world, me, { where }) {
    const cell = world.next(me.cell, where), lying = world.items(cell);
    const loose = world.column(cell).filter(([, kind]) => !world.blockKind(kind)!.ground);
    if (!lying.length && !loose.length) return world.column(cell).length ? 'There is nothing to take.' : 'There is only water.';
    const out = outOfReach(world, me, cell, !lying.length);
    if (out) return out;
    if (me.hand) return 'Your hands are full.';
    let said = '';
    if (lying.length) {
      me.hand = lying.at(-1)!;
      world.removeItem(me.hand);
    } else {
      const [z, kind] = loose.at(-1)!;
      me.hand = { kind };
      inner(world).carryName([cell[0], cell[1], z], me.hand);   // (what it was called, it is still called in a hand)
      world.removeBlock([cell[0], cell[1], z]);
      said = inner(world).react(world.blockKind(kind)!.on?.taken, { at: [cell[0], cell[1], z], by: me });
    }
    return `You took a ${world.called(me.hand)}.${said} ${world.where(me)}`;
  },
});

const put = tool({
  about: 'Put down what you carry.',
  args: { where: { type: 'one of', options: ['here', 'north', 'south', 'east', 'west'] } },
  run(world, me, { where }) {
    const thing = me.hand;
    if (!thing) return 'You carry nothing.';
    const cell = world.next(me.cell, where), [x, y] = cell;
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

const throwIt = tool({
  about: 'Throw what you carry.',
  args: {
    direction: { type: 'number', about: 'compass degrees: 0 is north, 90 is east' },
    angle: { type: 'number', about: 'degrees above the ground, 0 to 90', min: 0, max: 90 },
    power: { type: 'number', about: '1 to 10', min: 1, max: 10 },
  },
  run(world, me, { direction, angle, power }) {
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

const say = tool({
  about: 'Say something out loud.',
  args: { text: { type: 'text' }, loudness: { type: 'one of', options: ['whisper', 'normal', 'shout'], optional: true } },
  run(world, me, { text, loudness }) {
    const said = text.slice(0, 500), how = (loudness ?? 'normal') as Loudness;
    world.say(me, said, how);
    return `You ${{ whisper: 'whispered', normal: 'said', shout: 'shouted' }[how]}: "${said}"`;
  },
});

const note = tool({
  about: 'Write a note.',
  args: { text: { type: 'text' } },
  run(_world, me, { text }) {
    if (me.hand) return 'Your hands are full.';
    me.hand = { kind: 'note', text: text.slice(0, 1000) };
    return 'You wrote a note. You hold it in your hand.';
  },
});

const name = tool({
  about: 'Give something a name of your own: what you hold, or what is at a position you can see.',
  args: {
    name: { type: 'text' },
    x: { type: 'number', whole: true, optional: true },
    y: { type: 'number', whole: true, optional: true },
  },
  run(world, me, args) {
    const given = args.name.trim().slice(0, 40), names = inner(world);
    if (!given) return 'Name is missing.';
    if (args.x === undefined || args.y === undefined) {
      if (!me.hand) return 'You hold nothing. Say where the thing is: x and y.';
      names.callIt(me, me.hand, given);
      return `You call the ${world.called(me.hand)} in your hand "${given}" now.`;
    }
    const cell: Cell = [args.x, args.y], far = world.sight(me);
    if (Math.abs(cell[0] - me.cell[0]) > far || Math.abs(cell[1] - me.cell[1]) > far) return 'That is out of your sight.';
    const there = world.bodyAt(cell), lying = world.items(cell).at(-1), top = world.column(cell).at(-1);
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

const clock = tool({
  about: 'Look at your watch.',
  args: {},
  run: () => `It is ${new Date().toTimeString().slice(0, 8)}.`,
});

/** The tools every block world can hand to its agents. */
export const basic: Record<'look' | 'walk' | 'jump' | 'take' | 'put' | 'throw' | 'say' | 'note' | 'name' | 'clock', BlockTool> =
  { look, walk, jump, take, put, throw: throwIt, say, note, name, clock };
