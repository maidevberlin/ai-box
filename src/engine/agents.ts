// Puts AI agents into the places of a run. Each agent is a process of Claude Code with
// nothing but its world's tools: no built-in tools, no settings, no skills, no memory.
// Nobody talks to an agent while it lives. It is told one thing when it wakes up. If it
// stops talking, all it is ever told is what its senses tell it in its world.

import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Run } from './run.ts';
import type { Agent, Role } from './types.ts';

const NEUTRAL = join(tmpdir(), 'w');   // where agents run: the path tells them nothing

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
  const alive = new Map<number, ChildProcess>();
  mkdirSync(NEUTRAL, { recursive: true });
  const log = (name: string, text: string) => run.folder && appendFileSync(join(run.folder, name), text);

  const tell = (process: ChildProcess, text: string) => {
    process.stdin!.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
  };

  function wake(agent: Agent, role: Role): void {
    const { place } = agent;
    const config = { mcpServers: { world: { type: 'http', url: address(place) } } };
    const process = spawn('claude', [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--system-prompt', filled(role.knows, agent, run),
      '--model', role.model,
      '--mcp-config', JSON.stringify(config), '--strict-mcp-config',
      '--tools', '', '--allowedTools', 'mcp__world',
      '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence',
      '--thinking-display', 'summarized',
    ], { cwd: NEUTRAL, stdio: ['pipe', 'pipe', 'pipe'] });
    alive.set(place, process);
    process.stderr!.on('data', chunk => log('errors.txt', String(chunk)));
    process.on('error', error => log('errors.txt', `${error}\n`));
    let rest = '';
    process.stdout!.on('data', chunk => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop()!;
      for (const line of lines) {
        if (alive.get(place) !== process) return;   // it is gone already: what it still says is not heard
        log('transcript.jsonl', `{"place":${place},"number":${agent.number},"line":${line}}\n`);
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === 'assistant') {
          for (const part of event.message?.content ?? []) {
            if (part.type === 'thinking' && part.thinking?.trim()) run.inner(place, 'think', part.thinking.trim());
            if (part.type === 'text' && part.text?.trim()) run.inner(place, 'write', part.text.trim());
          }
        } else if (event.type === 'result') {   // it ended its turn: nobody answers (see Run.stopped)
          run.stopped(place);
        }
      }
    });
    tell(process, filled(role.told, agent, run));
  }

  run.listeners.push({
    woke(agent, role) {
      const process = alive.get(agent.place);
      // (The same agent again, after it died in its world: it goes on with its next action.)
      if (!agent.again || !process) wake(agent, role);
    },
    told(agent, text) {
      const process = alive.get(agent.place);
      if (process) tell(process, text);
    },
    gone(place) {
      alive.get(place)?.kill();
      alive.delete(place);
    },
    ended() {
      for (const process of alive.values()) process.kill();
      alive.clear();
    },
  });
}
