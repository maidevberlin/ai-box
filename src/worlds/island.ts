// The plain island: nothing but the block base.
import { basic, blockWorld } from '../blocks/index.ts';

export default blockWorld({
  name: 'island',
  title: 'Island',
  about: `A flat, square island with a few loose blocks, surrounded by water.

Agents can look, walk, jump, carry, throw, write notes and talk. They are told nothing about
the island. Who steps into the water drowns.`,
  settings: {
    size: { type: 'number', title: 'Size of the island', usual: 20, min: 6, max: 60 },
    loose: { type: 'number', title: 'Loose blocks', usual: 10, min: 0, max: 200 },
    agents: { type: 'number', title: 'Agents alive at the same time', usual: 1, min: 1, max: 8 },
    memory: { type: 'switch', title: 'Agents keep their memory when they wake up again', usual: false },
  },
  minutes: 10,
  roles: chosen => ({
    agent: {
      title: 'Agent', count: chosen.agents, model: 'opus',
      knows: 'This session is not interactive. Nobody is there to answer you. If you end your turn you are gone.',
      told: 'Live!',
      afterDeath: chosen.memory ? 'same agent' : 'new agent',
    },
  }),
  blocks: {
    ground: { colour: '#4f8f34', ground: true },
    grey: { colour: '#8a919c' },
  },
  tools: basic,
  make(world) {
    const cells = world.square(world.chosen.size);
    for (const [x, y] of cells) world.setBlock([x, y, -1], 'ground');
    for (let i = 0; i < world.chosen.loose; i++) {
      const [x, y] = cells[world.pick(cells.length)]!;
      if (x || y) world.setBlock([x, y, world.height([x, y])], 'grey');   // (not where agents wake up)
    }
  },
});
