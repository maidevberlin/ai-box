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

export function realTime(): Time {
  const start = performance.now();
  const pending = new Set<ReturnType<typeof setTimeout>>();
  return {
    now: () => (performance.now() - start) / 1000,
    after(seconds, what) {
      const timer = setTimeout(() => { pending.delete(timer); what(); }, Math.max(0, seconds) * 1000);
      pending.add(timer);
      return () => { clearTimeout(timer); pending.delete(timer); };
    },
    stop() {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    },
  };
}

/** Time for tests: `pass(seconds)` lets that much time go by at once, and everything that
 *  was asked for in it happens, in order. */
export function testTime(): Time & { pass(seconds: number): void } {
  let now = 0, count = 0;
  let waiting: { at: number; order: number; what: () => void }[] = [];
  return {
    now: () => now,
    after(seconds, what) {
      const entry = { at: now + Math.max(0, seconds), order: count++, what };
      waiting.push(entry);
      return () => { waiting = waiting.filter(other => other !== entry); };
    },
    stop() { waiting = []; },
    pass(seconds) {
      const until = now + seconds;
      for (;;) {
        const next = waiting.filter(entry => entry.at <= until).sort((a, b) => a.at - b.at || a.order - b.order)[0];
        if (!next) break;
        waiting = waiting.filter(entry => entry !== next);
        now = next.at;
        next.what();
      }
      now = until;
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
