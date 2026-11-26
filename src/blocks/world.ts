// A block world while it runs: the grid, what lies and lives in it, and the rules every
// block world has (see types.ts). `blockWorld` turns a world's definition into something
// the engine can run.

import type { Agent, Chosen, Host, Settings, World, WorldDefinition } from '../engine/types.ts';
import { asTools, glimpse, pattern, seenNow, startles, surroundings } from './verbs.ts';
import { DIRECTIONS, LOUDNESS, WAYS, type Loudness, type BlockKind, type BlockWorld, type BlockWorldDefinition, type Body, type Cell,
         type Happened, type Item, type ItemKind, type Place, type Reaction } from './types.ts';

const NOTE: ItemKind = { colour: '#f2d34f', called: 'note', shape: 'sheet', can: { destroy: true } };
const DROWNED = 'The ground under you is gone. You are in the water. You drown.';

const at3 = (x: number, y: number, z: number) => `${x},${y},${z}`;
const at2 = (cell: Cell) => `${cell[0]},${cell[1]}`;
const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

/** What the viewer gets to draw a block world. */
export interface Picture {
  kinds: Record<string, { colour: string; shape: string; soft?: boolean; ground?: boolean }>;
  blocks: [x: number, y: number, z: number, kind: string][];
  items: [x: number, y: number, z: number, kind: string, text?: string][];
  /** `sees`: how far an agent sees from where it stands, in cells. */
  bodies: { id: number; place?: number; number?: number; creature?: string; x: number; y: number; z: number; hand: string | null; dead: boolean; sees?: number }[];
}
export interface Changes {
  blocks?: [x: number, y: number, z: number, kind: string | null][];
  items?: Picture['items'];
  bodies?: Picture['bodies'];
}

export class Blocks<S extends Settings = Settings> implements BlockWorld<S>, World {
  readonly own: Record<string, any> = {};
  home: Cell = [0, 0];
  readonly toolset: ReturnType<typeof asTools>;
  /** What each body saw the last time it looked around (see verbs.ts). */
  readonly sawLast = new Map<Body, unknown>();
  private readonly blockKinds: Record<string, BlockKind>;
  private readonly itemKinds: Record<string, ItemKind>;
  private readonly grid = new Map<string, string>();
  private readonly columns = new Map<string, Map<number, string>>();
  private lying: { item: Item; cell: Cell }[] = [];
  private living: Body[] = [];
  private creatures = 0;
  /** Whose action is being answered right now: it is told what happens in the answer. */
  private acting: Body | null = null;
  private readonly timers = new Map<string, Set<() => void>>();
  private readonly touched = new Map<string, [number, number, number, string | null]>();
  /** The names agents gave to things: for each agent (by its number) its own. Who names
   *  something does not tell the others by that. */
  private readonly names = new Map<number, Map<unknown, string>>();
  private sentItems = '[]';
  private sentBodies = '[]';

  readonly definition: BlockWorldDefinition<S>;
  readonly chosen: Chosen<S>;
  private readonly host: Host;

  constructor(definition: BlockWorldDefinition<S>, chosen: Chosen<S>, host: Host) {
    this.definition = definition;
    this.chosen = chosen;
    this.host = host;
    this.blockKinds = definition.blocks;
    this.itemKinds = { note: NOTE, ...definition.items };
    this.toolset = tools(definition, chosen);
    definition.make(this);
    this.settle();
  }

  // ---------------------------------------------------------------- blocks

  block(at: Place): string | undefined {
    return this.grid.get(at3(...at));
  }

  setBlock(at: Place, kind: string): void {
    const [x, y, z] = at;
    if (!this.blockKinds[kind]) throw new Error(`This world has no kind of block called "${kind}".`);
    this.callOff(at);
    this.grid.set(at3(x, y, z), kind);
    let column = this.columns.get(at2([x, y]));
    if (!column) this.columns.set(at2([x, y]), column = new Map());
    column.set(z, kind);
    this.touched.set(at3(x, y, z), [x, y, z, kind]);
    this.blockKinds[kind]!.on?.appears?.(this, { at });
  }

  removeBlock(at: Place): void {
    const [x, y, z] = at;
    if (!this.grid.delete(at3(x, y, z))) return;
    this.callOff(at);
    for (const mine of this.names.values()) mine.delete(`block ${at3(x, y, z)}`);   // (see carryName)
    const column = this.columns.get(at2([x, y]))!;
    column.delete(z);
    if (!column.size) this.columns.delete(at2([x, y]));
    this.touched.set(at3(x, y, z), [x, y, z, null]);
  }

  column(cell: Cell): [number, string][] {
    return [...(this.columns.get(at2(cell)) ?? [])].sort((a, b) => a[0] - b[0]);
  }

  height(cell: Cell): number {
    const column = this.columns.get(at2(cell));
    return column ? Math.max(...column.keys()) + 1 : 0;
  }

  top(cell: Cell): string | undefined {
    const column = this.columns.get(at2(cell));
    return column?.get(Math.max(...column.keys()));
  }

  standable(cell: Cell): boolean {
    const top = this.top(cell);
    return top !== undefined && !this.blockKinds[top]!.soft;
  }

  blockKind(name: string): BlockKind | undefined {
    return this.blockKinds[name];
  }

  itemKind(name: string): ItemKind | undefined {
    return this.itemKinds[name];
  }

  called(item: Item | string): string {
    const name = typeof item === 'string' ? item : item.kind;
    return this.itemKinds[name]?.called ?? this.blockKinds[name]?.called ?? `${name} block`;
  }

  /** Would a block of this kind be held at this place? */
  private holds(x: number, y: number, z: number, kind: string): boolean {
    const mine = this.blockKinds[kind]!;
    if (this.grid.has(at3(x, y, z - 1))) return true;
    if (z === -1 && mine.floats) return true;
    return Object.values(DIRECTIONS).some(([dx, dy]) => {
      const beside = this.grid.get(at3(x + dx, y + dy, z));
      return beside !== undefined && (mine.sticky || this.blockKinds[beside]!.sticky);
    });
  }

  release(at: Place, kind: string): Place | null {
    const [x, y] = at;
    for (let z = at[2]; z >= -1; z--) {
      if (this.holds(x, y, z, kind)) {
        this.setBlock([x, y, z], kind);
        return [x, y, z];
      }
    }
    return null;
  }

  /** Every block that something holds (the ground always is, and is left out). */
  private held(): Set<string> {
    const held = new Set<string>(), spreading: Place[] = [];
    const isGround = (kind: string | undefined) => kind !== undefined && this.blockKinds[kind]!.ground;
    const hold = (x: number, y: number, z: number) => {
      held.add(at3(x, y, z));
      spreading.push([x, y, z]);
    };
    for (const [key, kind] of this.grid) {
      if (isGround(kind)) continue;
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      const below = this.grid.get(at3(x, y, z - 1));
      const rooted = isGround(below) || (below === undefined && z === -1 && this.blockKinds[kind]!.floats)
        || (this.blockKinds[kind]!.sticky && Object.values(DIRECTIONS).some(([dx, dy]) => isGround(this.grid.get(at3(x + dx, y + dy, z)))));
      if (rooted) hold(x, y, z);
    }
    while (spreading.length) {
      const [x, y, z] = spreading.pop()!;
      const sticky = this.blockKinds[this.grid.get(at3(x, y, z))!]!.sticky;
      const reached: Place[] = [[x, y, z + 1]];
      for (const [dx, dy] of Object.values(DIRECTIONS)) {
        const beside = this.grid.get(at3(x + dx, y + dy, z));
        if (beside !== undefined && (sticky || this.blockKinds[beside]!.sticky)) reached.push([x + dx, y + dy, z]);
      }
      for (const [rx, ry, rz] of reached) {
        const kind = this.grid.get(at3(rx, ry, rz));
        if (kind !== undefined && !isGround(kind) && !held.has(at3(rx, ry, rz))) hold(rx, ry, rz);
      }
    }
    return held;
  }

  settle(): void {
    this.settleAll();
  }

  /** Lets fall what nothing holds, lowest first. Then what lay or stood on a cell that is
   *  water now is gone. Says who drowned by it. */
  private settleAll(): Body[] {
    for (let round = 0; round < 10_000; round++) {
      const held = this.held();
      let lowest: [number, number, number, string] | null = null;
      for (const [key, kind] of this.grid) {
        if (this.blockKinds[kind]!.ground || held.has(key)) continue;
        const [x, y, z] = key.split(',').map(Number) as [number, number, number];
        if (!lowest || z < lowest[2]) lowest = [x, y, z, kind];
      }
      if (!lowest) break;
      const [x, y, z, kind] = lowest;
      const carried = {};   // (its names fall with it)
      this.carryName([x, y, z], carried);
      this.removeBlock([x, y, z]);
      const rest = this.release([x, y, z - 1], kind);
      if (rest) this.carryName(carried, rest);
    }
    this.lying = this.lying.filter(({ cell }) => this.columns.has(at2(cell)));
    const drowned = this.living.filter(body => !body.dead && !this.standable(body.cell));
    for (const body of drowned) this.die(body, DROWNED);
    return drowned;
  }

  // ---------------------------------------------------------------- items

  items(cell: Cell): Item[] {
    return this.lying.filter(found => same(found.cell, cell)).map(found => found.item);
  }

  drop(item: Item, cell: Cell): void {
    if (!this.columns.has(at2(cell))) return;   // over water: it is gone
    this.lying.push({ item, cell });
    this.itemKinds[item.kind]?.on?.landed?.(this, { at: [cell[0], cell[1], this.height(cell)], item });
  }

  removeItem(item: Item): void {
    this.lying = this.lying.filter(found => found.item !== item);
    for (const body of this.living) if (body.hand === item) body.hand = null;
  }

  /** Where an item lies, if it lies somewhere. */
  whereLies(item: Item): Cell | undefined {
    return this.lying.find(found => found.item === item)?.cell;
  }

  // ---------------------------------------------------------------- bodies

  bodies(): Body[] {
    return this.living.filter(body => !body.dead);
  }

  bodyAt(cell: Cell): Body | undefined {
    return this.living.find(body => !body.dead && same(body.cell, cell));
  }

  spawn(creature: string, cell: Cell): Body {
    const kind = this.definition.creatures?.[creature];
    if (!kind) throw new Error(`This world has no creature called "${creature}".`);
    const body: Body = { id: 1000 + ++this.creatures, creature, cell: this.freeNear(cell), hand: null, dead: false, has: {} };
    this.living.push(body);
    const live = () => this.later(kind.every, () => {
      if (body.dead) return;
      kind.does(this, body);
      live();
    });
    live();
    return body;
  }

  move(body: Body, cell: Cell): void {
    body.cell = cell;
  }

  call(role: string, near: Cell, hand?: Item): boolean {
    return this.host.call(role, { near, hand });
  }

  die(body: Body, why: string): string {
    if (body.dead) return why;
    body.dead = true;
    body.hand = null;   // goes down with it
    if (body.agent) {
      if (this.acting !== body) this.notice(body, why);
      this.host.died(body.agent.place, why);
    } else {
      this.living = this.living.filter(other => other !== body);
    }
    return why;
  }

  leave(body: Body, why: string): string {
    if (body.dead) return why;
    if (body.agent) {
      this.host.left(body.agent.place, why);   // (its body goes when the engine says who follows: see `wake`, `remove`)
    } else {
      this.living = this.living.filter(other => other !== body);
    }
    return why;
  }

  notice(body: Body, text: string): void {
    if (body.agent) this.host.notice(body.agent.place, text);
  }

  say(from: Body, text: string, loudness: Loudness = 'normal'): void {
    const near = (this.definition.earshot ?? 5) * LOUDNESS[loudness], heard: { place: number; text: string }[] = [];
    const says = { whisper: 'whispers', normal: 'says', shout: 'shouts' }[loudness];
    for (const body of this.bodies()) {
      if (body === from || !body.agent) continue;
      // A voice from higher up carries further: every level counts as a cell less.
      const far = Math.hypot(body.cell[0] - from.cell[0], body.cell[1] - from.cell[1])
        - Math.max(0, this.height(from.cell) - this.height(body.cell));
      // (A whisper that cannot be made out is not noticed at all.)
      if (far > near * (loudness === 'whisper' ? 2 : 3)) continue;
      let reached = text;
      if (far > near) {   // the further away, the more words are lost
        const lost = (far - near) / near;
        reached = text.split(/\s+/).map(word => (this.random() < lost ? '…' : word)).join(' ').replace(/…( …)+/g, '…');
      }
      const where = `(${from.cell[0]}, ${from.cell[1]})`, who = this.nameFor(body, from) ?? 'Someone';
      this.notice(body, reached === '…' || far > near * 2 ? `${who} in the distance ${says} something. You cannot make it out.`
        : `${who} at ${where} ${says}: "${reached}"`);
      heard.push({ place: body.agent.place, text: far > near * 2 ? '…' : reached });
    }
    this.record('said', { place: from.agent?.place, text, loudness, heard });
  }

  sight(body: Body): number {
    return (this.definition.sight ?? 3) + Math.max(0, this.height(body.cell));
  }

  where(body: Body): string {
    const high = this.height(body.cell), top = this.top(body.cell);
    const loose = this.column(body.cell).filter(([, kind]) => !this.blockKinds[kind]!.ground);
    const onGround = top !== undefined && this.blockKinds[top]!.ground;
    let footing = high < 0 ? `in a hole ${-high} deep` : high > 0 && onGround ? `on the ground, ${high} high`
      : high > 0 ? `standing ${high} high on a ${this.called(top!)}`
      : top && !this.blockKinds[top]!.ground ? `on a ${this.called(top)} ${this.blockKinds[top]!.floats ? 'floating in' : 'over'} the water`
      : 'on the ground';
    // A stack of more than one block: what it is made of can matter (a floating block at the bottom).
    if (high > 0 && loose.length > 1) footing += ` (blocks under you, by level: ${pattern(this, body.cell)})`;
    const place = this.nameFor(body, body.cell);
    return `You are at (${body.cell[0]}, ${body.cell[1]}), ${footing}.${place ? ` This is the place you call "${place}".` : ''}`;
  }

  // ---------------------------------------------------------------- names

  /** What a thing is filed under: an agent by its number (a new agent in the same place is
   *  somebody else), a block by where it is, a place by its cell, anything else by itself. */
  private filedAs(thing: Body | Item | Place | Cell | object): unknown {
    if (Array.isArray(thing)) return thing.length === 3 ? `block ${thing.join(',')}` : `place ${thing.join(',')}`;
    const body = thing as Body;
    return body.agent ? `agent ${body.agent.number}` : thing;
  }

  /** An agent gives a thing a name of its own: someone, an item, a block, or a place. */
  callIt(namer: Body, thing: Body | Item | Place | Cell, name: string): void {
    if (!namer.agent) return;
    if (!this.names.has(namer.agent.number)) this.names.set(namer.agent.number, new Map());
    this.names.get(namer.agent.number)!.set(this.filedAs(thing), name);
  }

  /** The name an agent gave a thing, if it gave it one. */
  nameFor(namer: Body, thing: Body | Item | Place | Cell): string | undefined {
    return namer.agent ? this.names.get(namer.agent.number)?.get(this.filedAs(thing)) : undefined;
  }

  /** What an agent gave this name, if it gave it to something that is still there: somebody,
   *  an item, a block (by its place) or a place (by its cell). */
  named(namer: Body, name: string): { body: Body } | { item: Item } | { block: Place } | { place: Cell } | undefined {
    const wanted = name.trim().toLowerCase();
    for (const [filed, given] of (namer.agent && this.names.get(namer.agent.number)) || []) {
      if (given.toLowerCase() !== wanted) continue;
      if (typeof filed === 'string') {
        const [what, where] = filed.split(' ') as [string, string], numbers = where.split(',').map(Number);
        if (what === 'agent') {
          const body = this.living.find(found => found.agent?.number === numbers[0] && !found.dead);
          if (body) return { body };
        } else if (what === 'block') {
          if (this.block(numbers as unknown as Place)) return { block: numbers as unknown as Place };
        } else return { place: numbers as unknown as Cell };
      } else if ((filed as Body).creature !== undefined) {
        if (this.living.includes(filed as Body)) return { body: filed as Body };
      } else return { item: filed as Item };
    }
    return undefined;
  }

  /** A thing becomes another thing and keeps its names: a block that is taken becomes an
   *  item in a hand, and a block somewhere else when it is put down or has fallen. */
  carryName(from: Item | Place | object, to: Item | Place | object): void {
    for (const mine of this.names.values()) {
      const name = mine.get(this.filedAs(from));
      if (name === undefined) continue;
      mine.delete(this.filedAs(from));
      mine.set(this.filedAs(to), name);
    }
  }

  /** The cell itself if it is free to stand on, else the nearest one that is. */
  private freeNear(cell: Cell): Cell {
    for (let far = 0; far < 50; far++) {
      const ring: Cell[] = [];
      for (let dx = -far; dx <= far; dx++)
        for (let dy = -far; dy <= far; dy++)
          if (Math.max(Math.abs(dx), Math.abs(dy)) === far) ring.push([cell[0] + dx, cell[1] + dy]);
      const free = ring.filter(found => this.standable(found) && !this.bodyAt(found))
        .sort((a, b) => Math.abs(a[0] - cell[0]) + Math.abs(a[1] - cell[1]) - Math.abs(b[0] - cell[0]) - Math.abs(b[1] - cell[1]));
      if (free[0]) return free[0];
    }
    return cell;
  }

  /** What a body holds comes down where it stands. */
  private letGo(body: Body): void {
    if (!body.hand) return;
    if (this.blockKinds[body.hand.kind]) {
      const rest = this.release([body.cell[0], body.cell[1], this.height(body.cell)], body.hand.kind);
      if (rest) this.carryName(body.hand, rest);
    } else this.drop(body.hand, body.cell);
    body.hand = null;
  }

  // ---------------------------------------------------------------- the land

  square(size: number, middle: Cell = [0, 0]): Cell[] {
    const cells: Cell[] = [], from = -Math.floor(size / 2);
    for (let dx = from; dx < from + size; dx++)
      for (let dy = from; dy < from + size; dy++) cells.push([middle[0] + dx, middle[1] + dy]);
    return cells;
  }

  disc(radius: number, middle: Cell = [0, 0]): Cell[] {
    return this.square(radius * 2 + 1, middle).filter(([x, y]) => (x - middle[0]) ** 2 + (y - middle[1]) ** 2 <= radius * radius + radius);
  }

  next(cell: Cell, way: string): Cell {
    const [dx, dy] = (WAYS as Record<string, readonly [number, number]>)[way] ?? [0, 0];
    return [cell[0] + dx, cell[1] + dy];
  }

  // ---------------------------------------------------------------- time and chance

  now(): number {
    return this.host.now();
  }

  /** Later, and then the world settles: what the change left without a hold falls. */
  private later(seconds: number, what: () => void): () => void {
    return this.host.after(seconds, () => {
      what();
      this.settleAll();
      this.lookOut(null);
    });
  }

  after(seconds: number, what: () => void, at?: Place): void {
    if (!at) return void this.later(seconds, what);
    const key = at3(...at);
    const cancel = this.later(seconds, () => {
      this.timers.get(key)?.delete(cancel);
      what();
    });
    if (!this.timers.has(key)) this.timers.set(key, new Set());
    this.timers.get(key)!.add(cancel);
  }

  every(seconds: number, what: () => void, at?: Place): void {
    this.after(seconds, () => {
      this.every(seconds, what, at);   // (asked for first: `what` may take the block away, and that calls it off)
      what();
    }, at);
  }

  /** The block at a place is another one now: what was asked for there does not happen. */
  private callOff(at: Place): void {
    const key = at3(...at);
    for (const cancel of this.timers.get(key) ?? []) cancel();
    this.timers.delete(key);
  }

  random(): number {
    return this.host.random();
  }

  pick(below: number): number {
    return Math.floor(this.host.random() * below);
  }

  record(what: string, data: unknown): void {
    this.host.record(what, data);
  }

  over(why: string): void {
    this.host.over(why);
  }

  /** A kind's reaction to something, as a sentence to add to an answer ("" if it says nothing). */
  react(reaction: Reaction | undefined, happened: Happened): string {
    const said = reaction?.(this, happened);
    return said ? ` ${said}` : '';
  }

  // ---------------------------------------------------------------- what the engine asks

  wake(agent: Agent): void {
    let body = this.living.find(found => found.agent?.place === agent.place);
    if (!body) {
      body = { id: agent.place, agent, cell: this.home, hand: null, dead: true, has: {} };
      this.living.push(body);
    } else if (!body.dead) {
      this.letGo(body);   // it simply stopped: what it held lies where it stood
    }
    body.agent = agent;
    body.hand = null;
    body.dead = true;   // gone for a moment, so that it is not in its own way
    // (One that was called in wakes up next to whoever called it, with what it was sent.)
    const called = agent.called as { near?: Cell; hand?: Item } | undefined;
    body.cell = this.freeNear(called?.near ?? this.home);
    body.hand = called?.hand ?? null;
    body.dead = false;
    if (!agent.again) body.has = {};
    this.sawLast.delete(body);
    this.definition.wake?.(this, body);
    if (agent.again) this.notice(body, `You wake up again. ${this.where(body)}`);
    this.settleAll();
    this.lookOut(body);
  }

  remove(place: number): void {
    const body = this.living.find(found => found.agent?.place === place);
    if (!body) return;
    if (!body.dead) this.letGo(body);
    this.living = this.living.filter(other => other !== body);
    this.settleAll();
    this.lookOut(null);
  }

  senses(agent: Agent): string {
    const body = this.living.find(found => found.agent?.place === agent.place);
    return body && !body.dead ? surroundings(this, body) : '';
  }

  tools(): ReturnType<typeof asTools> {
    return this.toolset;
  }

  act(agent: Agent, name: string, args: Record<string, unknown>): string | Promise<string> {
    const body = this.living.find(found => found.agent?.place === agent.place);
    if (!body || body.dead) return 'You are dead.';
    this.acting = body;
    try {
      // What others changed in its sight since it last looked: told with this answer, before
      // its own action changes things too.
      // (Not if the action itself tells what is in sight, like looking around or walking.)
      const saw = this.sawLast.get(body);
      const before = saw ? glimpse(this, body, false) : [];
      const told = (answer: string) => [this.afterAction(body, answer), ...(this.sawLast.get(body) === saw ? before : [])].join('\n');
      const answer = this.toolset[name]!.run(this, body, args);
      if (typeof answer === 'string') return this.seen(body, told(answer));
      this.acting = null;   // it answers later: until then others act
      return answer.then(later => this.seen(body, told(later)));
    } finally {
      this.acting = null;
    }
  }

  /** The world has changed: whoever has something new in sight notices it. (Only who has
   *  looked around at all: an agent that never looked has seen nothing to compare with.)
   *  What exactly is new is worked out when the agent is told, so it is told how things are
   *  then, and once, however often something moved meanwhile. */
  private lookOut(but: Body | null): void {
    for (const body of this.living) {
      if (body === but || body.dead || !body.agent || !this.sawLast.has(body)) continue;
      if (glimpse(this, body, false).length)
        this.host.notice(body.agent.place, () => glimpse(this, body, true).join('\n'), { about: 'sight', quiet: !startles(this, body) });
    }
  }

  /** After its action an agent has seen how things are: what it changed itself is no news to it. */
  private seen(body: Body, answer: string): string {
    if (!body.dead && this.sawLast.has(body)) seenNow(this, body);
    return answer;
  }

  private afterAction(body: Body, answer: string): string {
    this.acting = body;
    try {
      const alive = !body.dead;
      if (this.settleAll().includes(body)) answer += ` ${DROWNED}`;
      if (alive && !body.dead) {
        const more = this.definition.afterAction?.(this, body);
        if (more) answer += ` ${more}`;
        if (this.settleAll().includes(body)) answer += ` ${DROWNED}`;
      }
      this.lookOut(body);
      return answer;
    } finally {
      this.acting = null;
    }
  }

  // ---------------------------------------------------------------- the picture

  private itemsNow(): Picture['items'] {
    const piled = new Map<string, number>();
    return this.lying.map(({ item, cell }) => {
      const n = piled.get(at2(cell)) ?? 0;
      piled.set(at2(cell), n + 1);
      return [cell[0], cell[1], this.height(cell) + n * 0.08, item.kind, ...(item.text === undefined ? [] : [item.text])] as Picture['items'][number];
    });
  }

  private bodiesNow(): Picture['bodies'] {
    return this.living.map(body => ({
      id: body.id, place: body.agent?.place, number: body.agent?.number, creature: body.creature,
      x: body.cell[0], y: body.cell[1], z: this.height(body.cell), hand: body.hand?.kind ?? null, dead: body.dead,
      sees: body.agent ? this.sight(body) : undefined,
    }));
  }

  picture(): Picture {
    const kinds: Picture['kinds'] = {};
    for (const [name, kind] of Object.entries(this.blockKinds)) kinds[name] = { colour: kind.colour, shape: 'block', soft: kind.soft, ground: kind.ground };
    for (const [name, kind] of Object.entries(this.itemKinds)) kinds[name] = { colour: kind.colour, shape: kind.shape };
    for (const [name, kind] of Object.entries(this.definition.creatures ?? {})) kinds[name] = { colour: kind.colour, shape: 'creature' };
    return {
      kinds,
      blocks: [...this.grid].map(([key, kind]) => [...key.split(',').map(Number), kind] as Picture['blocks'][number]),
      items: this.itemsNow(),
      bodies: this.bodiesNow(),
    };
  }

  changes(): Changes | null {
    const changes: Changes = {};
    if (this.touched.size) {
      // (A block that was changed and changed back is not a change.)
      changes.blocks = [...this.touched.values()];
      this.touched.clear();
    }
    const items = this.itemsNow(), bodies = this.bodiesNow();
    if (JSON.stringify(items) !== this.sentItems) this.sentItems = JSON.stringify(changes.items = items);
    if (JSON.stringify(bodies) !== this.sentBodies) this.sentBodies = JSON.stringify(changes.bodies = bodies);
    return Object.keys(changes).length ? changes : null;
  }
}

/** What the agents of a world can do, as tools: its verbs, without those that are done to
 *  a thing and that no kind of the world allows. */
function tools<S extends Settings>(definition: BlockWorldDefinition<S>, chosen: Chosen<S>): ReturnType<typeof asTools> {
  const verbs = typeof definition.verbs === 'function' ? definition.verbs(chosen) : definition.verbs;
  return asTools(verbs, { ...definition.blocks, note: NOTE, ...definition.items });
}

/** A world built on the block base, ready for the engine. */
export function blockWorld<S extends Settings>(definition: BlockWorldDefinition<S>): WorldDefinition<S> {
  return {
    name: definition.name,
    title: definition.title,
    about: definition.about,
    settings: definition.settings,
    drawnBy: 'blocks',
    minutes: definition.minutes,
    roles: definition.roles,
    tools: chosen => tools(definition, chosen),
    create: (chosen, host) => new Blocks(definition, chosen, host),
  };
}
