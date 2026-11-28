// The AIs on this computer: which are there, who is logged in, and connecting more. Each can
// be installed with one button (into Tinkerlings' own folder), logged in to in the browser, or
// given an API key, which is tried at once.

import { brand, logo, MIND_BRANDS } from './brands.ts';
import { $, api, el } from './page.ts';

interface Setup {
  kind: string; title: string; about: string; site: string; local: boolean;
  installs: boolean; logs: boolean; keys: string[] | null;
  there: boolean; version?: string; account?: string;
}


let waiting: ReturnType<typeof setInterval> | null = null;
/** What is being done right now, for each AI: shown on its card instead of its buttons. */
const busy = new Map<string, string>();
const troubles = new Map<string, string>();

export function openConnections(): void {
  void draw();
}

async function draw(): Promise<void> {
  const all = await api<Setup[]>('/api/setup');
  const [ready, rest] = [all.filter(setup => setup.there && (setup.account || setup.keys?.length)), all.filter(setup => !(setup.there && (setup.account || setup.keys?.length)))];
  $('aisList').replaceChildren(
    ...(ready.length ? [el('h3', '', 'Connected'), el('div', 'ais', ...ready.map(card))] : []),
    el('h3', '', ready.length ? 'More you can connect' : 'Connect one of these'), el('div', 'ais', ...rest.map(card)));
}

/** Does something on the server for one AI, showing what is going on meanwhile. */
async function doing(kind: string, what: string, action: string, body: object = {}): Promise<Record<string, any>> {
  busy.set(kind, what);
  troubles.delete(kind);
  await draw();
  const done = await api<Record<string, any>>(`/api/setup/${kind}/${action}`, body).catch(() => ({ error: 'Tinkerlings did not answer.' }));
  busy.delete(kind);
  if (done.error) troubles.set(kind, done.error);
  await draw();
  return done;
}

function button(text: string, onclick: () => void, main = false): HTMLButtonElement {
  const made = el('button', main ? 'main' : '', text);
  made.type = 'button';
  made.onclick = onclick;
  return made;
}

function card(setup: Setup): HTMLElement {
  const ready = setup.there && (!!setup.account || !!setup.keys?.length);
  const state = setup.local ? (setup.there ? 'Running' : 'Not running')
    : !setup.there ? 'Not installed' : ready ? 'Ready' : setup.keys ? 'No key yet' : 'Not logged in';
  const doing = busy.get(setup.kind), trouble = troubles.get(setup.kind);
  const body = el('div', 'body',
    el('div', 'head', el('b', '', setup.title), el('span', `state${ready || (setup.local && setup.there) ? ' good' : ''}`, state)),
    el('p', '', setup.about),
    setup.account && el('p', 'account', setup.account),
    trouble && el('p', 'trouble', trouble));
  if (doing) body.append(el('p', 'doing', el('span', 'spinner'), doing));
  else body.append(actions(setup));
  const made = el('div', `ai${ready ? ' ready' : ''}`, logo(MIND_BRANDS[setup.kind] ?? setup.kind, setup.title, 44), body);
  made.dataset.kind = setup.kind;
  return made;
}

function actions(setup: Setup): HTMLElement {
  const row = el('div', 'actions');
  const site = el('a', 'link', setup.local ? `Get ${setup.title}` : 'Its website');
  site.href = setup.site; site.target = '_blank'; site.rel = 'noreferrer';
  if (setup.local) {
    if (!setup.there) row.append(el('p', 'hint', `Install it, start it, and download a model in it. Then it shows up here by itself.`), site);
    return row;
  }
  if (!setup.there) {
    if (setup.installs) row.append(button(`Install ${setup.title}`, () => void doing(setup.kind, `Installing ${setup.title}. This takes a minute or two…`, 'install'), true));
    row.append(site);
    return row;
  }
  if (setup.logs) {
    if (setup.account) row.append(button('Log out', () => void doing(setup.kind, 'Logging out…', 'logout')));
    else row.append(button(setup.kind === 'codex' ? 'Log in with ChatGPT' : setup.kind === 'claude' ? 'Log in with Claude' : 'Log in', () => void login(setup), true));
  }
  if (setup.keys) row.append(keys(setup));
  return row;
}

/** Logs in in the browser, and asks again and again until the login shows. */
async function login(setup: Setup): Promise<void> {
  // (Opened at once, while the click still counts: the browser would block it later.)
  const tab = window.open('about:blank', '_blank');
  const done = await doing(setup.kind, 'Starting the login…', 'login');
  if (done.error) return void tab?.close();
  if (done.url && tab) tab.location.href = done.url;
  else tab?.close();
  busy.set(setup.kind, 'Log in in the browser tab that opened. This page notices by itself.');
  await draw();
  if (done.url) {
    const link = el('a', 'link', 'Open the login page again');
    link.href = done.url; link.target = '_blank'; link.rel = 'noreferrer';
    document.querySelector(`#aisList [data-kind="${setup.kind}"]`)?.append(link);
  }
  if (waiting) clearInterval(waiting);
  const since = Date.now();
  waiting = setInterval(async () => {
    const now = (await api<Setup[]>('/api/setup')).find(found => found.kind === setup.kind);
    if (now?.account || Date.now() - since > 10 * 60_000) {
      clearInterval(waiting!);
      waiting = null;
      busy.delete(setup.kind);
      if (!now?.account) troubles.set(setup.kind, 'The login did not finish. Try again.');
      await draw();
    }
  }, 2000);
}

/** The API keys of an AI that takes them: the ones kept, and a form for one more. */
function keys(setup: Setup): HTMLElement {
  const box = el('div', 'keys');
  for (const provider of setup.keys ?? []) {
    box.append(el('div', 'key', logo(provider, provider, 24), el('span', '', brand(provider, provider).title),
      button('Forget', () => void doing(setup.kind, `Forgetting the key for ${provider}…`, 'forget', { provider }))));
  }
  const provider = el('select', '', el('option', '', 'Choose a provider'));
  provider.id = `setup-${setup.kind}-provider`;
  void api<string[]>(`/api/setup/${setup.kind}/providers`).then(names => {
    for (const name of names.filter(name => !setup.keys?.includes(name))) {
      const known = brand(name, name).title;
      const option = el('option', '', known === name ? name : `${known} (${name})`);
      option.value = name;
      provider.append(option);
    }
  });
  const key = el('input');
  key.type = 'password'; key.placeholder = 'Paste the API key'; key.autocomplete = 'off'; key.id = `setup-${setup.kind}-key`;
  const keep = button('Keep and try it', () => {
    if (!provider.value || provider.selectedIndex === 0 || !key.value.trim()) return;
    void doing(setup.kind, `Trying the key with one short question to ${provider.value}…`, 'key', { provider: provider.value, key: key.value });
  }, true);
  box.append(el('div', 'add', provider, key, keep),
    el('p', 'hint', `The key stays on this computer, in Tinkerlings' own folder, readable only by you. Tinkerlings hands it to ${setup.title} and nowhere else. A key that does not work is forgotten again.`));
  return box;
}
