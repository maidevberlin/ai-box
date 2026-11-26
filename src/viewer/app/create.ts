// The screen for starting a world. Its form is drawn from what the world declares: its
// settings, its roles (what kinds of agent live in it) and its tools.

import type { Role, Setting } from '../../engine/types.ts';
import { $, api, el } from './page.ts';

export interface WorldInfo {
  name: string; title: string; about: string; minutes: number;
  settings: Record<string, Setting>;
  roles: Record<string, Role>;
  tools: { name: string; about: string; needed?: true; on?: string[] }[];
}

const MODELS = ['opus', 'fable', 'sonnet', 'haiku'];
let worlds: WorldInfo[] = [];
let picked = '';

/** A switch: a checkbox that looks like what it is. */
function toggle(id: string, on: boolean, locked = false): HTMLInputElement {
  const box = el('input', 'switch');
  box.type = 'checkbox'; box.id = id; box.checked = on; box.disabled = locked;
  box.setAttribute('role', 'switch');
  return box;
}

function field(setting: Setting, id: string): HTMLElement {
  if (setting.type === 'switch') return toggle(id, setting.usual);
  if (setting.type === 'choice' || setting.type === 'choices') {
    const select = el('select', '', ...setting.options.map(option => el('option', '', option)));
    select.id = id; select.multiple = setting.type === 'choices';
    for (const option of select.options) option.selected = setting.type === 'choices' ? setting.usual.includes(option.value) : option.value === setting.usual;
    return select;
  }
  const input = el('input');
  input.id = id; input.value = String(setting.usual);
  if (setting.type === 'number') {
    input.type = 'number';
    if (setting.min !== undefined) input.min = String(setting.min);
    if (setting.max !== undefined) input.max = String(setting.max);
  }
  return input;
}

function value(setting: Setting, id: string): unknown {
  const node = $(id) as HTMLInputElement & HTMLSelectElement;
  if (setting.type === 'switch') return node.checked;
  if (setting.type === 'number') return Number(node.value);
  if (setting.type === 'choices') return [...node.selectedOptions].map(option => option.value);
  return node.value;
}

const chosen = (world: WorldInfo) => Object.fromEntries(Object.entries(world.settings).map(([name, setting]) => [name, value(setting, `set-${name}`)]));

/** A setting was changed. What a role is told can depend on the settings: a text that
 *  nobody has written in is set to what the world says now. */
async function settingsChanged(world: WorldInfo): Promise<void> {
  const now = await api<WorldInfo>(`/api/worlds/${world.name}?chosen=${encodeURIComponent(JSON.stringify(chosen(world)))}`);
  if (picked !== world.name || !now.roles) return;
  for (const [name, role] of Object.entries(now.roles)) {
    for (const part of ['told'] as const) {
      const text = document.getElementById(`role-${name}-${part}`) as HTMLTextAreaElement | null;
      if (text && text.value === world.roles[name]?.[part]) text.value = role[part];
    }
  }
  world.roles = now.roles;
}

const ICONS: Record<string, string> = {
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  mind: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  hand: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
};

/** The small picture in front of a card's heading. */
function icon(name: string): HTMLElement {
  const box = el('span', 'icon');
  box.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  return box;
}

/** The tools of a role, a line each with its switch. One the world does not work without stays on. */
function tools(world: WorldInfo, roleName: string, role: Role): HTMLElement {
  const count = el('span', 'chip');
  const list = el('div', 'tools', ...world.tools.map(tool => el('label', `tool${tool.needed ? ' needed' : ''}`,
    el('code', '', tool.name), el('small', '', tool.about, tool.on && el('i', '', ` Only: ${tool.on.join(', ')}.`)),
    toggle(`role-${roleName}-tool-${tool.name}`, tool.needed || !role.without?.includes(tool.name), tool.needed))));
  const counted = () => { count.textContent = `${list.querySelectorAll('.switch:checked').length} of ${world.tools.length} on`; };
  list.onchange = counted;
  counted();
  const title = Object.keys(world.roles).length > 1 ? `What ${role.title.toLowerCase()}s can do` : 'What they can do';
  return el('section', '', el('h2', '', icon('hand'), title, count), list);
}

function draw(): void {
  const world = worlds.find(found => found.name === picked) ?? worlds[0];
  if (!world) return;
  picked = world.name;
  $('worldPick').replaceChildren(...worlds.map(found => {
    const button = el('button', found.name === picked ? 'on' : '', found.title);
    button.type = 'button';
    button.onclick = () => { picked = found.name; draw(); };
    return button;
  }));
  // (The first paragraph says what the world is. The rest is behind "More about this world".)
  const flowing = world.about.replace(/(?<!\n)\n(?!\n)/g, ' ');   // its lines are broken for the code, not for the page
  $('worldShort').textContent = flowing.split('\n\n')[0]!;
  $('worldMore').hidden = !flowing.includes('\n\n');
  $('worldMore').onclick = () => {
    $('aboutTitle').textContent = world.title;
    $('aboutText').textContent = flowing;
    ($('aboutWorld') as HTMLDialogElement).showModal();
  };
  const row = (title: string, control: HTMLElement, more = '') => el('label', `row ${more}`, el('span', '', title), control);
  const settings = (about: 'agents' | undefined) => Object.entries(world.settings).filter(([, setting]) => setting.about === about)
    .map(([name, setting]) => row(setting.title, field(setting, `set-${name}`)));
  $('worldSettings').replaceChildren(...settings(undefined));
  $('worldSettings').parentElement!.hidden = !$('worldSettings').children.length;
  // Who lives in the world. With one kind of agent, who they are is on the same card.
  const living = el('div', 'rows', ...settings('agents'));
  $('worldSettings').onchange = living.onchange = () => void settingsChanged(world);
  const several = Object.keys(world.roles).length > 1;
  const lives = el('section', '', el('h2', '', icon('users'), 'Who lives in it'), living);
  $('worldRoles').replaceChildren(...(several ? [lives] : []), ...Object.entries(world.roles).flatMap(([name, role]) => {
    const model = el('select', '', ...MODELS.map(option => el('option', '', option)));
    model.id = `role-${name}-model`; model.value = role.model;
    const told = el('textarea'); told.id = `role-${name}-told`; told.value = role.told; told.rows = 2;
    const who = [row('Model', model), row("The world's message to an agent that wakes up", told, 'tall')];
    if (!several) lives.append(...who);
    return [several ? el('section', '', el('h2', '', icon('mind'), `${role.title}: who it is`), ...who) : lives, tools(world, name, role)];
  }));
  ($('minutes') as HTMLInputElement).value = String(world.minutes);
}

/** Opens the screen. `onStarted` is told the id of the run that was started. */
export async function openCreate(onStarted: (id: string) => void): Promise<void> {
  worlds = await api<WorldInfo[]>('/api/worlds');
  for (const head of document.querySelectorAll<HTMLElement>('#create h2[data-icon]')) {
    if (!head.querySelector('.icon')) head.prepend(icon(head.dataset.icon!));
  }
  draw();
  ($('create') as HTMLFormElement).onsubmit = async event => {
    event.preventDefault();
    const world = worlds.find(found => found.name === picked)!;
    const text = (id: string) => ($(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    const roles = Object.fromEntries(Object.keys(world.roles).map(name => [name, {
      model: text(`role-${name}-model`), told: text(`role-${name}-told`),
      without: world.tools.filter(tool => !($(`role-${name}-tool-${tool.name}`) as HTMLInputElement).checked).map(tool => tool.name),
    }]));
    const answer = await api<{ id?: string; error?: string }>('/api/runs', {
      world: world.name, chosen: chosen(world), roles, minutes: Number(text('minutes')) });
    if (answer.id) onStarted(answer.id);
    else alert(answer.error ?? 'That did not start.');
  };
}
