// The plain island: nothing but the block base.
import { agents, basic, blockWorld, note, people, startNote } from '../blocks/index.ts';

export default blockWorld({
  name: 'island',
  title: 'Island',
  about: `A flat, square island with a few loose blocks, surrounded by water.

Agents can look, walk, jump, carry, throw, write notes, talk, and give things names. They are
told nothing about the island. Who steps into the water drowns.

If there is room for friends: a note that begins with "friend", thrown or put into the
water, calls one more agent. It wakes up next to the caller with that note in its hand. If
the world is full, the agent that has been alive longest is gone. Nothing tells the agents
this, unless the note that lies in the world from the start does.`,
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
  items: { note },
  tools: basic,
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
