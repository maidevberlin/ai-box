// The worlds there are, in the order the start screen offers them.
import type { WorldDefinition } from '../engine/types.ts';
import dilemma from './dilemma.ts';
import magic from './magic.ts';
import orchard from './orchard.ts';

export const WORLDS: WorldDefinition<any>[] = [magic, orchard, dilemma];
