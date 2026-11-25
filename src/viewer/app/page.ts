// Small helpers for building the page.

export const $ = (id: string) => document.getElementById(id)!;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...content: (Node | string | false | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...content.filter((part): part is Node | string => part !== false && part != null));
  return node;
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const answer = await fetch(path, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) });
  return answer.json();
}

/** 75 -> "1:15" */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** A run's id is the moment it started: 20261125-220619 */
export function started(id: string): string {
  const [, y, mo, d, h, mi] = id.match(/(....)(..)(..)-(..)(..)/)!;
  const date = new Date(+y!, +mo! - 1, +d!, +h!, +mi!);
  const today = date.toDateString() === new Date().toDateString();
  return date.toLocaleString([], today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
