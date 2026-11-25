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
// - The tools in `basic` (tools.ts).
//
// North makes y bigger, east makes x bigger. A block at level z fills the space from z to
// z + 1. The ground is blocks too, usually at level -1, so that things on it stand at 0.

import type { Agent, Args, Chosen, Role, Settings, Tool } from '../engine/types.ts';

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

  // items
  items(cell: Cell): Item[];
  /** An item comes down on a cell. Over water it is gone. */
  drop(item: Item, cell: Cell): void;
  removeItem(item: Item): void;

  // bodies
  bodies(): Body[];
  /** Who stands in a cell, if somebody does. Two never stand in the same cell. */
  bodyAt(cell: Cell): Body | undefined;
  spawn(creature: string, cell: Cell): Body;
  move(body: Body, cell: Cell): void;
  /** Calls one more agent of a role into the world: it wakes up near a cell, holding an item
   *  if one is given. Only if the role has room for more (Role.room). If the world is full,
   *  the agent that has been alive longest is gone. Says whether it worked. */
  call(role: string, near: Cell, hand?: Item): boolean;
  /** A body dies. Says why, for the answer to whoever is told. */
  die(body: Body, why: string): string;
  /** A body notices something it did not ask about. Creatures notice nothing. */
  notice(body: Body, text: string): void;
  /** Something is said out loud: everyone in earshot hears what reaches them. A whisper
   *  carries less than half as far as a normal voice, a shout twice as far. */
  say(from: Body, text: string, loudness?: Loudness): void;
  /** How far a body sees from where it stands. */
  sight(body: Body): number;
  /** "You are at (3, 4), on the ground." */
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

// ---------------------------------------------------------------- a block world

export type BlockTool = Tool<BlockWorld<any>, Body, any>;

export interface BlockWorldDefinition<S extends Settings> {
  name: string;
  title: string;
  about: string;
  /** What a person can set. Everything else here that mentions the settings is typed from this. */
  settings: S;
  minutes: number;
  roles(chosen: Chosen<NoInfer<S>>): Record<string, Role>;
  blocks: Record<string, BlockKind>;
  /** A kind "note" is always there, for the tool `note`, unless a world brings its own. */
  items?: Record<string, ItemKind>;
  creatures?: Record<string, CreatureKind>;
  /** What agents can do here: the basic tools the world wants, and its own. */
  tools: Record<string, BlockTool> | ((chosen: Chosen<NoInfer<S>>) => Record<string, BlockTool>);
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

/** A note that calls a friend: when it begins with "friend" and is thrown or put into the
 *  water, one more agent of the role wakes up next to whoever sent it, with that note in
 *  its hand. Use it as a world's kind of note: `items: { note: callingNote('agent') }`. */
export function callingNote(role: string): ItemKind {
  return {
    colour: '#f2d34f', called: 'note', shape: 'sheet',
    on: {
      sunk(world, { item, by }) {
        if (by && item?.text?.trim().toLowerCase().startsWith('friend')) world.call(role, by.cell, { kind: 'note', text: item.text });
      },
    },
  };
}

/** Makes a tool with typed arguments. */
export function tool<A extends Args>(made: Tool<BlockWorld<any>, Body, A>): BlockTool {
  return made;
}

/** Marks a tool as one the world does not work without: it cannot be switched off. */
export function needed(made: BlockTool): BlockTool {
  return { ...made, needed: true };
}
