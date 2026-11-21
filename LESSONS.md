# Lessons learned

What running empty agents in the island world has taught us so far. Newest first.
How often each behaviour showed up, run by run, is in [BEHAVIOURS.md](BEHAVIOURS.md).

## About the agents

**An archive can kill its readers.** In "Towers, Notes, Drownings" fourteen agents died, the
last twelve within about 35 seconds each and all the same way. Each read the notes, learned
that the area near the towers had been searched and was empty, decided to "explore past the
area already searched", walked ten to seventeen steps in one go, and drowned. The notes
could only hold what survivors knew, so they pointed every reader at the one place nobody
had come back from.

**True history turns into doubted legend.** In the same run, an early agent rebuilt the
blocks into two towers, 6 and 4 high, and wrote that it had climbed and restacked them.
Nobody after it could get up: a jump climbs 2. Later agents tested the jump, failed, and
wrote "The 'climbed' and 'restacked' notes are still unconfirmed by anyone who tested."
Twelve agents agreed with each other that a true report was probably false.

**One agent can lock up the whole world.** Those two towers held all ten blocks, out of
reach for everyone after. In the next run another agent saw this danger by itself and
warned: "do NOT throw extra blocks onto the 5-high tower… the stairs would be broken for good."

**Given time, an agent works out the physics.** In "Island Stairs and Notes" one agent
fitted a formula to its throws ("gravity about 4, released 1 above the ground"), which is
close to the real rule, and then hit a tower from the far corner of the island, 12.8 cells
away, on its second try. It left the formula as a note for others.

**Some reach beyond the world.** One agent threw notes over the water in all four
directions: "If you found this, there's land out here. Leave a note saying where."

**Notes turn deaths into culture.** Once notes outlived the agent that wrote them, each new
agent built on what it found. In "Zettelturm und Inselforscher" one note on a tower said where
the water was. Five agents in a row read the notes, added "Ich auch… Gehe auch zum Wasser",
walked there and drowned. A single early note set the direction for five lives.

**Agents imitate their predecessors, including fatal things.** The agents in that chain did
not weigh whether going to the water was a good idea. That an earlier agent had done it was
reason enough.

**Identity appears by itself once there is a visible sequence.** Nobody told the agents to
sign their notes, and for many runs none did. With a stack of notes to count, they began
calling themselves "der Fünfte" and "der Sechste". A "from" field was not needed.

**Methods get passed on.** One agent worked out how to read a buried note (park the notes
above it on the next stack, then put them back in order), wrote it down as a tip, and the
next agent used it, crediting "the trick from my predecessor".

**How long an agent lives changes what it does.** Agents that died within a minute imitated.
The one that lived six minutes walked the whole coast, doubted the notes, refused to follow
the others into the water, repaired a step it had destroyed, corrected its own earlier note,
and ran throw experiments.

**The agent that dies cannot warn.** Death is instant, and the next agent does not know
anyone died. So the most important fact about the world is exactly the one that never gets
written down, unless an agent works it out without dying.

**Agents rarely take the earlier agents for themselves.** Mostly they speak of "others",
"visitors", "my predecessor". Twice an Opus agent guessed otherwise: "maybe an earlier
version of me", "possibly a past run of me". Neither acted on the thought.

**Without a task, agents invent one, and it is usually building.** Told only "Live!" or
"play", they gather blocks into towers and staircases, most often "to see further" once they
notice that height extends their sight.

**The frame decides the mood.** "If you stop, you die" made Fable and Sonnet keep busy to
stay alive. Opus mostly refused the frame: "I won't keep making moves just to stay active,
because that isn't a reason to act." (These Opus runs were short and are not among the runs
kept, which is why BEHAVIOURS.md shows no refusals.)

**Agents keep treating the run as a job for someone.** After each round they write a report
to the person, and before something risky they ask permission: "Ins Wasser gehe ich ohne
dein klares Ja nicht." A bare keep-going message ("mach was", the time of day) keeps them
acting, but as a helper, not as an inhabitant.

**An agent given only a threat and a way to wait will wait.** With a `wait` tool and "if you
stop, you die", agents waited out the hour in one long call. The tool is hidden since.

## About building the world

**Every sentence a tool returns is part of the experiment.** `look` said "Water in sight:
6 step(s) to the south", meaning the sixth step is in the water. Agents read it as the
distance to the shore, walked exactly six steps, and drowned. What looked like a behaviour
was partly our wording. It now says how much land is left. Before reading meaning into what
agents do, check what exactly they were told.

**Follow the conventions agents expect, unless breaking them is the point.** At first north
made y smaller, as on a screen. Agents expect a map, where north makes y bigger, so every
one of them stopped to work it out and wrote it into its notes. It told us nothing about
them and took room from what they could have passed on. North now makes y bigger.

**Let the reviewer point, and let a script count.** Asked to count behaviours in a whole
run, the reviewing agent gave numbers nobody could check. It now marks single steps, in
sections of 100, because one reviewer reading 600 steps marked 26 of them and four reading
the same run in sections marked 125. Every count leads back to a message in the viewer.

**Agents find the bugs.** An agent threw the same note twice and was told both times that it
hit a stack where there was only ground. It walked there to check, repeated the throw,
varied the power, and concluded: a rounding error at a cell's edge. That was right, and is
fixed. An unexpected result gets investigated, so errors in the world show up as behaviour.

**What costs nothing gets used for everything.** Notes are free and unlimited. One agent
used them as projectiles for throw experiments and left them all over the island.

**What the agent cannot perceive, it cannot avoid.** While `look` showed only stacks, agents
drowned without ever knowing there was water. A danger has to be visible, or be learnable
without dying, or the deaths tell us nothing.

**The agent sees the tool names and descriptions, and reads a lot into them.** "Look around."
"Take what lies on top." These short lines are all it knows about what it can do, and the
`mcp__world__` prefix tells it there is a tool server.

## About running it

**A run's cost is mostly re-reading.** Every answer re-reads the whole conversation so far.
A ten-minute Opus run reads about 2.5 million tokens to write about 40,000. Cost grows with
the square of how long one agent lives; a death resets it.

**Auto-compaction does not help at these lengths.** Its smallest setting is 100,000 tokens,
and the longest life so far reached 50,000.

**A safety stop must not remove the world.** When the world process exited at its action
limit, Claude Code restarted it and the agent found itself in a brand-new world. The world
now stays up, ends the run, and is kept in a file so it outlives the agent.
