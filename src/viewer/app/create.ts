// The screen for starting a world. Its form is drawn from what the world declares: its
// settings, and its roles (what kinds of agent live in it).

import type { Role, Setting } from '../../engine/types.ts';
import { $, api, el } from './page.ts';

export interface WorldInfo {
  name: string; title: string; about: string; minutes: number;
  settings: Record<string, Setting>;
  roles: Record<string, Role>;
}

const MODELS = ['opus', 'fable', 'sonnet', 'haiku'];
let worlds: WorldInfo[] = [];
let picked = '';

function field(setting: Setting, id: string): HTMLElement {
  if (setting.type === 'switch') {
    const box = el('input');
    box.type = 'checkbox'; box.id = id; box.checked = setting.usual;
    return box;
  }
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
  $('worldAbout').textContent = world.about;
  const row = (title: string, control: HTMLElement) => el('label', 'row', el('span', '', title), control);
  $('worldSettings').replaceChildren(...Object.entries(world.settings).map(([name, setting]) => row(setting.title, field(setting, `set-${name}`))));
  $('worldRoles').replaceChildren(...Object.entries(world.roles).map(([name, role]) => {
    const model = el('select', '', ...MODELS.map(option => el('option', '', option)));
    model.id = `role-${name}-model`; model.value = role.model;
    const told = el('textarea'); told.id = `role-${name}-told`; told.value = role.told; told.rows = 2;
    const knows = el('textarea'); knows.id = `role-${name}-knows`; knows.value = role.knows; knows.rows = 3;
    return el('fieldset', '', el('legend', '', role.title), row('Model', model), row('What it knows before', knows), row('What it is told', told));
  }));
  ($('minutes') as HTMLInputElement).value = String(world.minutes);
}

/** Opens the screen. `onStarted` is told the id of the run that was started. */
export async function openCreate(onStarted: (id: string) => void): Promise<void> {
  worlds = await api<WorldInfo[]>('/api/worlds');
  draw();
  ($('create') as HTMLFormElement).onsubmit = async event => {
    event.preventDefault();
    const world = worlds.find(found => found.name === picked)!;
    const chosen = Object.fromEntries(Object.entries(world.settings).map(([name, setting]) => [name, value(setting, `set-${name}`)]));
    const roles = Object.fromEntries(Object.keys(world.roles).map(name => [name, {
      model: ($(`role-${name}-model`) as HTMLSelectElement).value,
      told: ($(`role-${name}-told`) as HTMLTextAreaElement).value,
      knows: ($(`role-${name}-knows`) as HTMLTextAreaElement).value,
    }]));
    const answer = await api<{ id?: string; error?: string }>('/api/runs', {
      world: world.name, chosen, roles, minutes: Number(($('minutes') as HTMLInputElement).value),
      agents: Number(($('agents') as HTMLInputElement).value) || undefined });
    if (answer.id) onStarted(answer.id);
    else alert(answer.error ?? 'That did not start.');
  };
}
