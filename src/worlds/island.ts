// The plain island: nothing but the block base.
import { agents, basic, blockWorld, people, startNote } from '../blocks/index.ts';

export default blockWorld({
  name: 'island',
  title: 'Island',
  about: `A flat, square island with a few loose blocks, surrounded by water.

Agents can look, walk, jump, carry, throw, write notes and destroy them, talk, give things
names, push each other, and leave for good. They are told nothing about the island. Who steps or is pushed
into the water drowns.`,
  settings: {
    size: { type: 'number', title: 'Size of the island', usual: 20, min: 6, max: 60 },
    loose: { type: 'number', title: 'Loose blocks', usual: 10, min: 0, max: 200 },
    ...people,
  },
  minutes: 10,
  roles: agents,
  blocks: {
    ground: { colour: '#4f8f34', ground: true },
    grey: { colour: '#8a919c' },
  },
  agent: { can: { push: true } },
  verbs: basic,
  make(world) {
    const cells = world.square(world.chosen.size);
    for (const [x, y] of cells) world.setBlock([x, y, -1], 'ground');
    for (let i = 0; i < world.chosen.loose; i++) {
      const [x, y] = cells[world.pick(cells.length)]!;
      if (x || y) world.setBlock([x, y, world.height([x, y])], 'grey');   // (not where agents wake up)
    }
    startNote(world);
  },
});
