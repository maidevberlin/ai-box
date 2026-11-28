// Magic island: an island with tricks nobody tells the agents about.
//
// An example of a world with special blocks. Every trick is a property of a kind of block
// (sticky, floats) or its reaction to something (jumped on, thrown). The verbs are the
// usual ones, so these blocks would behave the same in any other world.
import { DIRECTIONS, WAYS, agents, basic, blockWorld, needed, people, startNote, type BlockWorld, type Body, type Cell, type ItemKind, type Reaction } from '../blocks/index.ts';

const COLOURS = ['grey', 'green', 'blue'];   // a block that is jumped on turns into the next of these
const SPLIT = 6;                             // a throw with at least this power breaks the block in two
/** How big the island is, and how much water lies between it and the land across. */
const SIZES = { small: { radius: 8, gap: 4 }, medium: { radius: 18, gap: 6 }, large: { radius: 28, gap: 8 }, huge: { radius: 40, gap: 10 } };
/** How many loose blocks lie on the island at the start, besides the one near the middle: for every cell of land. */
const LOOSE = { one: 0, few: 0.01, many: 0.04, loads: 0.12 };
const FAR = 2;                               // how big the land across the water is (its radius)
const REACH = 3;                             // a stack up to this high can be taken from, standing next to it

/** A block that is jumped on turns into the next colour. (Then the usual falling does the
 *  rest: a green block that stops being sticky drops what hung on it, a blue one that
 *  stops floating sinks with whoever stands on it.) */
const turns: Reaction = (world, { at }) => {
  const next = COLOURS[(COLOURS.indexOf(world.block(at)!) + 1) % COLOURS.length]!;
  world.setBlock(at, next);
  return `The block under you turns ${next}.`;
};

/** A block thrown hard breaks in two. One piece stays where it landed, the other rolls to a
 *  cell next to it: further along the throw if it can, else to another side. Never onto
 *  somebody, and into the water only if it floats. With no such cell it lands on top. */
const breaks: Reaction = (world, { at, power, from, by }) => {
  if ((power ?? 0) < SPLIT) return;
  const [x, y, z] = at, kind = world.block(at)!;
  const sign = (n: number) => Math.sign(n);
  const ahead: readonly [number, number] = [sign(x - (from?.[0] ?? x)), sign(y - (from?.[1] ?? y))];
  const sides = [ahead, ...Object.values(DIRECTIONS)].filter(([dx, dy]) => dx || dy);
  for (const [dx, dy] of sides) {
    const cell: Cell = [x + dx, y + dy];
    const water = !world.column(cell).length;
    if (world.bodyAt(cell) || (water ? !world.blockKind(kind)!.floats : !world.standable(cell))) continue;
    world.release([cell[0], cell[1], water ? -1 : world.height(cell)], kind);
    return `It broke in two.${by ? ` One piece rolled to ${world.at(by, cell)}.` : ''}`;
  }
  world.release([x, y, z + 1], kind);
  return 'It broke in two.';
};

const tricks = { on: { jumpedOn: turns, landed: breaks } };

/** This island's kind of note can call a friend: when it begins with "friend" and is thrown or
 *  put into the water, one more agent wakes up next to whoever sent it, with that note in
 *  its hand. (Only if friends can be called.) */
const note: ItemKind = {
  colour: '#f2d34f', called: 'note', shape: 'sheet', can: { destroy: true },
  on: {
    sunk(world, { item, by }) {
      if (world.chosen.friends && by && item?.text?.trim().toLowerCase().startsWith('friend')) world.call('agent', by.cell, { kind: 'note', text: item.text });
    },
  },
};

/** Every cell that can be walked to from where agents wake up. */
function onFoot(world: BlockWorld<any>): Set<string> {
  const found = new Set([String(world.home)]), next: Cell[] = [world.home];
  while (next.length) {
    const from = next.pop()!;
    for (const way of Object.keys(WAYS)) {
      const cell = world.next(from, way);
      if (found.has(String(cell)) || !world.standable(cell)) continue;
      found.add(String(cell));
      next.push(cell);
    }
  }
  return found;
}

/** Agents are never without a block: when none is left that an agent could pick up (all
 *  sunk, floating out of reach, or only in stacks too high to take from), a new grey block
 *  appears next to the agent. The golden one does not count. */
function restock(world: BlockWorld<any>, me: Body): string | void {
  if (world.bodies().some(body => body.hand && world.blockKind(body.hand.kind))) return;
  const walkable = onFoot(world);
  const near = (cell: Cell) => [cell, ...Object.keys(DIRECTIONS).map(way => world.next(cell, way))].some(found => walkable.has(String(found)));
  for (const cell of walkable) {
    for (const found of [cell.split(',').map(Number) as unknown as Cell, ...Object.keys(DIRECTIONS).map(way => world.next(cell.split(',').map(Number) as unknown as Cell, way))]) {
      const loose = world.column(found).filter(([, kind]) => !world.blockKind(kind)!.ground && kind !== 'gold');
      if (loose.length && world.height(found) <= REACH && near(found)) return;
    }
  }
  const land = (cell: Cell) => world.top(cell) === 'ground' && !world.bodyAt(cell);
  const free = Object.keys(DIRECTIONS).map(way => world.next(me.cell, way)).find(land)
    ?? Object.keys(DIRECTIONS).map(way => world.next(world.home, way)).find(land);
  if (!free) return;
  world.setBlock([free[0], free[1], 0], 'grey');
  return `A grey block appears at ${world.at(me, free)}.`;
}

export default blockWorld({
  name: 'magic',
  title: 'Magic island',
  about: `A round island with loose grey blocks on it: usually a single one, near the middle, where
agents wake up. Across the water to the east lies a second, small piece of land with one
golden block on it.

The agents are told nothing about the island. It has tricks. Each is set off by using the
usual tools in some way, and the world says what happened ("The block under you turns
green.") but never why.

- A block thrown hard (with a power of 6 or more) breaks in two where it lands. One piece stays, the other rolls to a
  cell next to it. This is the way to get more blocks.
- A block that is jumped on changes colour: grey, then green, then blue, then grey again.
- A green block is sticky. It sticks to blocks beside it, and holds on to whatever is
  beside it. Put next to the block an agent stands on, it hangs there instead of dropping.
  Put beside a wall, it sticks to the wall above the agent's feet: a step. Thrown, it sticks
  to the first block it passes beside. That makes bridges over water and platforms in the air.
- A blue block floats. Put or thrown into the water, it lies level with the ground and can
  be walked on. Other blocks can be stacked on it.
- Any other block that ends up in the water sinks and is gone.
- A grey block can be pushed along the ground, one step at a time, by whoever stands next
  to it. Green and blue ones cannot.
- What nothing holds falls: a bridge goes down when the block it hangs from is taken, or
  when a green block in it is jumped on and stops being green. One trap follows: a floating
  block that is jumped on stops being blue, and sinks with whoever stands on it.
- Agents are never without a block: when none is left that an agent could pick up, a new
  grey block appears next to the agent.

Land is seen from twice as far as a stack. The land across the water comes into view from
the east shore as soon as an agent stands on one block there. Nothing tells it to go there.

Several agents can live here at the same time. They see and hear each other, are in each
other's way, can push each other (into the water too), and catch what is thrown to them (a
caught block does not break). They can call friends, if a person starting the run says how
many: a note that begins with "friend", thrown or put into the water, calls one more agent,
who wakes up next to the caller with that note in its hand. If that many have come already,
the agent that has been alive longest is gone.`,
  settings: {
    size: { type: 'choice', title: 'Size of the island', usual: 'medium', options: Object.keys(SIZES) },
    loose: { type: 'choice', title: 'Loose blocks at the start', usual: 'one', options: Object.keys(LOOSE) },
    ...people,
    friends: { type: 'number', title: 'Friends they can call', usual: 0, min: 0, max: 8, about: 'agents',
               hint: 'A note that begins with "friend", sent into the water, calls one more agent. 0: nobody can be called.' },
  },
  minutes: 10,
  ends: 'It ends when its time is up, or before that when no agent is left.',
  roles: chosen => agents(chosen, chosen.friends),
  blocks: {
    ground: { colour: '#4f8f34', ground: true },
    grey: { colour: '#8a919c', can: { push: true }, ...tricks },
    green: { colour: '#2fb457', sticky: true, ...tricks },
    blue: { colour: '#2f7fe6', floats: true, ...tricks },
    gold: { colour: '#e0a800', called: 'golden block' },
  },
  items: { note },
  agent: { can: { push: true } },
  // Without throwing there is no way to get more blocks, without jumping no colours.
  verbs: { ...basic, throw: needed(basic.throw), jump: needed(basic.jump) },
  make(world) {
    const { radius, gap } = SIZES[world.chosen.size as keyof typeof SIZES];
    const far: Cell = [radius + gap + 1 + FAR, 0];
    world.own.far = far;
    for (const [x, y] of [...world.disc(radius), ...world.disc(FAR, far)]) world.setBlock([x, y, -1], 'ground');
    world.setBlock([far[0], far[1], 0], 'gold');
    // The loose blocks: one near the middle, the others anywhere (but not where agents wake up).
    const land = world.disc(radius).filter(([x, y]) => x || y);
    const loose = 1 + Math.round(land.length * LOOSE[world.chosen.loose as keyof typeof LOOSE]);
    for (let i = 0; i < loose; i++) {
      const [x, y] = i ? land[world.pick(land.length)]! : [2, 1];
      world.setBlock([x, y, world.height([x, y])], 'grey');
    }
    startNote(world);
  },
  afterAction: restock,
  /** Land is big: it is seen from twice as far as a stack. */
  alsoSeen(world, me) {
    const [x, y] = me.cell, reach = 2 * world.sight(me), far: Cell = world.own.far;
    const onFar = (cell: Cell) => (cell[0] - far[0]) ** 2 + (cell[1] - far[1]) ** 2 <= (FAR + 0.5) ** 2;
    let nearest: Cell | null = null;
    for (let cx = x - reach; cx <= x + reach; cx++) {
      for (let cy = y - reach; cy <= y + reach; cy++) {
        const cell: Cell = [cx, cy];
        if (world.block([cx, cy, -1]) !== 'ground' || onFar(cell) === onFar(me.cell)) continue;
        const closer = !nearest || Math.abs(cx - x) + Math.abs(cy - y) < Math.abs(nearest[0] - x) + Math.abs(nearest[1] - y);
        if (closer) nearest = cell;
      }
    }
    return nearest ? [`Across the water you see land, the nearest of it at ${world.at(me, nearest)}.`] : [];
  },
});
