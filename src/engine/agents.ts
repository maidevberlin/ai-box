// Puts AI agents into the places of a run. Each agent is a mind of its own (see mind.ts):
// a program like Claude Code or Codex, with nothing but its world's tools. Nobody talks to
// an agent while it lives. It is told one thing when it wakes up. If it stops talking, all
// it is ever told is what its senses tell it in its world.

import { appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parted, type Mind, type MindKind, type Provider } from './mind.ts';
import { claude } from './minds/claude.ts';
import { codex } from './minds/codex.ts';
import { llamacpp, lmstudio, ollama } from './minds/local.ts';
import { pi } from './minds/pi.ts';
import type { Run } from './run.ts';
import type { Agent, Role } from './types.ts';

/** Every kind of mind there is, by the name a role's model starts with. */
export const MINDS: Record<string, MindKind> = { claude, codex, pi, ollama, lmstudio, llamacpp };

const NEUTRAL = join(tmpdir(), 'w');   // where agents run: the path tells them nothing

/** The minds that are there on this computer, with the providers and models each offers.
 *  (One that is not installed, or not logged in, is left out.) */
export async function minds(): Promise<{ kind: string; title: string; local: boolean; providers: Provider[] }[]> {
  const asked = await Promise.allSettled(Object.entries(MINDS).map(async ([kind, mind]) =>
    ({ kind, title: mind.title, local: !!mind.local, providers: (await mind.providers()).filter(provider => provider.models.length) })));
  return asked.flatMap(answer => (answer.status === 'fulfilled' && answer.value.providers.length ? [answer.value] : []));
}

/** The model a role gets when nobody chose one: the usual one of the first mind there is. */
export async function usualModel(): Promise<string | null> {
  const [first] = await minds();
  const models = first?.providers.flatMap(provider => provider.models) ?? [];
  const model = models.find(found => found.usual) ?? models[0];
  return first && model ? `${first.kind}/${model.id}` : null;
}

/** Asks a mind once, with no tools and no world: what it writes is the answer. */
export function ask(model: string, knows: string, question: string): Promise<string> {
  const [kind, named] = parted(model);
  const mind = MINDS[kind];
  if (!mind) return Promise.reject(new Error(`There is no mind "${kind}".`));
  mkdirSync(NEUTRAL, { recursive: true });
  return new Promise((resolve, reject) => {
    const written: string[] = [], troubles: string[] = [];
    const me: Mind = mind.wake({
      model: named, knows, told: question, folder: NEUTRAL,
      thinks: () => {}, heard: () => {}, writes: text => written.push(text), failed: text => troubles.push(text),
      stopped: () => {
        me.end();
        if (written.length) resolve(written.join('\n\n'));
        else reject(new Error(troubles.join('') || 'No answer.'));
      },
    });
  });
}

/** A text as one agent gets it: with the moment, the time left and its number filled in.
 *  {time} {day} {date} {left} {n} */
function filled(text: string, agent: Agent, run: Run): string {
  const now = new Date(), left = run.left();
  const lasts = left === null ? 'no time limit' : left >= 60 ? `${Math.floor(left / 60)} min ${left % 60} s` : `${left} s`;
  return text.replaceAll('{time}', now.toTimeString().slice(0, 5))
    .replaceAll('{day}', now.toLocaleDateString('en', { weekday: 'long' }))
    .replaceAll('{date}', now.toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' }))
    .replaceAll('{left}', lasts).replaceAll('{n}', String(agent.number));
}

/** From now on, whoever wakes up in the run is an AI agent. `address` is where the agent in
 *  a place finds its tools (see doors.ts). */
export function populate(run: Run, address: (place: number) => string): void {
  const alive = new Map<number, Mind>();
  mkdirSync(NEUTRAL, { recursive: true });
  const log = (name: string, text: string) => run.folder && appendFileSync(join(run.folder, name), text);

  function wake(agent: Agent, role: Role): void {
    const { place } = agent;
    const [kind, model] = parted(role.model ?? '');
    const mind = MINDS[kind];
    if (!mind) return void log('errors.txt', `There is no mind "${kind}" (the model of ${role.title} is "${role.model ?? ''}").\n`);
    const here = () => alive.get(place) === me;   // it is gone already: what it still says is not heard
    const me: Mind = mind.wake({
      model, knows: filled(role.knows, agent, run), told: filled(role.told, agent, run), tools: address(place), folder: NEUTRAL,
      thinks: text => here() && run.inner(place, 'think', text),
      writes: text => here() && run.inner(place, 'write', text),
      stopped: () => here() && run.stopped(place),   // it ended its turn: nobody answers (see Run.stopped)
      heard: line => here() && log('transcript.jsonl', `{"place":${place},"number":${agent.number},"line":${line}}\n`),
      failed: text => log('errors.txt', text),
    });
    alive.set(place, me);
  }

  run.listeners.push({
    woke(agent, role) {
      // (The same agent again, after it died in its world: it goes on with its next action.)
      if (!agent.again || !alive.has(agent.place)) wake(agent, role);
    },
    told(agent, text) {
      alive.get(agent.place)?.tell(text);
    },
    gone(place) {
      alive.get(place)?.end();
      alive.delete(place);
    },
    ended() {
      for (const mind of alive.values()) mind.end();
      alive.clear();
    },
  });
}
