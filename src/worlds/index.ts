// The worlds there are: every file in this folder is one world.
import { readdirSync } from 'node:fs';
import type { WorldDefinition } from '../engine/types.ts';

export async function worlds(): Promise<Record<string, WorldDefinition<any>>> {
  const found: Record<string, WorldDefinition<any>> = {};
  for (const file of readdirSync(import.meta.dirname).sort()) {
    if (!file.endsWith('.ts') || file === 'index.ts') continue;
    const world: WorldDefinition<any> = (await import(`./${file}`)).default;
    found[world.name] = world;
  }
  return found;
}
