// Orchard: a landscape with a life of its own, which the agents can reshape.
//
// An example of a world with its own verbs (dig, eat), a creature, things that grow by
// themselves over time, and something its agents have to keep up (their strength).
import { agents, basic, blockWorld, people, startNote, verbTo, type BlockWorld, type Body, type Cell, type Deed, type Place } from '../blocks/index.ts';

/** How far across the island is. */
const SIZES = { small: 16, medium: 26, large: 40, huge: 56 };
/** How many trees stand on the island at the start: for every cell of land. */
const TREES = { none: 0, few: 0.012, many: 0.03, loads: 0.07 };
const HILLS = 4;        // how high the highest hills are
const SMELL = 3;         // a rabbit smells a fruit this many steps away
const WARREN = 250;     // one rabbit lives on this many cells of land
const TREE = 2;         // how many trunk blocks a tree has under its leaves
const MOST_TREES = 40;  // no more trees grow than this
const FULL = 20;        // how much strength a rested, fed agent has
const FOOD = 6;         // how much strength a fruit gives

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

/** Soil and grass are dug out the same way. */
const dugOut: Deed = (world, me, thing) => {
  if (!thing.block) return 'Say where to dig.';
  if (me.hand) return 'Your hands are full.';
  const [x, y, z] = thing.block, there = world.bodyAt(thing.cell);
  if (there && there !== me) return 'Somebody stands there.';
  world.removeBlock(thing.block);
  if (world.block([x, y, z - 1]) === 'soil') growOver(world, [x, y, z - 1]);   // the soil under it lies bare now
  me.hand = { kind: 'soil' };
  if (world.chosen.hunger) me.has.strength = me.has.strength! - 1;   // digging is hard work
  return `You dug out the ground at ${world.at(me, thing.cell)}. You hold a ${world.called('soil')} now. ${world.where(me)}`;
};

// The world's own verbs. What they do is written with the kinds they can be done to.
const dig = verbTo({ about: 'Dig out the ground: under you, or next to you.' });
const eat = verbTo({ about: 'Eat something: what you hold, or what lies where you point.' });

export default blockWorld({
  name: 'orchard',
  title: 'Orchard',
  about: `A hilly island with a lake. Trees stand on it and drop fruit, rabbits can live on it, and the
agents can reshape it: they can dig out the ground and put it down somewhere else.

The agents are told nothing about it. The world says what happens, never why.

- The ground is grass over soil over stone. Grass and soil can be dug out, one block at a
  time, and carried and put down like any block. Stone is too hard. So agents can dig holes
  and trenches, pile up hills and walls, and build stairs.
- Walking goes up one level per step. Anything steeper has to be jumped, or dug.
- Bare soil grows over with grass after a while.
- Trees drop a fruit now and then. A fruit that lies on grass or soil long enough grows
  into a young tree, and that into a tree. Rabbits, if there are any, go for fruit that lies near them, and eat it.
- If hunger is on: agents lose strength with time, whether they act or not, and by
  digging. Eating a fruit gives strength back. The world tells an agent when it is hungry.
  Without strength it dies.
- What is around them, agents are usually shown as a small map: words would say nothing of
  the shape of the ground.
- Soil put into the water sinks: the lake cannot be filled.`,
  settings: {
    size: { type: 'choice', title: 'Size of the island', usual: 'medium', options: Object.keys(SIZES) },
    trees: { type: 'choice', title: 'Trees at the start', usual: 'few', options: Object.keys(TREES) },
    rabbits: { type: 'switch', title: 'Rabbits live here', usual: true },
    hunger: { type: 'switch', title: 'Agents get hungry, and die if they do not eat', usual: true },
    ...people,
  },
  minutes: 15,
  roles: agents,
  climb: 1,
  view: 'map',
  blocks: {
    stone: { colour: '#7d8288', called: 'stone', ground: true, can: { dig: 'The stone is too hard to dig.' } },
    soil: {
      colour: '#7a5536', called: 'block of soil', ground: true, soil: true, can: { dig: dugOut },
      on: { appears: (world, { at }) => growOver(world, at) },
    },
    grass: { colour: '#4f8f34', called: 'block of grass', ground: true, soil: true, can: { dig: dugOut } },
    trunk: { colour: '#6b4a2e', called: 'tree trunk', ground: true },
    leaves: {
      colour: '#2f7d32', called: 'tree', sign: 'T', ground: true, soft: true,
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
      colour: '#7bbf5a', called: 'young tree', sign: 't', ground: true, soft: true,
      on: {
        appears: (world, { at }) => world.after(90, () => {
          world.removeBlock(at);
          grow(world, [at[0], at[1]]);
        }, at),
      },
    },
  },
  agent: { can: { push: true } },
  items: {
    fruit: {
      colour: '#c0392b', called: 'fruit', shape: 'ball',
      can: {
        eat(world, me, fruit) {
          if (!world.chosen.hunger) return (world.removeItem(fruit.item!), 'You ate the fruit.');
          if (me.has.strength! >= FULL) return 'You are not hungry.';
          world.removeItem(fruit.item!);
          me.has.strength = Math.min(FULL, me.has.strength! + FOOD);
          return 'You ate the fruit. You feel stronger.';
        },
      },
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
        // It goes for a fruit it smells nearby, and wanders otherwise.
        const [x, y] = me.cell, smelled = world.square(2 * SMELL + 1, me.cell)
          .filter(found => world.items(found).some(item => item.kind === 'fruit'))
          .sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y))[0];
        const dx = smelled ? smelled[0] - x : 0, dy = smelled ? smelled[1] - y : 0;
        const towards = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'north' : 'south';
        const cell = world.next(me.cell, smelled ? towards : ['north', 'south', 'east', 'west'][world.pick(4)]!);
        const gentle = Math.abs(world.height(cell) - world.height(me.cell)) <= 1;
        if (world.standable(cell) && gentle && !world.bodyAt(cell)) world.move(me, cell);
      },
    },
  },
  verbs: { ...basic, dig, eat },
  make(world) {
    const half = SIZES[world.chosen.size as keyof typeof SIZES] / 2;
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
      const high = near ? 0 : Math.round(Math.max(0, value - 0.35) / 0.65 * HILLS * edge);
      world.setBlock([x, y, -2], 'stone');
      for (let z = -1; z < high - 1; z++) world.setBlock([x, y, z], 'soil');
      world.setBlock([x, y, high - 1], 'grass');
      if (!near) land.push(cell);
    }
    // Trees and rabbits: as many as go with the size of the land.
    const cells = land.length, planted = Math.round(cells * TREES[world.chosen.trees as keyof typeof TREES]);
    for (let i = 0; i < planted; i++) grow(world, land.splice(world.pick(land.length), 1)[0]!);
    for (let i = 0; world.chosen.rabbits && i < Math.max(1, Math.round(cells / WARREN)); i++) world.spawn('rabbit', land[world.pick(land.length)]!);
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
});
