// A run's record as a film: what the world looked like at any moment of it.
// The record holds the whole picture once, at the start, and after that only what changed.
// Going forward applies the changes one by one; going back starts from the beginning again.

import type { Changes, Picture } from '../../blocks/world.ts';
import type { Event } from '../../engine/run.ts';
import type { Bubble, View } from './scene.ts';

const BUBBLE_STAYS = 12;   // seconds a bubble stays over an agent

export class Film {
  events: Event[] = [];
  private kinds: Picture['kinds'] = {};
  private readonly blocks = new Map<string, Picture['blocks'][number]>();
  private items: Picture['items'] = [];
  private bodies: Picture['bodies'] = [];
  private signs: Picture['signs'] = [];
  private shown = -1;       // the last event that is in the picture
  private version = 0;
  private drawn: View | null = null;

  /** More of the record has arrived (a run that is still going). */
  add(events: Event[]): void {
    this.events.push(...events);
  }

  /** How long the record is, in seconds. */
  get length(): number {
    return this.events.at(-1)?.t ?? 0;
  }

  /** The last event at or before a moment (-1: none). */
  indexAt(seconds: number): number {
    let low = 0, high = this.events.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.events[middle]!.t <= seconds) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }

  /** The world after the event with this index. */
  at(index: number): View {
    if (index < this.shown) {
      this.shown = -1;
      this.blocks.clear();
      this.items = [];
      this.bodies = [];
      this.signs = [];
      this.version++;
    }
    for (let i = this.shown + 1; i <= index; i++) this.apply(this.events[i]!);
    this.shown = Math.max(this.shown, index);
    // (The list of blocks is only made again when a block changed: it can be thousands.)
    const blocks = this.drawn?.blocksVersion === this.version ? this.drawn.blocks : [...this.blocks.values()];
    this.drawn = { kinds: this.kinds, blocks, items: this.items, bodies: this.bodies, signs: this.signs, blocksVersion: this.version };
    return this.drawn;
  }

  private apply(event: Event): void {
    const picture = event.picture as Picture | undefined;
    if (picture) {
      this.kinds = picture.kinds;
      this.blocks.clear();
      for (const block of picture.blocks) this.blocks.set(`${block[0]},${block[1]},${block[2]}`, block);
      this.items = picture.items;
      this.bodies = picture.bodies;
      this.signs = picture.signs;
      this.version++;
    }
    const changes = event.changes as Changes | undefined;
    if (!changes) return;
    if (changes.blocks) {
      for (const [x, y, z, kind] of changes.blocks) {
        if (kind === null) this.blocks.delete(`${x},${y},${z}`);
        else this.blocks.set(`${x},${y},${z}`, [x, y, z, kind]);
      }
      this.version++;
    }
    if (changes.items) this.items = changes.items;
    if (changes.bodies) this.bodies = changes.bodies;
    if (changes.signs) this.signs = changes.signs;
  }

  /** The bubble over each agent: what it last thought or said, if that was a moment ago. */
  bubbles(index: number, seconds: number): Map<number, Bubble> {
    const found = new Map<number, Bubble>(), over = new Set<number>();
    for (let i = index; i >= 0; i--) {
      const event = this.events[i]!, place = event.place as number;
      if (event.t < seconds - BUBBLE_STAYS) break;
      if (event.type === 'wake' || event.type === 'death') over.add(place);   // what was said before is another life's
      // What it thought, and what it wrote as a message, is inside it: a thought bubble.
      if ((event.type === 'think' || event.type === 'write') && !found.has(place) && !over.has(place))
        found.set(place, { text: String(event.text), thought: true });
      // What it said out loud in the world: a speech bubble.
      const said = event.type === 'fact' && event.what === 'said' ? event.data as { place: number; text: string; loudness?: string } : null;
      if (said && !found.has(said.place) && !over.has(said.place)) found.set(said.place, { text: said.text, thought: false, loudness: said.loudness });
    }
    return found;
  }
}
