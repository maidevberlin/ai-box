// The block base: worlds made of blocks in a 3D grid. A world says which kinds of block,
// item and creature it has and what is special about them; the base does the rest.
//
// What the base does by itself, in every block world:
// - Falling: a block that nothing holds falls. A block is held by a block beneath it, by
//   the water if it `floats`, and by a `sticky` block beside it (a sticky block also holds
//   on to what is beside it). Whoever loses the ground under its feet drowns.
// - Water: a cell with no block is water. Who ends up in it drowns; what falls in is gone.
// - Hands: everything that is carried is an item. A block that is taken becomes an item,
//   and a block again when it is put down. So blocks, notes and fruit are carried, thrown
//   and caught the same way.
// - Sight: what an agent sees, and how far (one cell further for every level it stands higher).
// - Hearing: what is said is heard in full nearby, with words missing further away, as
//   "..." further still, then not at all. A speaker who stands higher is heard further.
//   An agent chooses how loud it speaks: a whisper stays close, a shout carries far.
// - Verbs: everything an agent can do is a verb. Some it does itself (walk, say, leave),
//   some it does to a thing (take, destroy, eat). A world says which verbs its agents have.
//   What a verb does to a thing is up to the kind of the thing (`can`): a kind says that it
//   can be done to it, or why not, or does it its own way. So eating a fruit is written
//   with the fruit. A thing is a block, an item, or somebody: a creature or another agent.
//   A verb that no kind of the world allows is not offered at all.
// - Pointing: for a verb that is done to a thing, the agent says to what: by where it is
//   ("(2, 1)", "here"), by "hand", or by a name it gave it.
// - The verbs in `basic` (verbs.ts).
//
// North makes y bigger, east makes x bigger. A block at level z fills the space from z to
// z + 1. The ground is blocks too, usually at level -1, so that things on it stand at 0.

import type { Agent, Args, Chosen, Given, Role, Settings } from '../engine/types.ts';

export type Cell = readonly [x: number, y: number];
export type Place = readonly [x: number, y: number, z: number];

export const DIRECTIONS = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] } as const;
export const WAYS = { ...DIRECTIONS, 'north-east': [1, 1], 'north-west': [-1, 1], 'south-east': [1, -1], 'south-west': [-1, -1] } as const;
/** How loud something is said, and how far that carries compared to a normal voice. */
export const LOUDNESS = { whisper: 0.4, normal: 1, shout: 2 } as const;
export type Loudness = keyof typeof LOUDNESS;
export type Direction = keyof typeof DIRECTIONS;
export type Way = keyof typeof WAYS;

// ---------------------------------------------------------------- what is in a block world

/** What happened, for a kind that reacts to it. */
export interface Happened {
  at: Place;
  /** Who did it, if somebody did. */
  by?: Body;
  /** How hard it was thrown (1 to 10), if it was thrown. */
  power?: number;
  /** Where the throw came from, if it was thrown. */
  from?: Cell;
  /** The item it happened to, for an item kind. */
  item?: Item;
}

/** A kind reacts by changing the world. If it returns a sentence, whoever did it is told. */
export type Reaction = (world: BlockWorld<any>, happened: Happened) => string | void;

/** What a kind does when a verb is done to a thing of it. What it returns, the agent reads. */
export type Deed<A extends Args = any> = (world: BlockWorld<any>, me: Body, thing: Thing, args: Given<A>) => string;

/** What can be done to the things of a kind, by the name of the verb.
 *  - `true`: it can, the way the verb usually goes: `can: { destroy: true }`.
 *  - a function: it can, and this is what happens: `can: { eat: (world, me, fruit) => ... }`.
 *  - a sentence: it cannot, and that is why: `can: { dig: 'The stone is too hard to dig.' }`.
 *  What a kind of block or item does not mention is up to the verb (anything loose can be
 *  taken). To somebody, a creature or an agent, nothing is done that their kind does not mention. */
export type Can = Record<string, boolean | string | Deed>;

export interface BlockKind {
  colour: string;
  /** What agents are told it is. Left out: its name and "block". */
  called?: string;
  /** It is the ground: it cannot be taken, and never falls. */
  ground?: true;
  /** It lies in the water's surface instead of sinking. */
  floats?: true;
  /** It sticks to blocks beside it. */
  sticky?: true;
  /** Nothing can stand on it (leaves). */
  soft?: true;
  can?: Can;
  on?: {
    /** A block of this kind appeared in the world, however it got there. The place to ask
     *  for something to happen later (`world.after`, `world.every`). */
    appears?: Reaction;
    /** It was put down, and has come to rest at this place. */
    put?: Reaction;
    /** It was taken from this place. */
    taken?: Reaction;
    /** Somebody landed on it with a jump. */
    jumpedOn?: Reaction;
    /** It was thrown, and has come to rest at this place. */
    landed?: Reaction;
  };
  /** Anything else a world wants to know about its kinds: `food: 4`. */
  [more: string]: unknown;
}

/** A kind of thing that is not a block: a note, a fruit. It lies on top of a cell, can be
 *  carried and thrown, and comes down with what it lies on. */
export interface ItemKind {
  colour: string;
  called: string;
  shape: 'sheet' | 'ball' | 'small block';
  can?: Can;
  on?: {
    /** It came to rest on this cell: dropped, put down or thrown. */
    landed?: Reaction;
    /** It went into the water and is gone. */
    sunk?: Reaction;
  };
  [more: string]: unknown;
}

/** One thing, lying somewhere or in a hand. */
export interface Item {
  /** The name of its kind: of an item kind, or of a block kind for a carried block. */
  kind: string;
  /** What is written on it, if it is a note. */
  text?: string;
}

/** Anything alive: an agent or a creature. It stands on top of its cell. */
export interface Body {
  id: number;
  /** For an agent, who it is. A creature has none. */
  agent?: Agent;
  /** For a creature, the name of its kind. */
  creature?: string;
  cell: Cell;
  hand: Item | null;
  dead: boolean;
  /** Whatever a world gives its bodies: energy, stamina, points. */
  has: Record<string, number>;
}

/** A kind of creature: alive, but not an AI. What it does every `every` seconds is its whole mind. */
export interface CreatureKind {
  colour: string;
  called: string;
  every: number;
  does(world: BlockWorld<any>, me: Body): void;
  can?: Can;
  [more: string]: unknown;
}

/** The agents of a world as a kind of thing: what other agents can do to them. */
export interface AgentKind {
  can?: Can;
  [more: string]: unknown;
}

// ---------------------------------------------------------------- what a world's code can use

export interface BlockWorld<S extends Settings = Settings> {
  /** The settings this run was started with. */
  readonly chosen: Chosen<S>;
  /** A place for whatever this world has to remember, for this run only. */
  readonly own: Record<string, any>;
  /** Where agents wake up. */
  home: Cell;

  // blocks
  block(at: Place): string | undefined;
  setBlock(at: Place, kind: string): void;
  removeBlock(at: Place): void;
  /** The blocks of a cell, lowest first. */
  column(cell: Cell): [z: number, kind: string][];
  /** The level something on this cell stands on (0 on untouched ground, and over water). */
  height(cell: Cell): number;
  /** The kind of the highest block of a cell; nothing over water. */
  top(cell: Cell): string | undefined;
  /** Can something stand or lie on this cell? Not on water, not on a soft block. */
  standable(cell: Cell): boolean;
  blockKind(name: string): BlockKind | undefined;
  itemKind(name: string): ItemKind | undefined;
  /** What agents are told a thing is: "note", "grey block". */
  called(item: Item | string): string;
  /** A block is let go at a place and falls from there until something holds it. Says
   *  where it came to rest, or nothing if it sank. */
  release(at: Place, kind: string): Place | null;
  /** Lets fall whatever nothing holds. The base does this after every action by itself. */
  settle(): void;
  /** Writes something at a place for whoever watches the run: a score, what a block stands
   *  for. Nobody in the world sees it. It stays until other words, or none, are written there.
   *  It is shown on what is at the place, or beside it if that is asked for. */
  sign(at: Place, text: string | null, where?: 'on' | 'east' | 'west'): void;

  // items
  items(cell: Cell): Item[];
  /** An item comes down on a cell. Over water it is gone. */
  drop(item: Item, cell: Cell): void;
  /** An item is gone from the world, wherever it is: lying somewhere, or in a hand. */
  removeItem(item: Item): void;

  // bodies
  bodies(): Body[];
  /** Who stands in a cell, if somebody does. Two never stand in the same cell. */
  bodyAt(cell: Cell): Body | undefined;
  spawn(creature: string, cell: Cell): Body;
  move(body: Body, cell: Cell): void;
  /** Calls one more agent of a role into the world: it wakes up near a cell, holding an item
   *  if one is given. Only if the role allows more than it started with (Role.most). If the world is full,
   *  the agent that has been alive longest is gone. Says whether it worked. */
  call(role: string, near: Cell, hand?: Item): boolean;
  /** A body dies. Says why, for the answer to whoever is told. An agent comes back, or is
   *  gone, as the run was set up. */
  die(body: Body, why: string): string;
  /** A body leaves the world for good: because it chose to, or because its part is over (it
   *  has made its one decision). What it held lies where it stood. Says why. */
  leave(body: Body, why: string): string;
  /** A body notices something it did not ask about. Creatures notice nothing. */
  notice(body: Body, text: string): void;
  /** Something is said out loud: everyone in earshot hears what reaches them. A whisper
   *  carries less than half as far as a normal voice, a shout twice as far. */
  say(from: Body, text: string, loudness?: Loudness): void;
  /** How far a body sees from where it stands. */
  sight(body: Body): number;
  /** A place as it is said to a body: "(3, 4)" where agents know the map, else by the steps
   *  from where the body stands, "(2 east, 1 north)". Whatever an agent is told about a place
   *  is said this way. */
  at(body: Body, cell: Cell): string;
  /** "You are at (3, 4), on the ground." (Where agents do not know the map: "You are on the ground.") */
  where(body: Body): string;

  // the land
  square(size: number, middle?: Cell): Cell[];
  disc(radius: number, middle?: Cell): Cell[];
  next(cell: Cell, way: string): Cell;

  // time and chance
  /** Seconds since the world started. */
  now(): number;
  /** Do something later. With a place: only if the block there is still the same one then. */
  after(seconds: number, what: () => void, at?: Place): void;
  /** Do something again and again. With a place: as long as the block there stays. */
  every(seconds: number, what: () => void, at?: Place): void;
  random(): number;
  /** A whole number from 0 up to, not including, `below`. */
  pick(below: number): number;
  record(what: string, data: unknown): void;
  over(why: string): void;
}

// ---------------------------------------------------------------- verbs

/** One thing a verb is done to. */
export interface Thing {
  /** What agents are told it is: "note", "grey block", "rabbit". For another agent: the name
   *  the agent gave it, or "someone". */
  called: string;
  kind: BlockKind | ItemKind | CreatureKind | AgentKind;
  /** It is an item: lying at `cell`, or in the agent's hand. */
  item?: Item;
  /** It is a block, at this place. */
  block?: Place;
  /** It is somebody: a creature, or another agent. */
  body?: Body;
  cell: Cell;
  inHand: boolean;
}

/** Something an agent can do. `about` is all the agent is told about it; what `does`
 *  answers is what the agent reads. The engine hands every verb to the agents as a tool.
 *
 *  There are two sorts. A verb the agent does itself, like walk or say, gets what the agent
 *  gave for its `args`. A verb that is done `to` a thing, like take or eat, is done to what
 *  the agent points at (its argument `what`). The base makes sure that the thing is in
 *  reach, on top, and of a kind the verb can be done to. What happens then is up to the
 *  kind of the thing; the verb itself only knows how it usually goes, if it usually goes
 *  one way at all. */
export type Verb<A extends Args = any> = {
  about: string;
  /** The world does not work without it: it cannot be switched off. */
  needed?: true;
} & ({
  to?: undefined;
  args: A;
  does(world: BlockWorld<any>, me: Body, args: Given<A>): string | Promise<string>;
} | {
  to: 'thing';
  /** What the agent says besides what it points at. */
  args?: A;
  /** Whether it can be done to a block or an item whose kind says nothing about it. Left
   *  out: no. (To somebody it is only done if their kind says so.) */
  usually?(kind: BlockKind | ItemKind): boolean;
  /** How it usually goes: for a kind that only says it can be done (`true`), or says
   *  nothing. Left out: every kind it can be done to says itself what happens. */
  does?: Deed<A>;
});

// ---------------------------------------------------------------- a block world

export interface BlockWorldDefinition<S extends Settings> {
  name: string;
  title: string;
  about: string;
  /** What a person can set. Everything else here that mentions the settings is typed from this. */
  settings: S;
  minutes: number;
  roles(chosen: Chosen<NoInfer<S>>): Record<string, Role>;
  blocks: Record<string, BlockKind>;
  /** A kind "note" is always there, for the verb `note`, unless a world brings its own. */
  items?: Record<string, ItemKind>;
  creatures?: Record<string, CreatureKind>;
  /** What agents can do to each other. Left out: nothing. */
  agent?: AgentKind;
  /** What agents can do here: the basic verbs the world wants (`basic`), and its own. */
  verbs: Record<string, Verb> | ((chosen: Chosen<NoInfer<S>>) => Record<string, Verb>);
  /** How far an agent sees from the ground. Usually 3. */
  sight?: number;
  /** How far a voice carries in full. Usually 5. */
  earshot?: number;
  /** How many levels the strongest jump reaches. Usually 2. */
  jump?: number;
  /** How many levels up a single step of walking can go. Usually 0: only level or down, and
   *  a block in the way has to be jumped onto. A world with hills sets 1. */
  climb?: number;
  /** Builds the world at the start. */
  make(world: BlockWorld<NoInfer<S>>): void;
  /** An agent wakes up: it stands where agents wake up, with an empty hand. */
  wake?(world: BlockWorld<NoInfer<S>>, me: Body): void;
  /** After every action of an agent that is still alive. A sentence is added to its answer. */
  afterAction?(world: BlockWorld<NoInfer<S>>, me: Body): string | void;
  /** More lines for an agent that looks around. */
  alsoSeen?(world: BlockWorld<NoInfer<S>>, me: Body): string[];
}

/** A verb an agent does itself, with typed arguments. */
export function verb<A extends Args>(made: Extract<Verb<A>, { to?: undefined }>): Verb {
  return made;
}

/** A verb that is done to a thing the agent points at. */
export function verbTo<A extends Args = {}>(made: Omit<Extract<Verb<A>, { to: 'thing' }>, 'to'>): Verb {
  return { ...made, to: 'thing' };
}

/** Marks a verb as one the world does not work without: it cannot be switched off. */
export function needed(made: Verb): Verb {
  return { ...made, needed: true };
}
