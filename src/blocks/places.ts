// How a place is said: to an agent, and by an agent. There are two ways. On the map every
// cell has its position, "(3, 4)", the same for everyone, and an agent is told where it is.
// From here a place is said by the steps to it from where the agent stands, "(2 east,
// 1 north)", and an agent is never told where it is: it has to find its own way of knowing.
//
// Every sentence of the base that speaks of a place gets it from here (BlockWorld.at), and
// what an agent points at by a position is made out here (see `aim` in verbs.ts).

import type { Cell } from './types.ts';

export interface Places {
  /** A position as agents are told to say one, for what they read about their tools. */
  example: string;
  /** A cell as it is said to somebody who stands at `from`. */
  told(from: Cell, cell: Cell): string;
  /** Where somebody stands, for "You are …, on the ground.": with a space after it, or nothing. */
  standing(cell: Cell): string;
  /** The cell somebody who stands at `from` means by a position, if it is one. */
  meant(from: Cell, text: string): Cell | undefined;
}

export const onTheMap: Places = {
  example: '"(2, 1)"',
  told: (_from, cell) => `(${cell[0]}, ${cell[1]})`,
  standing: cell => `at (${cell[0]}, ${cell[1]}), `,
  meant(_from, text) {
    const found = text.match(/^\(?\s*(-?\d+)\s*[,;\s]\s*(-?\d+)\s*\)?$/);
    return found ? [Number(found[1]), Number(found[2])] : undefined;
  },
};

const STEPS: Record<string, readonly [number, number]> = { east: [1, 0], west: [-1, 0], north: [0, 1], south: [0, -1] };

export const fromHere: Places = {
  example: '"(2 east, 1 north)"',
  told(from, cell) {
    const dx = cell[0] - from[0], dy = cell[1] - from[1];
    const parts = [dx && `${Math.abs(dx)} ${dx > 0 ? 'east' : 'west'}`, dy && `${Math.abs(dy)} ${dy > 0 ? 'north' : 'south'}`].filter(Boolean);
    return `(${parts.join(', ') || 'here'})`;
  },
  standing: () => '',
  meant(from, text) {
    // "(2 east, 1 north)", "1 south", "west": steps and where to, one after the other.
    const words = text.trim().replace(/^\(|\)$/g, '').toLowerCase().split(/[\s,;]+|\band\b/).filter(Boolean);
    if (words.join(' ') === 'here') return from;
    let [x, y] = from, steps: number | undefined, any = false;
    for (const word of words) {
      const step = STEPS[word];
      if (step) {
        x += step[0] * (steps ?? 1);
        y += step[1] * (steps ?? 1);
        steps = undefined;
        any = true;
      } else if (/^\d+$/.test(word) && steps === undefined) steps = Number(word);
      else return undefined;
    }
    return any && steps === undefined ? [x, y] : undefined;
  },
};
