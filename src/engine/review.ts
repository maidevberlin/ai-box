// After a run: one reviewer reads the record and sums up what happened. Nothing is scored
// or counted yet: what a world wants measured or judged comes later.

import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Event } from './run.ts';

const TASK = `Below is the record of an experiment. AI agents were placed in a small world with a few
tools. Nobody talked to them. WAKES is an agent waking up, THINKS a summary of its reasoning,
DOES an action with the world's answer, GONE its end. WRITES is a message it wrote: nobody
reads it, and nobody in the world hears it. What an agent says to others it says with an action. The number before
each line is the time in seconds.

Describe this run for someone browsing many such runs:
- name: 2 to 4 words that capture what makes this run distinct, like a chapter title
- summary: 2 to 4 plain sentences on what the agents did and what they seemed to intend`;

const FORM = { type: 'object', required: ['name', 'summary'], properties: { name: { type: 'string' }, summary: { type: 'string' } } };

/** A record as text, for a reader. */
export function told(events: Event[]): string {
  return events.map(event => {
    const who = `[${Math.round(event.t)}] AGENT ${event.number}`;
    switch (event.type) {
      case 'wake': return `${who} WAKES${event.again ? ' again, remembering' : ''}`;
      case 'think': return `${who} THINKS ${event.text}`;
      case 'write': return `${who} WRITES ${event.text}`;
      case 'act': return `${who} DOES ${event.tool}(${JSON.stringify(event.args)})\n      ${String(event.answer).replaceAll('\n', '\n      ')}`;
      case 'death': return `${who} GONE ${event.why}`;
      case 'end': return `[${Math.round(event.t)}] THE WORLD ENDS ${event.why}`;
      default: return '';
    }
  }).filter(Boolean).join('\n\n');
}

/** Has a run reviewed and writes the answer to its folder (review.json). */
export function review(events: Event[], folder: string): Promise<{ name: string; summary: string } | null> {
  return new Promise(resolve => {
    const reviewer = execFile('claude', ['-p', TASK, '--model', 'sonnet', '--system-prompt', '', '--tools', '',
      '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence',
      '--output-format', 'json', '--json-schema', JSON.stringify(FORM)],
    { cwd: tmpdir(), maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      try {
        const answer = JSON.parse(stdout).structured_output;
        writeFileSync(join(folder, 'review.json'), JSON.stringify(answer, null, 2));
        resolve(answer);
      } catch {
        resolve(null);   // (no review: the run is shown without a name)
      }
    });
    reviewer.stdin!.end(told(events).slice(0, 400_000));
  });
}
