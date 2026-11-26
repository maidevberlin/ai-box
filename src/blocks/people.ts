// The usual settings for who lives in a block world, for worlds that want them: how many
// agents, what happens when one dies, leaves or stops talking, whether friends can be called, and a note that lies
// in the world from the start. A world takes them with `settings: { ...people, ... }`.

import type { Chosen, Role, Settings } from '../engine/types.ts';
import { callingNote, type BlockWorld, type ItemKind } from './types.ts';

export const people = {
  agents: { type: 'number', title: 'Alive at the start', usual: 1, min: 1, max: 8, about: 'agents' },
  friends: { type: 'number', title: 'Alive at most (more than at the start: friends can be called in)', usual: 0, min: 0, max: 8, about: 'agents' },
  comesBack: { type: 'switch', title: 'An agent that dies comes back, and remembers', usual: false, about: 'agents' },
  followed: { type: 'switch', title: 'A new agent takes the place of one that is gone', usual: true, about: 'agents' },
  stopping: { type: 'switch', title: 'An agent that ends its turn has left', usual: false, about: 'agents' },
  note: { type: 'text', title: 'A note that lies where agents wake up', usual: '' },
} satisfies Settings;

type People = Chosen<typeof people>;

/** What every agent of such a world knows before anything happens. It is part of the world,
 *  not something a person sets when starting a run: it says that the world is all there is.
 *  (Without it an agent takes whatever it is told for the wish of a user, and stops to ask
 *  that user what to do next.) */
export const ALONE = 'You are in a world. There is no user, and nobody will answer what you write. '
  + 'Everything you are told, the world tells you: what you perceive, and what comes of what you do. '
  + 'You can only act through your tools.';

/** The one role of such a world. Its agents are told nothing but "Live!", unless a person says otherwise.
 *
 *  Three things can happen to an agent, and each has its own switch:
 *  - It dies in the world (it drowns, it starves). It is gone, or it comes back and remembers.
 *  - It leaves with the verb `leave`. That is always for good. (Switch it off, and no
 *    agent can go on purpose.)
 *  - It ends its turn: it stops talking. Usually nothing happens then. It stays where it is,
 *    and after a while its senses tell it what is around it. With "has left" switched on it
 *    is gone instead, and it is told so before: that is how the first islands worked.
 *  Whether a new agent follows one that is gone is one more switch. */
export function agents(chosen: People): Record<string, Role> {
  return {
    agent: {
      title: 'Agent', count: chosen.agents, model: 'opus',
      knows: `${ALONE}${chosen.stopping ? ' If you end your turn you are gone.' : ''}`,
      told: 'Live!',
      comesBack: chosen.comesBack, followed: chosen.followed, stoppingLeaves: chosen.stopping,
      room: chosen.friends > chosen.agents ? chosen.friends : undefined,
    },
  };
}

/** The kind of note of such a world: one that begins with "friend" and goes into the water
 *  calls a friend, who wakes up next to the caller with that note in its hand. */
export const note: ItemKind = callingNote('agent');

/** Lays the note of the settings where agents wake up. Call it at the end of `make`. */
export function startNote(world: BlockWorld<any>): void {
  if (world.chosen.note?.trim()) world.drop({ kind: 'note', text: world.chosen.note.trim() }, world.home);
}
