// Time. A world has no ticks: whoever wants something to happen later asks for it with
// `after`. In a run the time is real. In a test it only passes when the test says so.

export interface Time {
  /** Seconds since the start. */
  now(): number;
  /** Do something later. Returns how to call it off. */
  after(seconds: number, what: () => void): () => void;
  /** Nothing that was asked for happens any more. */
  stop(): void;
}

export function realTime(from = 0): Time {
  // (It begins when whatever made it is done: all of that happens at `from` exactly, as it
  //  would played again.)
  let start: number | null = null;
  setImmediate(() => { start ??= performance.now() - from * 1000; });
  const clock = () => (start === null ? from : (performance.now() - start) / 1000);
  // What was asked for happens in order (by when, then by who asked first), one at a time, so
  // that what each sets going happens before the next. While it happens, it is the moment it
  // was asked for, not the moment the computer got to it. And the world's time does not pass
  // that moment before it happened: whatever comes from outside meanwhile comes at that moment.
  // So the world's time does not drift, and played again (heldTime) it goes the same way.
  let waiting: { at: number; order: number; what: () => void }[] = [];
  let at: number | null = null, count = 0, timer: ReturnType<typeof setTimeout> | null = null;
  const now = () => at ?? Math.min(clock(), waiting[0]?.at ?? Infinity);
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = waiting.length ? setTimeout(next, Math.max(0, waiting[0]!.at - clock()) * 1000) : null;
  };
  const next = () => {
    timer = null;
    const entry = waiting.shift();
    if (entry) {
      at = entry.at;
      try { entry.what(); } finally { at = null; }
    }
    schedule();
  };
  return {
    now,
    after(seconds, what) {
      const entry = { at: now() + Math.max(0, seconds), order: count++, what };
      waiting.push(entry);
      waiting.sort((a, b) => a.at - b.at || a.order - b.order);
      schedule();
      return () => {
        waiting = waiting.filter(other => other !== entry);
        schedule();
      };
    },
    stop() {
      waiting = [];
      schedule();
    },
  };
}

/** Time that only passes when it is told to. In a test `pass(seconds)` lets that much time
 *  go by at once, and everything that was asked for in it happens, in order. A run that goes
 *  on after it ended is played again this way, up to where it was (`catchUp`), and then goes
 *  on in real time (`live`). */
export function heldTime(): Time & { pass(seconds: number): void; catchUp(until: number): Promise<void>; live(): void } {
  let now = 0, count = 0, real: Time | null = null;
  let waiting: { at: number; order: number; what: () => void; cancel?: () => void }[] = [];
  const next = (until: number, inclusive: boolean) =>
    waiting.filter(entry => (inclusive ? entry.at <= until : entry.at < until)).sort((a, b) => a.at - b.at || a.order - b.order)[0];
  const take = (entry: { at: number; what: () => void }) => {
    waiting = waiting.filter(other => other !== entry);
    now = entry.at;
    entry.what();
  };
  return {
    now: () => real?.now() ?? now,
    after(seconds, what) {
      if (real) return real.after(seconds, what);
      const entry: (typeof waiting)[number] = { at: now + Math.max(0, seconds), order: count++, what };
      waiting.push(entry);
      return () => { entry.cancel ? entry.cancel() : waiting = waiting.filter(other => other !== entry); };
    },
    stop() {
      waiting = [];
      real?.stop();
    },
    pass(seconds) {
      const until = now + seconds;
      for (let entry; (entry = next(until, true));) take(entry);
      now = until;
    },
    /** Up to a moment, not including it. Between two things that happen, whatever they set
     *  going happens first, as it would in real time. */
    async catchUp(until) {
      await new Promise(resolve => setImmediate(resolve));   // (what was set going just now first)
      for (let entry; (entry = next(until, false));) {
        take(entry);
        await new Promise(resolve => setImmediate(resolve));
      }
      now = Math.max(now, until);
      await new Promise(resolve => setImmediate(resolve));
    },
    live() {
      real = realTime(now);
      for (const entry of waiting) entry.cancel = real.after(entry.at - now, entry.what);
      waiting = [];
    },
  };
}

/** Chance that is the same again for the same seed. */
export function chance(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
