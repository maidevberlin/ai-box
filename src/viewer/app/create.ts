// The screen for starting a world. Its form is drawn from what the world declares: its
// settings, its roles (what kinds of agent live in it) and its tools.

import type { Model, Provider } from '../../engine/mind.ts';
import type { Role, Setting } from '../../engine/types.ts';
import { brand, logo } from './brands.ts';
import { $, api, el } from './page.ts';

export interface WorldInfo {
  name: string; title: string; about: string; minutes: number;
  settings: Record<string, Setting>;
  roles: Record<string, Role>;
  tools: { name: string; about: string; needed?: true; on?: string[] }[];
}

/** An AI on this computer, as the server found it: Claude Code, Codex, pi, Ollama … */
interface MindInfo { kind: string; title: string; local: boolean; providers: Provider[] }

let worlds: WorldInfo[] = [];
let minds: MindInfo[] = [];
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

/** Sets a field to a value, if it can have it. */
function fill(setting: Setting, id: string, given: unknown): void {
  const node = $(id) as HTMLInputElement & HTMLSelectElement;
  if (setting.type === 'switch') node.checked = given === true;
  else if (setting.type === 'choices') for (const option of node.options) option.selected = Array.isArray(given) && given.includes(option.value);
  else if (setting.type !== 'choice' || setting.options.includes(String(given))) node.value = String(given);
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

// ---------------------------------------------------------------- who thinks for a role

/** One provider of models, as one AI offers it: Claude through Claude Code, Z.ai through pi. */
interface Source { mind: MindInfo; provider: Provider }
const sources = (): Source[] => minds.flatMap(mind => mind.providers.map(provider => ({ mind, provider })));
const valueOf = (source: Source, model: Model) => `${source.mind.kind}/${model.id}`;
const named = (source: Source) => brand(source.provider.id, source.provider.title).title;
const via = (mind: MindInfo) => (mind.local ? 'on this computer' : `via ${mind.title}`);

/** Where a role's model ("pi/zai/glm-5") comes from, if it is there on this computer. */
function found(model: string): { source: Source; model: Model } | null {
  for (const source of sources()) {
    const match = source.provider.models.find(candidate => valueOf(source, candidate) === model);
    if (match) return { source, model: match };
  }
  return null;
}

/** The field of a role's model: a button that shows it, and opens the picker. */
function picker(name: string, role: Role): HTMLElement {
  const input = el('input');
  input.type = 'hidden'; input.id = `role-${name}-model`;
  const button = el('button', 'pick');
  button.type = 'button'; button.id = `role-${name}-pick`;
  button.onclick = () => pick(name, role.title);
  return el('span', 'picker', input, button);
}

/** Sets a role's model, and shows it. `byHand`: a person chose it (the form keeps it). */
function choose(name: string, model: string, byHand = false): void {
  const input = $(`role-${name}-model`) as HTMLInputElement;
  input.value = model;
  const there = found(model);
  $(`role-${name}-pick`).replaceChildren(
    ...(there ? [logo(there.source.provider.id, there.source.provider.title, 30),
                 el('span', 'what', el('b', '', there.model.title), el('small', '', `${named(there.source)} · ${via(there.source.mind)}`))]
      : [el('span', 'what', el('b', '', minds.length ? 'Choose a model' : 'No AI is connected yet'),
            el('small', '', model ? `${model} is not there on this computer` : minds.length ? '' : 'Connect one under AI connections'))]),
    el('span', 'chevron', '›'));
  if (byHand) input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The picker: first who provides the model, then the model. */
function pick(name: string, roleTitle: string): void {
  const dialog = $('pickModel') as HTMLDialogElement, now = ($(`role-${name}-model`) as HTMLInputElement).value;
  const providers = () => {
    $('pickBack').hidden = true;
    $('pickTitle').textContent = `Who thinks for the ${roleTitle.toLowerCase()}?`;
    $('pickHint').textContent = 'The AIs on this computer, and who provides their models.';
    const tiles = sources().map(source => {
      const tile = el('button', `tile${found(now)?.source === source ? ' on' : ''}`,
        logo(source.provider.id, source.provider.title, 40),
        el('span', 'what', el('b', '', named(source)), el('small', '', via(source.mind)),
           el('small', '', `${source.provider.models.length} model${source.provider.models.length === 1 ? '' : 's'}`)));
      tile.type = 'button';
      tile.onclick = () => models(source);
      return tile;
    });
    const more = el('a', 'tile more', el('span', 'what', el('b', '', 'Connect more AIs'), el('small', '', 'Install, log in, add a key')));
    more.href = '#ais';
    more.onclick = () => dialog.close();
    $('pickBody').replaceChildren(...(tiles.length ? [] : [el('p', 'empty', 'No AI is connected yet.')]), el('div', 'tiles', ...tiles, more));
  };
  const models = (source: Source) => {
    $('pickBack').hidden = false;
    $('pickTitle').replaceChildren(logo(source.provider.id, source.provider.title, 28), named(source));
    $('pickHint').textContent = `${source.provider.models.length} model${source.provider.models.length === 1 ? '' : 's'} ${via(source.mind)}.`;
    const list = el('div', 'models');
    const shown = (filter: string) => list.replaceChildren(...source.provider.models
      .filter(model => !filter || `${model.title} ${model.id} ${model.about}`.toLowerCase().includes(filter.toLowerCase()))
      .map(model => {
        const row = el('button', `model${valueOf(source, model) === now ? ' on' : ''}`,
          el('span', 'what', el('b', '', model.title), model.about && el('small', '', model.about)),
          model.usual && el('span', 'chip', 'usual'));
        row.type = 'button';
        row.onclick = () => {
          choose(name, valueOf(source, model), true);
          dialog.close();
        };
        return row;
      }));
    const search = el('input', 'search');
    search.type = 'search'; search.placeholder = 'Find a model';
    search.oninput = () => shown(search.value);
    shown('');
    $('pickBody').replaceChildren(...(source.provider.models.length > 10 ? [search] : []), list);
  };
  $('pickBack').onclick = providers;
  const current = found(now);
  if (current && sources().length === 1) models(current.source);
  else providers();
  dialog.showModal();
}

// ---------------------------------------------------------------- what was set last

/** How the form is filled in. What a role is told is only kept if a person wrote it: else
 *  it is what the world says, which can depend on the settings. */
interface Filled {
  chosen: Record<string, unknown>;
  minutes: number;
  roles: Record<string, { model: string; told: string | null; without: string[] }>;
}

const text = (id: string) => ($(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
const switchedOff = (world: WorldInfo, role: string) => world.tools.filter(tool => !($(`role-${role}-tool-${tool.name}`) as HTMLInputElement).checked).map(tool => tool.name);

/** How the form is filled in now. */
const filled = (world: WorldInfo): Filled => ({
  chosen: chosen(world), minutes: Number(text('minutes')),
  roles: Object.fromEntries(Object.entries(world.roles).map(([name, role]) => [name, {
    model: text(`role-${name}-model`), told: text(`role-${name}-told`) === role.told ? null : text(`role-${name}-told`), without: switchedOff(world, name) }])),
});

/** The model a role gets when nobody chose one: the usual one of the first AI there is. */
function usualModel(): string {
  const [first] = minds;
  const models = first?.providers.flatMap(provider => provider.models) ?? [];
  const model = models.find(found => found.usual) ?? models[0];
  return first && model ? `${first.kind}/${model.id}` : '';
}
const offered = (model: string) => !!found(model);

/** How the form is filled in when nobody has touched it. */
const usually = (world: WorldInfo): Filled => ({
  chosen: Object.fromEntries(Object.entries(world.settings).map(([name, setting]) => [name, setting.type === 'choices' ? [...setting.usual] : setting.usual])),
  minutes: world.minutes,
  roles: Object.fromEntries(Object.entries(world.roles).map(([name, role]) => [name, {
    model: role.model ?? usualModel(), told: null, without: world.tools.filter(tool => !tool.needed && role.without?.includes(tool.name)).map(tool => tool.name) }])),
});

// What was set last is kept in the browser, for each world, and filled in again the next time.
// (The browser may not let the page keep anything: then the form is just the usual one.)
const key = (world: WorldInfo) => `tinkerlings:${world.name}`;
function kept(world: WorldInfo): Filled | null {
  try { return JSON.parse(localStorage.getItem(key(world)) ?? 'null'); } catch { return null; }
}
/** Keeps how the form is filled in, and shows the way back if it is not the usual. */
function keep(world: WorldInfo): void {
  const now = filled(world), usual = JSON.stringify(now) === JSON.stringify(usually(world));
  try {
    if (usual) localStorage.removeItem(key(world));
    else localStorage.setItem(key(world), JSON.stringify(now));
  } catch { /* nothing is kept */ }
  $('reset').hidden = usual;
}

/** Fills the form in the way it was left the last time. */
async function fillAgain(world: WorldInfo): Promise<void> {
  const last = kept(world);
  if (last) {
    for (const [name, setting] of Object.entries(world.settings)) if (name in (last.chosen ?? {})) fill(setting, `set-${name}`, last.chosen[name]);
    ($('minutes') as HTMLInputElement).value = String(last.minutes ?? world.minutes);
    await settingsChanged(world);   // (what the roles are told with these settings)
    if (picked !== world.name) return;
    for (const [name, role] of Object.entries(last.roles ?? {})) {
      if (!world.roles[name]) continue;
      if (offered(role.model)) choose(name, role.model);
      if (role.told !== null) ($(`role-${name}-told`) as HTMLTextAreaElement).value = role.told;
      for (const tool of world.tools) if (!tool.needed) ($(`role-${name}-tool-${tool.name}`) as HTMLInputElement).checked = !role.without.includes(tool.name);
      $(`role-${name}-tool-${world.tools[0]?.name}`)?.dispatchEvent(new Event('change', { bubbles: true }));   // (the count of tools that are on)
    }
  }
  keep(world);
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
  const several = Object.keys(world.roles).length > 1;
  const lives = el('section', '', el('h2', '', icon('users'), 'Who lives in it'), living);
  $('worldRoles').replaceChildren(...(several ? [lives] : []), ...Object.entries(world.roles).flatMap(([name, role]) => {
    const model = picker(name, role);
    const told = el('textarea'); told.id = `role-${name}-told`; told.value = role.told; told.rows = 2;
    const who = [row('Model', model), row("The world's message to an agent that wakes up", told, 'tall')];
    if (!several) lives.append(...who);
    return [several ? el('section', '', el('h2', '', icon('mind'), `${role.title}: who it is`), ...who) : lives, tools(world, name, role)];
  }));
  for (const [name, role] of Object.entries(world.roles)) choose(name, role.model ?? usualModel());
  ($('minutes') as HTMLInputElement).value = String(world.minutes);
  void fillAgain(world);
}

/** Opens the screen. `onStarted` is told the id of the run that was started. */
export async function openCreate(onStarted: (id: string) => void): Promise<void> {
  [worlds, minds] = await Promise.all([api<WorldInfo[]>('/api/worlds'), api<MindInfo[]>('/api/minds')]);
  for (const head of document.querySelectorAll<HTMLElement>('#create h2[data-icon]')) {
    if (!head.querySelector('.icon')) head.prepend(icon(head.dataset.icon!));
  }
  draw();
  const form = $('create') as HTMLFormElement, now = () => worlds.find(found => found.name === picked)!;
  // Whatever is set is kept at once. (After the settings have changed what the roles are told.)
  form.oninput = () => keep(now());
  form.onchange = async () => {
    const world = now();
    await settingsChanged(world);
    if (picked === world.name) keep(world);
  };
  $('reset').onclick = async () => {
    try { localStorage.removeItem(key(now())); } catch { /* nothing was kept */ }
    worlds = await api<WorldInfo[]>('/api/worlds');
    draw();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const world = now();
    const roles = Object.fromEntries(Object.keys(world.roles).map(name => [name, {
      model: text(`role-${name}-model`), told: text(`role-${name}-told`), without: switchedOff(world, name) }]));
    const answer = await api<{ id?: string; error?: string }>('/api/runs', {
      world: world.name, chosen: chosen(world), roles, minutes: Number(text('minutes')) });
    if (answer.id) onStarted(answer.id);
    else alert(answer.error ?? 'That did not start.');
  };
}
