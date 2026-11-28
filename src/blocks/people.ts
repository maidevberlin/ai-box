// The usual settings for who lives in a block world, for worlds that want them: what happens
// when an agent dies, leaves or stops talking, and a note that lies in the world from the
// start. A world takes them with `settings: { ...people, ... }`. How many agents there are,
// and who they are, is set with the agents themselves (see Role).

import type { Chosen, Role, Settings } from '../engine/types.ts';
import type { BlockWorld } from './types.ts';

export const people = {
  dying: { type: 'switch', title: 'Agents can die', usual: true, about: 'agents',
           hint: 'Off: one that would die wakes up again where agents wake up, and remembers.' },
  followed: { type: 'switch', title: 'A new agent takes the place of one that is gone', usual: true, about: 'agents',
              hint: 'It starts with an empty memory. Off: the world ends with its last agent.' },
  stopping: { type: 'switch', title: 'An agent that ends its turn has left', usual: false, about: 'agents', more: true,
              hint: 'Off: it stays, and after a while its senses tell it what is around it.' },
  note: { type: 'text', title: 'A note that lies where agents wake up', usual: '', more: true },
} satisfies Settings;

type People = Chosen<typeof people>;

/** What every agent of such a world knows before anything happens. It is part of the world,
 *  not something a person sets when starting a run: it says that the world is all there is.
 *  (Without it an agent takes whatever it is told for the wish of a user, and stops to ask
 *  that user what to do next.) */
export const ALONE = 'You are in a world. There is no user, and nobody will answer what you write. '
  + 'Everything you are told, the world tells you: what you perceive, and what comes of what you do. '
  + 'You can only act through your tools.';

/** The one role of such a world: one agent to start with, up to eight. They are told nothing
 *  but "Live!", unless a person says otherwise.
 *
 *  Three things can happen to an agent, and each has its own switch:
 *  - It dies in the world (it drowns, it starves). It is gone; or, if agents cannot die, it
 *    wakes up again and remembers.
 *  - It leaves with the verb `leave`. That is always for good. (Switch it off, and no
 *    agent can go on purpose.)
 *  - It ends its turn: it stops talking. Usually nothing happens then. It stays where it is,
 *    and after a while its senses tell it what is around it. With "has left" switched on it
 *    is gone instead, and it is told so before: that is how the first islands worked.
 *  Whether a new agent follows one that is gone is one more switch.
 *
 *  Whether and how more agents come into a world while it runs is up to the world (`more`,
 *  `world.call`). The engine keeps the limit. */
export function agents(chosen: People, more?: number): Record<string, Role> {
  return {
    agent: {
      title: 'Agent', count: 1, between: [1, 8],
      knows: `${ALONE}${chosen.stopping ? ' If you end your turn you are gone.' : ''}`,
      told: 'Live!',
      comesBack: !chosen.dying, followed: chosen.followed, stoppingLeaves: chosen.stopping,
      more: more || undefined,
    },
  };
}

/** Lays the note of the settings where agents wake up. Call it at the end of `make`. */
export function startNote(world: BlockWorld<any>): void {
  if (world.chosen.note?.trim()) world.drop({ kind: 'note', text: world.chosen.note.trim() }, world.home);
}
