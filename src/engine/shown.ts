// How what agents do is shown to a person who watches a run: the icon of each doing, and
// whether it is folded in the conversation or shown over the agent's head (see Shown). The
// agents never see any of it.

import { WAIT } from './run.ts';
import { usual, type Shown, type WorldDefinition } from './types.ts';

/** How what an agent does is shown, by the name of the tool, or of the event for what is not
 *  a tool (`think`, `write`): as its tools say, and the run's own doings, unless the world
 *  says otherwise. */
export function showing(definition: WorldDefinition<any>, chosen: Record<string, unknown>): Record<string, Shown> {
  const own: Record<string, Shown | undefined> = { ...Object.fromEntries(Object.entries(definition.tools({ ...usual(definition.settings), ...chosen })).map(([name, tool]) => [name, tool.shown])),
                                                    wait: WAIT.shown, think: { icon: 'brain', overHead: true }, write: { icon: 'pencil', overHead: true } };
  return Object.fromEntries([...new Set([...Object.keys(own), ...Object.keys(definition.shown ?? {})])].map(name =>
    [name, { icon: 'dot', ...own[name], ...definition.shown?.[name] }]));
}
