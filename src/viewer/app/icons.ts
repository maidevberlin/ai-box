// Icons, by their names at lucide.dev ("footprints"). A world says which icon each thing its
// agents do has (see Shown in engine/types.ts); the run says the rest (EVENTS). Every icon there
// is comes with the page: a world may name any of them, also only while it runs (OverHead).

import { createElement, icons, type IconNode } from 'lucide';

/** The icons of what happens in a run besides what agents do with their tools. */
export const EVENTS: Record<string, string> = {
  wake: 'sunrise', senses: 'bell-ring', death: 'skull', end: 'flag', error: 'circle-exclamation-point',
};

const DOT: IconNode = [['circle', { cx: '12', cy: '12', r: '2' }]];

/** The icon of a name ("arrow-big-up"), if there is one. */
export const drawing = (name: string): IconNode | undefined =>
  (icons as Record<string, IconNode>)[name.replace(/(^|-)([a-z0-9])/g, (_, __, letter: string) => letter.toUpperCase())];

const unknown = new Set<string>();

/** An icon by its name. One there is none of is a dot, and said in the console (once). */
export function icon(name: string): SVGElement {
  const found = drawing(name);
  if (!found && name !== 'dot' && !unknown.has(name)) {
    unknown.add(name);
    console.warn(`There is no icon "${name}" (lucide.dev).`);
  }
  const made = createElement(found ?? DOT);
  made.classList.add('icon');
  return made;
}
