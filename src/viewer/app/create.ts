// The screen for starting a world, in three steps: the world, who lives in it, and how it
// ends. Its form is drawn from what the world declares: its settings, its roles (what kinds
// of agent live in it) and its tools. Agents of a role are set up all the same, or each on
// its own: its own AI, its own message, its own tools.

import type { Model, Provider } from '../../engine/mind.ts';
import type { Role, Setting } from '../../engine/types.ts';
import { brand, logo } from './brands.ts';
import { $, api, el } from './page.ts';

export interface WorldInfo {
  name: string; title: string; about: string; minutes: number; ends: string;
  settings: Record<string, Setting>;
  roles: Record<string, Role>;
  tools: { name: string; about: string; needed?: true; on?: string[] }[];
}

/** An AI on this computer, as the server found it: Claude Code, Codex, pi, Ollama … */
interface MindInfo { kind: string; title: string; local: boolean; providers: Provider[] }

/** One agent as the form sets it up. `told`: nothing if it is told what the world says. */
interface Agent { model: string; told: string | null; without: string[] }

/** The agents of a role: all set up the same (`all`, `count` of them), or each on its own. */
interface Agents { same: boolean; count: number; all: Agent; each: Agent[] }

/** How the form is filled in. */
interface Filled {
  chosen: Record<string, unknown>;
  /** 0: no time limit. */
  minutes: number;
  roles: Record<string, Agents>;
}

let worlds: WorldInfo[] = [];
let minds: MindInfo[] = [];
let picked = '';
let form: Filled;

const world = () => worlds.find(found => found.name === picked)!;

// ---------------------------------------------------------------- fields

/** A switch: a checkbox that looks like what it is. */
function toggle(on: boolean, locked = false): HTMLInputElement {
  const box = el('input', 'switch');
  box.type = 'checkbox'; box.checked = on; box.disabled = locked;
  box.setAttribute('role', 'switch');
  return box;
}

/** The field of a setting, showing what is chosen. Changing it sets it. */
function field(name: string, setting: Setting): HTMLElement {
  const now = form.chosen[name];
  const set = (value: unknown) => void settingsChanged(name, value);
  if (setting.type === 'switch') {
    const box = toggle(now === true);
    box.onchange = () => set(box.checked);
    return box;
  }
  if (setting.type === 'choice' || setting.type === 'choices') {
    const select = el('select', '', ...setting.options.map(option => el('option', '', option)));
    select.multiple = setting.type === 'choices';
    for (const option of select.options) option.selected = Array.isArray(now) ? now.includes(option.value) : option.value === now;
    select.onchange = () => set(setting.type === 'choices' ? [...select.selectedOptions].map(option => option.value) : select.value);
    return select;
  }
  const input = el('input');
  input.value = String(now);
  if (setting.type === 'number') {
    input.type = 'number';
    if (setting.min !== undefined) input.min = String(setting.min);
    if (setting.max !== undefined) input.max = String(setting.max);
  }
  input.onchange = () => set(setting.type === 'number' ? Number(input.value) : input.value);
  return input;
}

/** A line of the form: what it is (and a few words more), and its field. */
const row = (title: string, control: HTMLElement, hint?: string, tall = false) =>
  el('label', `row${tall ? ' tall' : ''}`, el('span', 'what', el('b', '', title), hint && el('small', '', hint)), control);

/** The world's settings that are about something: as lines of the form. */
const settings = (about: Setting['about'], more = false) => Object.entries(world().settings)
  .filter(([, setting]) => setting.about === about && !!setting.more === more)
  .map(([name, setting]) => row(setting.title, field(name, setting), setting.hint));
const moreSettings = () => Object.entries(world().settings).filter(([, setting]) => setting.more)
  .map(([name, setting]) => row(setting.title, field(name, setting), setting.hint));

/** A setting was changed. What a role is told can depend on the settings: what the world
 *  says is asked again. */
async function settingsChanged(name: string, value: unknown): Promise<void> {
  form.chosen[name] = value;
  keep();
  const was = world();
  const now = await api<WorldInfo>(`/api/worlds/${was.name}?chosen=${encodeURIComponent(JSON.stringify(form.chosen))}`);
  if (picked !== was.name || !now.roles) return;
  was.roles = now.roles;
  drawAgents();
}

// ---------------------------------------------------------------- who thinks for an agent

/** One provider of models, as one AI offers it: Claude through Claude Code, Z.ai through pi. */
interface Source { mind: MindInfo; provider: Provider }
const sources = (): Source[] => minds.flatMap(mind => mind.providers.map(provider => ({ mind, provider })));
const valueOf = (source: Source, model: Model) => `${source.mind.kind}/${model.id}`;
const named = (source: Source) => brand(source.provider.id, source.provider.title).title;
const via = (mind: MindInfo) => (mind.local ? 'on this computer' : `via ${mind.title}`);

/** Where a model ("pi/zai/glm-5") comes from, if it is there on this computer. */
function found(model: string): { source: Source; model: Model } | null {
  for (const source of sources()) {
    const match = source.provider.models.find(candidate => valueOf(source, candidate) === model);
    if (match) return { source, model: match };
  }
  return null;
}

/** The model an agent gets when nobody chose one: the usual one of the first AI there is. */
function usualModel(): string {
  const [first] = minds;
  const models = first?.providers.flatMap(provider => provider.models) ?? [];
  const model = models.find(candidate => candidate.usual) ?? models[0];
  return first && model ? `${first.kind}/${model.id}` : '';
}

/** A big button that shows an agent's AI, and opens the picker. */
function aiButton(agent: Agent, whose: string): HTMLButtonElement {
  const there = found(agent.model);
  const button = el('button', 'pick',
    ...(there ? [logo(there.source.provider.id, there.source.provider.title, 36),
                 el('span', 'what', el('b', '', there.model.title), el('small', '', `${named(there.source)} · ${via(there.source.mind)}`))]
      : [el('span', 'what', el('b', '', minds.length ? 'Choose an AI' : 'No AI is connected yet'),
            el('small', '', agent.model ? `${agent.model} is not there on this computer` : minds.length ? '' : 'Connect one under AI connections'))]),
    el('span', 'change', 'Change'));
  button.type = 'button';
  button.onclick = () => pick(agent.model, whose, model => {
    agent.model = model;
    keep();
    drawAgents();
  });
  return button;
}

/** The picker: first who provides the model, then the model. */
function pick(now: string, whose: string, chosen: (model: string) => void): void {
  const dialog = $('pickModel') as HTMLDialogElement;
  const providers = () => {
    $('pickBack').hidden = true;
    $('pickTitle').textContent = `Who thinks for ${whose}?`;
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
        const line = el('button', `model${valueOf(source, model) === now ? ' on' : ''}`,
          el('span', 'what', el('b', '', model.title), model.about && el('small', '', model.about)),
          model.usual && el('span', 'chip', 'usual'));
        line.type = 'button';
        line.onclick = () => {
          dialog.close();
          chosen(valueOf(source, model));
        };
        return line;
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

// ---------------------------------------------------------------- the agents

/** What an agent is told when it wakes up: the world's message, unless a person wrote another. */
function message(agent: Agent, role: Role): HTMLElement {
  const text = el('textarea');
  text.rows = 3; text.value = agent.told ?? role.told;
  text.oninput = () => {
    agent.told = text.value === role.told ? null : text.value;
    keep();
  };
  return el('label', 'field', el('span', '', "The world's message when it wakes up"), text);
}

/** What an agent can do: its tools, a line each with its switch, folded away. One the world
 *  does not work without stays on. */
function tools(agent: Agent): HTMLElement {
  const all = world().tools;
  const count = el('span', 'chip');
  const counted = () => { count.textContent = `${all.length - agent.without.length} of ${all.length} on`; };
  const list = el('div', 'tools', ...all.map(tool => {
    const box = toggle(tool.needed || !agent.without.includes(tool.name), tool.needed);
    box.onchange = () => {
      agent.without = box.checked ? agent.without.filter(name => name !== tool.name) : [...agent.without, tool.name];
      counted();
      keep();
    };
    return el('label', `tool${tool.needed ? ' needed' : ''}`,
      el('code', '', tool.name), el('small', '', tool.about, tool.on && el('i', '', ` Only: ${tool.on.join(', ')}.`)), box);
  }));
  counted();
  return el('details', 'can', el('summary', '', 'What it can do', count), list);
}

/** One agent's card: its AI first, then what it is told and what it can do. */
function agentCard(agent: Agent, role: Role, title: string, remove?: () => void): HTMLElement {
  const head = el('div', 'head', el('b', '', title));
  if (remove) {
    const button = el('button', 'link quiet', 'Remove');
    button.type = 'button';
    button.onclick = remove;
    head.append(button);
  }
  return el('div', 'agent', head, aiButton(agent, title.toLowerCase()), message(agent, role), tools(agent));
}

/** A number with − and + beside it. */
function stepper(value: number, least: number, most: number, changed: (value: number) => void): HTMLElement {
  const button = (text: string, by: number) => {
    const node = el('button', '', text);
    node.type = 'button';
    node.disabled = value + by < least || value + by > most;
    node.onclick = () => changed(value + by);
    return node;
  };
  return el('span', 'stepper', button('−', -1), el('b', '', String(value)), button('+', 1));
}

const copy = (agent: Agent): Agent => ({ ...agent, without: [...agent.without] });

/** Who lives in the world: for each role, how many, and who they are. */
function drawAgents(): void {
  const several = Object.keys(world().roles).length > 1;
  $('agentsBody').replaceChildren(...Object.entries(world().roles).flatMap(([name, role]) => {
    const agents = form.roles[name]!;
    const [least, most] = role.between ?? [role.count, role.count];
    const plural = role.title.toLowerCase() + 's';
    const how = el('div', 'segments',
      ...([[true, 'All the same'], [false, 'Each their own']] as const).map(([same, title]) => {
        const button = el('button', agents.same === same ? 'on' : '', title);
        button.type = 'button';
        button.onclick = () => {
          if (agents.same === same) return;
          if (same) [agents.all, agents.count] = [copy(agents.each[0] ?? agents.all), agents.each.length];
          else agents.each = Array.from({ length: agents.count }, () => copy(agents.all));
          agents.same = same;
          keep();
          drawAgents();
        };
        return button;
      }));
    const count = agents.same ? agents.count : agents.each.length;
    const top = el('div', 'top', how, least === most || !agents.same
      ? el('span', 'muted', `${count} ${count === 1 ? role.title.toLowerCase() : plural}${least === most ? '' : ' at the start'}`)
      : el('span', 'count', 'How many', stepper(agents.count, least, most, value => {
        agents.count = value;
        keep();
        drawAgents();
      })));
    const body = agents.same
      ? [agentCard(agents.all, role, count === 1 ? `The ${role.title.toLowerCase()}` : `All ${count} ${plural}`)]
      : [el('div', 'agents', ...agents.each.map((agent, i) => agentCard(agent, role, `${role.title} ${i + 1}`,
          agents.each.length > least ? () => {
            agents.each.splice(i, 1);
            keep();
            drawAgents();
          } : undefined)),
        ...(agents.each.length < most ? [(() => {
          const add = el('button', 'another', `+ Add ${role.title.toLowerCase()}`);
          add.type = 'button';
          add.onclick = () => {
            agents.each.push(copy(agents.each.at(-1) ?? agents.all));
            keep();
            drawAgents();
          };
          return add;
        })()] : []))];
    return [...(several ? [el('h3', '', role.title)] : []), top, ...body];
  }), ...(settings('agents').length ? [el('div', 'rows rules', ...settings('agents'))] : []));
  summarize();
}

// ---------------------------------------------------------------- how it ends

function drawEnd(): void {
  const limit = toggle(form.minutes > 0);
  const minutes = el('input');
  minutes.type = 'number'; minutes.min = '1'; minutes.value = String(form.minutes || world().minutes || 10);
  minutes.disabled = !form.minutes;
  limit.onchange = () => {
    form.minutes = limit.checked ? Number(minutes.value) || 10 : 0;
    minutes.disabled = !limit.checked;
    keep();
  };
  minutes.oninput = () => {
    form.minutes = Math.max(1, Number(minutes.value) || 1);
    keep();
  };
  $('endBody').replaceChildren(el('p', 'ends', world().ends), ...settings('ending'),
    row('Time limit', el('span', 'limit', limit, minutes, el('span', 'muted', 'minutes')),
        world().minutes ? undefined : 'If it has not ended by itself before.'));
}

// ---------------------------------------------------------------- what is set, in one line

function summarize(): void {
  const all = Object.values(form.roles).flatMap(agents => (agents.same ? Array(agents.count).fill(agents.all) : agents.each) as Agent[]);
  const models = [...new Set(all.map(agent => found(agent.model)?.model.title ?? 'no AI chosen'))];
  $('createSummary').textContent = `${world().title} · ${all.length} agent${all.length === 1 ? '' : 's'} · ${models.join(', ')}`;
}

// ---------------------------------------------------------------- what was set last

/** How the form is filled in when nobody has touched it. */
function usually(of: WorldInfo): Filled {
  return {
    chosen: Object.fromEntries(Object.entries(of.settings).map(([name, setting]) => [name, setting.type === 'choices' ? [...setting.usual] : setting.usual])),
    minutes: of.minutes,
    roles: Object.fromEntries(Object.entries(of.roles).map(([name, role]) => {
      const agent: Agent = { model: role.model ?? usualModel(), told: null,
                             without: of.tools.filter(tool => !tool.needed && role.without?.includes(tool.name)).map(tool => tool.name) };
      return [name, { same: true, count: role.count, all: agent, each: [] }];
    })),
  };
}

// What was set last is kept in the browser, for each world, and filled in again the next time.
// (The browser may not let the page keep anything: then the form is just the usual one.)
const key = (of: WorldInfo) => `tinkerlings:${of.name}`;

/** How the form was left the last time, as far as it still fits the world and this computer. */
function kept(of: WorldInfo): Filled {
  const usual = usually(of);
  let last: Partial<Filled> | null = null;
  try { last = JSON.parse(localStorage.getItem(key(of)) ?? 'null'); } catch { /* nothing was kept */ }
  if (!last?.roles) return usual;
  const fits = (agent: Agent | undefined, fallback: Agent): Agent => ({
    model: agent?.model && found(agent.model) ? agent.model : fallback.model,
    told: typeof agent?.told === 'string' ? agent.told : null,
    without: Array.isArray(agent?.without) ? agent.without.filter(name => of.tools.some(tool => tool.name === name && !tool.needed)) : fallback.without,
  });
  return {
    chosen: Object.fromEntries(Object.entries(usual.chosen).map(([name, value]) => [name, last.chosen && name in last.chosen ? last.chosen[name] : value])),
    minutes: typeof last.minutes === 'number' ? last.minutes : usual.minutes,
    roles: Object.fromEntries(Object.entries(usual.roles).map(([name, agents]) => {
      const was = last.roles?.[name];
      if (!was) return [name, agents];
      return [name, { same: was.same !== false, count: Number(was.count) || agents.count, all: fits(was.all, agents.all),
                      each: (was.each ?? []).map(agent => fits(agent, agents.all)) }];
    })),
  };
}

/** Keeps how the form is filled in, and shows the way back if it is not the usual. */
function keep(): void {
  const usual = JSON.stringify(form) === JSON.stringify(usually(world()));
  try {
    if (usual) localStorage.removeItem(key(world()));
    else localStorage.setItem(key(world()), JSON.stringify(form));
  } catch { /* nothing is kept */ }
  $('reset').hidden = usual;
  summarize();
}

// ---------------------------------------------------------------- the screen

/** The world chosen so far: as it is with the settings chosen (what its roles are told). */
async function choose(name: string): Promise<void> {
  picked = name;
  const of = world();
  form = kept(of);
  const now = await api<WorldInfo>(`/api/worlds/${of.name}?chosen=${encodeURIComponent(JSON.stringify(form.chosen))}`);
  if (picked !== name) return;
  of.roles = now.roles;
  draw();
}

function draw(): void {
  const of = world();
  $('worldPick').replaceChildren(...worlds.map(candidate => {
    const card = el('button', `world${candidate.name === picked ? ' on' : ''}`,
      el('span', 'picture', el('img')),
      el('span', 'what', el('b', '', candidate.title), el('small', '', short(candidate))));
    const picture = card.querySelector('img')!;
    picture.src = `/assets/worlds/${candidate.name}.jpg`; picture.alt = '';
    picture.onerror = () => picture.remove();
    card.type = 'button';
    card.onclick = () => { if (candidate.name !== picked) void choose(candidate.name); };
    return card;
  }));
  // (Its card says the first sentence, and below it the rest of the first paragraph. The rest
  //  is behind "More about this world".)
  const flowing = of.about.replace(/(?<!\n)\n(?!\n)/g, ' ');   // its lines are broken for the code, not for the page
  $('worldShort').textContent = flowing.split('\n\n')[0]!.replace(/\s+/g, ' ').slice(short(of).length).trim();
  $('worldShort').hidden = !$('worldShort').textContent;
  $('worldMore').hidden = !flowing.includes('\n\n');
  $('worldMore').onclick = () => {
    $('aboutTitle').textContent = of.title;
    $('aboutText').textContent = flowing;
    ($('aboutWorld') as HTMLDialogElement).showModal();
  };
  $('worldSettings').replaceChildren(...settings(undefined));
  $('worldSettings').hidden = !$('worldSettings').children.length;
  drawAgents();
  drawEnd();
  $('moreBody').replaceChildren(...moreSettings());
  $('more').hidden = !$('moreBody').children.length;
  keep();
}

/** What a world is, in a few words: the first sentence of what is said about it. */
const short = (of: WorldInfo) => of.about.replace(/\s+/g, ' ').split(/(?<=\.) /)[0]!;

/** Opens the screen. `onStarted` is told the id of the run that was started. */
export async function openCreate(onStarted: (id: string) => void): Promise<void> {
  [worlds, minds] = await Promise.all([api<WorldInfo[]>('/api/worlds'), api<MindInfo[]>('/api/minds')]);
  await choose(worlds.some(candidate => candidate.name === picked) ? picked : worlds[0]!.name);
  $('reset').onclick = () => {
    try { localStorage.removeItem(key(world())); } catch { /* nothing was kept */ }
    void choose(picked);
  };
  ($('create') as HTMLFormElement).onsubmit = async event => {
    event.preventDefault();
    const roles = Object.fromEntries(Object.entries(world().roles).map(([name, role]) => {
      const agents = form.roles[name]!;
      const set = (agent: Agent) => ({ model: agent.model, told: agent.told ?? role.told, without: agent.without });
      return [name, agents.same ? { count: agents.count, ...set(agents.all) }
        : { count: agents.each.length, ...set(agents.each[0] ?? agents.all), each: agents.each.map(set) }];
    }));
    const answer = await api<{ id?: string; error?: string }>('/api/runs', { world: picked, chosen: form.chosen, roles, minutes: form.minutes });
    if (answer.id) onStarted(answer.id);
    else alert(answer.error ?? 'That did not start.');
  };
}
