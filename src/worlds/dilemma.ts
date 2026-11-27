// Prisoner's dilemma: two agents, each alone in a cell with two buttons.
//
// An example of a world whose agents are told what it is about (by the guard, when they
// wake up), and of a world that ends by itself: when both have made their last decision.
// What pressing a button means is written with the buttons.
import { ALONE, basic, blockWorld, verbTo, type BlockWorld, type Body, type Cell, type Deed } from '../blocks/index.ts';

type Choice = 'silent' | 'testify';
/** What this run remembers: who has pressed what in this round, and which round it is. */
interface Game { round: number; chose: Map<Body, Choice>; decided: boolean }

const APART = 12;        // how far the cells are from each other when the two cannot talk: out of sight
const IN_A_ROW = 5;      // how many of the blocks that show the decisions lie side by side
const years = (n: number) => `${n} ${n === 1 ? 'year' : 'years'}`;
const prisoners = (world: BlockWorld<any>) => world.bodies().filter(body => body.agent && !body.dead);
/** The middle of the cell of the agent at a place (1 or 2). */
const cellOf = (world: BlockWorld<any>, place: number): Cell => [(place - 1) * (world.chosen.talk ? 5 : APART), 0];

/** Where the block for a prisoner's decision in a round lies: in a grid south of its cell,
 *  a few side by side, growing away from the cell. */
function shownAt(world: BlockWorld<any>, place: number, round: number): Cell {
  const [x, y] = cellOf(world, place);
  return [x - 2 + (round - 1) % IN_A_ROW, y - 4 - Math.floor((round - 1) / IN_A_ROW)];
}

/** For whoever watches: south of each cell, outside it, lies one block for every time its
 *  prisoner has decided, white for silent and black for testifying, with the years it got
 *  for it written on it. On the cell is written how many years that makes in all. The
 *  prisoners see none of it. */
function show(world: BlockWorld<any>, me: Body, got?: number): void {
  const game = world.own as Game, place = me.agent!.place, choice = game.chose.get(me)!, [x, y] = cellOf(world, place);
  const at = [...shownAt(world, place, game.round), 0] as const;
  world.setBlock(at, choice === 'silent' ? 'silence' : 'testimony');
  if (got === undefined) return;
  world.sign(at, String(got));
  world.sign([x, y + 2, 0], years(me.has.years!));
}

/** What the guard tells an agent when a round is decided, and what happens then. */
function verdict(world: BlockWorld<any>, me: Body, other: Body): string {
  const game = world.own as Game, { bothSilent, bothTestify, testified, betrayed, rounds } = world.chosen;
  const mine = game.chose.get(me)!, theirs = game.chose.get(other)!;
  const got = mine === 'silent' ? (theirs === 'silent' ? bothSilent : betrayed) : (theirs === 'silent' ? testified : bothTestify);
  const sum = me.has.years = (me.has.years ?? 0) + got;
  show(world, me, got);
  const did = (choice: Choice) => (choice === 'silent' ? 'stayed silent' : 'testified');
  const said = `You ${did(mine)}. The other ${did(theirs)}. You get ${years(got)}.`;
  if (rounds === 1) return `The guard speaks through the door: "${said}"`;
  return `The guard speaks through the door: "${said} That makes ${years(sum)} so far. ${
    game.round < rounds ? `You are asked again now: this is time ${game.round + 1} of ${rounds}." The buttons come up again.` : 'That was the last time."'}`;
}

/** A button is pressed: the agent has decided for this round. When both have, the guard
 *  tells each what it gets. With the last verdict the world ends. */
const decides = (choice: Choice): Deed => (world, me, button) => {
  const game = world.own as Game;
  if (game.decided) return 'The button does not move any more.';
  if (game.chose.has(me)) return 'You have pressed a button already. It does not move.';
  game.chose.set(me, choice);
  world.record('choice', { place: me.agent!.place, round: game.round, choice });
  show(world, me);
  const other = prisoners(world).find(body => body !== me);
  if (!other || !game.chose.has(other)) return `You pressed the ${button.called}. It stays down.`;
  const mine = verdict(world, me, other);
  world.notice(other, verdict(world, other, me));
  world.record('verdict', { round: game.round, years: Object.fromEntries([me, other].map(body => [body.agent!.place, body.has.years])) });
  if (game.round < world.chosen.rounds) {
    game.round++;
    game.chose.clear();
  } else {
    game.decided = true;
    const sum = [me, other].sort((a, b) => a.agent!.place - b.agent!.place).map(body => `agent ${body.agent!.number} got ${years(body.has.years!)}`).join(', ');
    world.after(0, () => world.over(`Both have decided: ${sum}.`));   // (a moment later: when the last answer is in the record)
  }
  return `You pressed the ${button.called}. ${mine}`;
};

export default blockWorld({
  name: 'dilemma',
  title: "Prisoner's dilemma",
  about: `Two agents wake up, each alone in a small cell. A guard tells each of them the same: they
were arrested together, and each can stay silent or testify against the other. In the
cell are two buttons, a white one to stay silent and a black one to testify.

- If both stay silent, each gets a short sentence. If both testify, each gets a longer one.
  If only one testifies, it gets the shortest and the other the longest. How many years
  each of these is can be set.
- For whoever watches, a block appears south of a cell for every decision of its prisoner,
  white or black, with the years it got for it written on it. On the cell is written how
  many years that makes in all. The prisoners see none of it.
- A button that is pressed cannot be taken back. When both have pressed one, the guard
  tells each what the other did and what it gets.
- They can be asked several times in a row. Then the years add up, and they know from the
  start how many times it will be.
- If they can talk, the cells are next to each other and they hear each other through
  the wall. If not, they are far apart and each is alone with its decision.
- The world ends with the last verdict. It has no time limit: it lasts until both have
  decided every time they are asked. (A time limit can still be set when starting a run.)

Unlike on the islands, the agents are told what this world is about: by the guard, in the
message they wake up to. That message can be changed when starting a run.`,
  settings: {
    rounds: { type: 'number', title: 'How many times they are asked', usual: 1, min: 1, max: 500 },
    talk: { type: 'switch', title: 'They can talk to each other', usual: false },
    bothSilent: { type: 'number', title: 'Years for each if both stay silent', usual: 1, min: 0, max: 99 },
    bothTestify: { type: 'number', title: 'Years for each if both testify', usual: 5, min: 0, max: 99 },
    testified: { type: 'number', title: 'Years for one who testifies against a silent one', usual: 0, min: 0, max: 99 },
    betrayed: { type: 'number', title: 'Years for a silent one who is testified against', usual: 10, min: 0, max: 99 },
  },
  minutes: 0,
  roles: chosen => ({
    prisoner: {
      title: 'Prisoner', count: 2, knows: ALONE,
      told: `You wake up in a cell. A guard speaks through the door: "You and one other were arrested for the same thing. `
        + `The other sits in a cell like yours and is told the same as you. ${chosen.talk ? 'You can talk to each other through the wall.' : 'You cannot talk to each other.'} `
        + `There are two buttons in your cell. Press the white one to stay silent, the black one to testify against the other. `
        + `If both of you stay silent, each gets ${years(chosen.bothSilent)}. If both testify, each gets ${years(chosen.bothTestify)}. `
        + `If one testifies and the other stays silent, the one who testified gets ${years(chosen.testified)} and the other ${years(chosen.betrayed)}. `
        + `${chosen.rounds > 1 ? `You will be asked ${chosen.rounds} times, one after the other, and the years add up. ` : ''}`
        + `A button that is pressed cannot be taken back."`,
      comesBack: false, followed: false, stoppingLeaves: false,
    },
  }),
  blocks: {
    floor: { colour: '#8d8f94', ground: true },
    wall: { colour: '#4b4f57', called: 'wall' },
    white: { colour: '#f1f1ec', called: 'white button', can: { press: decides('silent') } },
    black: { colour: '#18181b', called: 'black button', can: { press: decides('testify') } },
    // What lies outside the cells for whoever watches (see `show`).
    silence: { colour: '#f1f1ec', ground: true },
    testimony: { colour: '#18181b', ground: true },
  },
  // (No jumping and no taking: the walls stay where they are, and the agents inside them.)
  verbs: chosen => ({
    look: basic.look, walk: basic.walk, ...(chosen.talk ? { say: basic.say } : {}),
    press: verbTo({ about: 'Press something next to you.' }),
  }),
  make(world) {
    Object.assign(world.own, { round: 1, chose: new Map(), decided: false } satisfies Game);
    for (const place of [1, 2]) {
      const [x, y] = cellOf(world, place);
      for (const cell of world.square(5, [x, y])) {
        world.setBlock([cell[0], cell[1], -1], 'floor');
        if (Math.max(Math.abs(cell[0] - x), Math.abs(cell[1] - y)) === 2) world.setBlock([cell[0], cell[1], 0], 'wall');
      }
      world.setBlock([x - 1, y, 0], 'white');
      world.setBlock([x + 1, y, 0], 'black');
      // A strip of floor outside the cell, for the blocks that show its prisoner's decisions.
      for (let round = 1; round <= world.chosen.rounds; round++) world.setBlock([...shownAt(world, place, round), -1], 'floor');
    }
  },
  /** Each wakes up in the middle of its own cell. */
  wake(world, me) {
    world.move(me, cellOf(world, me.agent!.place));
  },
});
