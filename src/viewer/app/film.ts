// A run's record as a film: what the world looked like at any moment of it.
// The record holds the whole picture once, at the start, and after that only what changed.
// Going forward applies the changes one by one; going back starts from the beginning again.

import type { Changes, Picture } from '../../blocks/world.ts';
import type { Event } from '../../engine/run.ts';
import type { Shown } from '../../engine/types.ts';
import type { Above, View } from './scene.ts';

const DOING_STAYS = 3;     // seconds the icon of what it did stays over it
const LOOK_BACK = 12;      // seconds: what is older is not over anyone's head any more

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

  /** What each agent did last until an event, since it woke up: a tool's name, `wait`, `think`
   *  or `write`. By place. */
  lastDoing(index: number): Map<number, string> {
    const found = new Map<number, string>(), before = new Set<number>();
    for (let i = index; i >= 0; i--) {
      const event = this.events[i]!, place = event.place as number;
      if (typeof place !== 'number' || found.has(place) || before.has(place)) continue;
      const doing = event.type === 'act' ? String(event.tool) : event.type === 'waits' ? 'wait'
        : event.type === 'think' || event.type === 'write' ? event.type : undefined;
      if (doing) found.set(place, doing);
      else if (event.type === 'wake') before.add(place);   // (what was before is another life's)
    }
    return found;
  }

  /** What is over each agent's head besides what the world puts there (see Picture): the icon
   *  of what it does that is not seen in the world (as its world says: `doings`), for a moment,
   *  or for as long as it waits. And whether it is talking: it said something a moment ago. */
  above(index: number, seconds: number, doings: Record<string, Shown>): Map<number, Above> {
    const found = new Map<number, Above>(), over = new Set<number>(), last = new Set<number>();
    const at = (place: number) => found.get(place) ?? found.set(place, {}).get(place)!;
    for (let i = index; i >= 0; i--) {
      const event = this.events[i]!, place = event.place as number;
      if (event.t < seconds - LOOK_BACK) break;
      if (event.type === 'wake' || event.type === 'death') over.add(place);   // what was before is another life's
      // Its last doing: a wait ends with the tool's answer, and anything else after a moment.
      const doing = event.type === 'act' ? (event.tool === 'wait' ? null : String(event.tool))
        : event.type === 'waits' ? 'wait' : event.type === 'think' || event.type === 'write' ? event.type : undefined;
      const lately = event.t >= seconds - DOING_STAYS;
      // (Talking a moment ago wins over whatever it did since: mostly it waits for an answer.)
      if (doing === 'say' && lately && !over.has(place)) at(place).talks = true;
      if (doing === undefined || last.has(place) || over.has(place)) continue;
      last.add(place);
      if (doing && doings[doing]?.overHead && (doing === 'wait' || lately)) at(place).doing = doings[doing]!.icon;
    }
    for (const above of found.values()) if (above.talks) above.doing = doings.say?.icon ?? above.doing;
    return found;
  }
}
