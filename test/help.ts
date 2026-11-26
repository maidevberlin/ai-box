// For the tests: an agent says what it means by a position. A test may say "east" for the
// cell east of whoever acts, which reads better than working out positions by hand.
import { DIRECTIONS, type BlockWorld } from '../src/blocks/index.ts';
import type { Run } from '../src/engine/run.ts';

export function act(run: Run, place: number, verb: string, args: Record<string, unknown> = {}): Promise<string> {
  const me = (run.world as unknown as BlockWorld<any>).bodies().find(body => body.agent?.place === place);
  const said = { ...args };
  for (const key of ['what', 'where']) {
    const step = DIRECTIONS[said[key] as keyof typeof DIRECTIONS];
    if (step && me && verb !== 'walk') said[key] = `(${me.cell[0] + step[0]}, ${me.cell[1] + step[1]})`;
  }
  return run.act(place, verb, said);
}
