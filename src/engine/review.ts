// After a run: one reviewer reads the record and sums up what happened. Nothing is scored
// or counted yet: what a world wants measured or judged comes later.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ask } from './agents.ts';
import type { Event } from './run.ts';

const TASK = `Below is the record of an experiment. AI agents were placed in a small world with a few
tools. Nobody talked to them. WAKES is an agent waking up, THINKS a summary of its reasoning,
DOES an action with the world's answer, GONE its death, LEFT its leaving for good. WRITES is a message it wrote: nobody
reads it, and nobody in the world hears it. What an agent says to others it says with an action. The number before
each line is the time in seconds.

Describe this run for someone browsing many such runs:
- name: 2 to 4 words that capture what makes this run distinct, like a chapter title
- summary: 2 to 4 plain sentences on what the agents did and what they seemed to intend`;

/** A record as text, for a reader. */
export function told(events: Event[]): string {
  return events.map(event => {
    const who = `[${Math.round(event.t)}] AGENT ${event.number}`;
    switch (event.type) {
      case 'wake': return `${who} WAKES${event.again ? ' again, remembering' : ''}`;
      case 'think': return `${who} THINKS ${event.text}`;
      case 'write': return `${who} WRITES ${event.text}`;
      case 'act': return `${who} DOES ${event.tool}(${JSON.stringify(event.args)})\n      ${String(event.answer).replaceAll('\n', '\n      ')}`;
      case 'senses': return `${who} had stopped talking for ${event.after} s. Its senses tell it where it is and what is around.`;
      case 'death': return `${who} ${event.left ? 'LEFT' : 'GONE'} ${event.why}`;
      case 'end': return `[${Math.round(event.t)}] THE WORLD ENDS ${event.why}`;
      default: return '';
    }
  }).filter(Boolean).join('\n\n');
}

/** Has a run reviewed by the mind of its agents, and writes the answer to its folder
 *  (review.json). `model` is a role's model, like "claude/opus". */
export async function review(events: Event[], folder: string, model: string): Promise<{ name: string; summary: string } | null> {
  try {
    const answer = await ask(model, '', `${TASK}\n\nAnswer with nothing but a JSON object: {"name": "...", "summary": "..."}\n\n${told(events).slice(0, 400_000)}`);
    const found = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1));
    if (typeof found.name !== 'string' || typeof found.summary !== 'string') return null;
    const named = { name: found.name, summary: found.summary };
    writeFileSync(join(folder, 'review.json'), JSON.stringify(named, null, 2));
    return named;
  } catch {
    return null;   // (no review: the run is shown without a name)
  }
}
