// Wild hills: a landscape with a life of its own, which the agents can reshape.
//
// An example of a world with its own tools (dig, eat), a creature, things that grow by
// themselves over time, and something its agents have to keep up (their strength).
import { agents, basic, blockWorld, note, people, startNote, tool, type BlockWorld, type Body, type Cell, type Place } from '../blocks/index.ts';

const HIGHEST = 9;      // the map of the ground shows heights as one digit
const TREE = 2;         // how many trunk blocks a tree has under its leaves
const MOST_TREES = 40;  // no more trees grow than this
const FULL = 20;        // how much strength a rested, fed agent has

const isTree = (world: BlockWorld<any>, cell: Cell) => world.column(cell).some(([, kind]) => kind === 'trunk' || kind === 'sapling');
const trees = (world: BlockWorld<any>) => world.own.trees as Set<string>;

/** A tree grows on a cell: a trunk, with leaves on top. */
function grow(world: BlockWorld<any>, cell: Cell): void {
  const [x, y] = cell, from = world.height(cell);
  for (let z = from; z < from + TREE; z++) world.setBlock([x, y, z], 'trunk');
  world.setBlock([x, y, from + TREE], 'leaves');
  trees(world).add(String(cell));
}

/** Bare soil grows over with grass after a while, if nothing was put on it by then. */
function growOver(world: BlockWorld<any>, at: Place): void {
  world.after(60, () => {
    if (world.block(at) === 'soil' && world.height([at[0], at[1]]) === at[2] + 1) world.setBlock(at, 'grass');
  }, at);
}

/** The ground around an agent as a small map of heights, for looking around. */
function map(world: BlockWorld<any>, me: Body): string {
  const [x, y] = me.cell, far = world.sight(me), rows: string[] = [];
  for (let cy = y + far; cy >= y - far; cy--) {
    const row: string[] = [];
    for (let cx = x - far; cx <= x + far; cx++) {
      const cell: Cell = [cx, cy];
      const sign = !world.column(cell).length ? '~' : isTree(world, cell) ? 'T' : String(Math.min(HIGHEST, Math.max(0, world.height(cell))));
      row.push(cx === x && cy === y ? `[${sign}]` : ` ${sign} `);
    }
    rows.push(row.join(''));
  }
  return `The ground around you, as heights (north is at the top, [ ] is where you stand, ~ is water, T is a tree):\n${rows.join('\n')}`;
}

const dig = tool({
  about: 'Dig out the ground: under you, or next to you.',
  args: { where: { type: 'one of', options: ['here', 'north', 'south', 'east', 'west'] } },
  run(world, me, { where }) {
    if (me.hand) return 'Your hands are full.';
    const cell = world.next(me.cell, where), top = world.column(cell).at(-1);
    if (!top) return 'There is only water.';
    const [z, kind] = top, there = world.bodyAt(cell);
    if (there && there !== me) return 'Somebody stands there.';
    if (Math.abs(world.height(cell) - world.height(me.cell)) > 2) return 'That is out of your reach.';
    if (!world.blockKind(kind)!.soil) return kind === 'stone' ? 'The stone is too hard to dig.' : `You cannot dig out a ${world.called(kind)}.`;
    world.removeBlock([cell[0], cell[1], z]);
    if (world.block([cell[0], cell[1], z - 1]) === 'soil') growOver(world, [cell[0], cell[1], z - 1]);   // the soil under it lies bare now
    me.hand = { kind: 'soil' };
    if (world.chosen.hunger) me.has.strength = me.has.strength! - 1;   // digging is hard work
    return `You dug out the ground at (${cell[0]}, ${cell[1]}). You hold a ${world.called('soil')} now. ${world.where(me)}`;
  },
});

const eat = tool({
  about: 'Eat what you hold.',
  args: {},
  run(world, me) {
    const food = me.hand && world.itemKind(me.hand.kind)?.food;
    if (typeof food !== 'number') return me.hand ? `You cannot eat a ${world.called(me.hand)}.` : 'You hold nothing.';
    me.hand = null;
    if (world.chosen.hunger) me.has.strength = Math.min(FULL, me.has.strength! + food);
    return 'You ate it. You feel stronger.';
  },
});

export default blockWorld({
  name: 'hills',
  title: 'Wild hills',
  about: `A hilly island with a lake. Trees stand on it and drop fruit, rabbits live on it, and the
agents can reshape it: they can dig out the ground and put it down somewhere else.

The agents are told nothing about it. The world says what happens, never why.

- The ground is grass over soil over stone. Grass and soil can be dug out, one block at a
  time, and carried and put down like any block. Stone is too hard. So agents can dig holes
  and trenches, pile up hills and walls, and build stairs.
- Walking goes up one level per step. Anything steeper has to be jumped, or dug.
- Bare soil grows over with grass after a while.
- Trees drop a fruit now and then. A fruit that lies on grass or soil long enough grows
  into a young tree, and that into a tree. Rabbits eat fruit they find.
- If hunger is on: agents lose strength with time, whether they act or not, and by
  digging. Eating a fruit gives strength back. The world tells an agent when it is hungry.
  Without strength it dies.
- Looking around shows the ground as a small map of heights.
- Soil put into the water sinks: the lake cannot be filled.`,
  settings: {
    size: { type: 'number', title: 'Size of the island', usual: 26, min: 12, max: 60 },
    height: { type: 'number', title: 'How high the hills are', usual: 4, min: 0, max: 8 },
    trees: { type: 'number', title: 'Trees at the start', usual: 6, min: 0, max: 30 },
    rabbits: { type: 'number', title: 'Rabbits', usual: 2, min: 0, max: 10 },
    hunger: { type: 'switch', title: 'Agents get hungry, and die if they do not eat', usual: true },
    ...people,
  },
  minutes: 15,
  roles: agents,
  climb: 1,
  blocks: {
    stone: { colour: '#7d8288', called: 'stone', ground: true },
    soil: {
      colour: '#7a5536', called: 'block of soil', ground: true, soil: true,
      on: { appears: (world, { at }) => growOver(world, at) },
    },
    grass: { colour: '#4f8f34', called: 'block of grass', ground: true, soil: true },
    trunk: { colour: '#6b4a2e', called: 'tree trunk', ground: true },
    leaves: {
      colour: '#2f7d32', called: 'treetop', ground: true, soft: true,
      on: {
        // Now and then a fruit drops from a tree, onto the ground next to it.
        appears: (world, { at }) => world.every(30, () => {
          if (world.random() > 0.35) return;
          const way = ['north', 'south', 'east', 'west'][world.pick(4)]!;
          const cell = world.next([at[0], at[1]], way);
          if (world.standable(cell) && world.items(cell).length < 3) world.drop({ kind: 'fruit' }, cell);
        }, at),
      },
    },
    sapling: {
      colour: '#7bbf5a', called: 'young tree', ground: true, soft: true,
      on: {
        appears: (world, { at }) => world.after(90, () => {
          world.removeBlock(at);
          grow(world, [at[0], at[1]]);
        }, at),
      },
    },
  },
  items: {
    note,
    fruit: {
      colour: '#c0392b', called: 'fruit', shape: 'ball', food: 6,
      on: {
        // A fruit that is left lying on grass or soil grows into a young tree.
        landed: (world, { at, item }) => world.after(120, () => {
          const cell: Cell = [at[0], at[1]], top = world.top(cell);
          const lies = world.items(cell).includes(item!), room = trees(world).size < MOST_TREES && !world.bodyAt(cell);
          if (!lies || !room || !top || !world.blockKind(top)!.soil) return;
          for (const other of world.items(cell)) world.removeItem(other);
          world.setBlock([cell[0], cell[1], world.height(cell)], 'sapling');
          trees(world).add(String(cell));
        }),
      },
    },
  },
  creatures: {
    rabbit: {
      colour: '#d8d2c4', called: 'rabbit', every: 4,
      does(world, me) {
        const fruit = world.items(me.cell).find(item => item.kind === 'fruit');
        if (fruit) return world.removeItem(fruit);   // it eats what it finds
        const cell = world.next(me.cell, ['north', 'south', 'east', 'west'][world.pick(4)]!);
        const gentle = Math.abs(world.height(cell) - world.height(me.cell)) <= 1;
        if (world.standable(cell) && gentle && !world.bodyAt(cell)) world.move(me, cell);
      },
    },
  },
  tools: { ...basic, dig, eat },
  make(world) {
    const { size, height } = world.chosen, half = size / 2;
    world.own.trees = new Set<string>();
    // Rolling ground: a few random heights far apart, with smooth slopes between them.
    const step = 6, knots = new Map<string, number>();
    const knot = (i: number, j: number) => {
      if (!knots.has(`${i},${j}`)) knots.set(`${i},${j}`, world.random());
      return knots.get(`${i},${j}`)!;
    };
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const rolling = (x: number, y: number) => {
      const i = Math.floor(x / step), j = Math.floor(y / step), u = smooth(x / step - i), v = smooth(y / step - j);
      return (knot(i, j) * (1 - u) + knot(i + 1, j) * u) * (1 - v) + (knot(i, j + 1) * (1 - u) + knot(i + 1, j + 1) * u) * v;
    };
    const land: Cell[] = [];
    for (const cell of world.disc(Math.floor(half))) {
      const [x, y] = cell, value = rolling(x, y), near = Math.hypot(x, y) < 3;
      const edge = Math.min(1, (half - Math.hypot(x, y)) / 3);   // the hills flatten towards the shore
      if (value < 0.22 && !near) continue;                        // the lowest places are the lake
      const high = near ? 0 : Math.round(Math.max(0, value - 0.35) / 0.65 * height * edge);
      world.setBlock([x, y, -2], 'stone');
      for (let z = -1; z < high - 1; z++) world.setBlock([x, y, z], 'soil');
      world.setBlock([x, y, high - 1], 'grass');
      if (!near) land.push(cell);
    }
    for (let i = 0; i < world.chosen.trees && land.length; i++) {
      const cell = land.splice(world.pick(land.length), 1)[0]!;
      grow(world, cell);
    }
    for (let i = 0; i < world.chosen.rabbits && land.length; i++) world.spawn('rabbit', land[world.pick(land.length)]!);
    // Hunger comes with time, not with actions: an agent that thinks for long gets hungry too.
    if (world.chosen.hunger) {
      world.every(15, () => {
        for (const body of world.bodies().filter(found => found.agent)) {
          const left = body.has.strength = (body.has.strength ?? FULL) - 1;
          if (left <= 0) world.die(body, 'You have no strength left. You collapse.');
          else if (left === 6) world.notice(body, 'You are hungry.');
          else if (left === 3) world.notice(body, 'You are very hungry. You feel weak.');
        }
      });
    }
    startNote(world);
  },
  wake(world, me) {
    me.has.strength = FULL;
  },
  /** Digging can take the last of an agent's strength. */
  afterAction(world, me) {
    if (world.chosen.hunger && me.has.strength! <= 0) return world.die(me, 'You have no strength left. You collapse.');
  },
  alsoSeen: (world, me) => [map(world, me)],
});
