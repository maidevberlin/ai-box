// The usual settings for who lives in a block world, for worlds that want them: how many
// agents, what happens when one dies, whether friends can be called, and a note that lies
// in the world from the start. A world takes them with `settings: { ...people, ... }`.

import type { Chosen, Role, Settings } from '../engine/types.ts';
import { callingNote, type BlockWorld, type ItemKind } from './types.ts';

const AFTER = {
  'A new agent takes its place': 'new agent',
  'It comes back and remembers': 'same agent',
  'Nobody follows': 'nobody',
} as const;

export const people = {
  agents: { type: 'number', title: 'Agents alive at the start', usual: 1, min: 1, max: 8 },
  after: { type: 'choice', title: 'When an agent dies', usual: 'A new agent takes its place', options: Object.keys(AFTER) },
  friends: { type: 'number', title: 'Room for friends: agents alive at most (0: nobody can be called)', usual: 0, min: 0, max: 8 },
  note: { type: 'text', title: 'A note that lies where agents wake up', usual: '' },
} satisfies Settings;

type People = Chosen<typeof people>;

/** The one role of such a world. Its agents are told nothing but "Live!", unless a person says otherwise.
 *
 *  "When an agent dies" also says what happens when one ends its turn: a new agent takes
 *  its place then too. One that comes back has not died by ending its turn: it stays where
 *  it is, and is told again. */
export function agents(chosen: People): Record<string, Role> {
  return {
    agent: {
      title: 'Agent', count: chosen.agents, model: 'opus',
      knows: 'This session is not interactive. Nobody is there to answer you. If you end your turn you are gone.',
      told: 'Live!',
      afterDeath: AFTER[chosen.after as keyof typeof AFTER] ?? 'new agent',
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
