// How every world is drawn in the viewer: in 3D, with three.js. A world needs no drawing of
// its own: its blocks are drawn in the colours of their kinds (from the world's KINDS), the
// agents as robots (see _agents.js), notes as flat yellow sheets.
//
// One unit is one block. World x runs east, world y runs north, height runs up. A block at
// level z fills the space from z to z + 1; the ground is blocks in the levels below 0.
//
// What the viewer gets for each step: the agents and notes after it, and the blocks only
// where they change (see story.py): all of them where an agent wakes up ("blocks"), and
// what an action changed ("changes"). The world at a step is put together from those.
//
// What this file gives the viewer: create(box) -> { show(story, step, index, fresh),
// facts(step), notes(step), fit(), snapshot(), remove() }.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { crowd } from './_agents.js';

const FLIGHT = 700;   // milliseconds a thrown thing is in the air
const SHEET = 0.07;   // how thick a note is drawn
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const COLORS = dark ? { sky: 0x10161b, water: 0x1d4257, note: 0xf3df8a } : { sky: 0xdbe9f0, water: 0x7fb4cc, note: 0xf2d34f };

export const hint = 'Drag to turn · scroll to zoom';

// The blocks of the world at a step: from the last step with all blocks, with every change after it.
// Going forward one step at a time only applies that step's changes. In a live run a step first
// comes "in progress", without its changes, and is replaced when it is done: blocks worked out
// from the unfinished step are not built on (known.step is the very step they came from).
function blocksAt(story, index, known) {
  if (known && known.story === story.id && known.step === story.steps[index]) return known;
  if (known && known.story === story.id && known.index === index - 1 && known.step === story.steps[index - 1]) {
    apply(known.blocks, story.steps[index]);
    known.index = index;
    known.step = story.steps[index];
    return known;
  }
  let from = index;
  while (from > 0 && !story.steps[from].blocks) from--;
  const blocks = new Map();
  for (let i = from; i <= index; i++) apply(blocks, story.steps[i]);
  return { story: story.id, index, step: story.steps[index], blocks };
}

function apply(blocks, step) {
  if (!step) return;
  if (step.blocks) { blocks.clear(); for (const [x, y, z, kind] of step.blocks) blocks.set(`${x},${y},${z}`, kind); }
  for (const [x, y, z, kind] of step.changes || []) {
    if (kind) blocks.set(`${x},${y},${z}`, kind); else blocks.delete(`${x},${y},${z}`);
  }
}

export function create(box) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  // The picture is only drawn while something moves: drawing it 60 times a second all the
  // time kept the whole computer busy. Anything that changes it calls wake(), which starts
  // drawing for a moment; when nothing moves any more, drawing stops (see frame).
  let awake = 0, drawing = false;
  const wake = () => {
    awake = performance.now() + 1500;   // long enough for a throw and a glide
    if (!drawing) { drawing = true; renderer.setAnimationLoop(frame); }
  };
  controls.addEventListener('change', wake);   // turning or zooming
  controls.maxPolarAngle = Math.PI / 2 - 0.05;   // never look from below the ground
  scene.background = new THREE.Color(COLORS.sky);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-10, 24, 14);
  scene.add(sun);
  box.append(renderer.domElement);

  const cube = new THREE.BoxGeometry(1, 1, 1);
  const looks = { note: new THREE.MeshLambertMaterial({ color: COLORS.note }) };
  let kinds = {};   // kind -> { colour }: from the world's setup
  const lookOf = kind => looks[kind] ||= new THREE.MeshLambertMaterial({ color: kinds[kind]?.colour || '#8a919c' });
  // A thing in a hand or in the air: {block: kind} or {note: text}.
  const isNote = thing => !!thing?.note || thing === 'note';
  const shape = (mesh, thing) => {   // make a mesh look like the thing it stands for
    mesh.material = isNote(thing) ? looks.note : lookOf(thing?.block || thing);
    mesh.scale.set(isNote(thing) ? 0.8 : 0.94, isNote(thing) ? SHEET : 0.94, isNote(thing) ? 0.8 : 0.94);
  };

  const water = new THREE.Mesh(cube, new THREE.MeshLambertMaterial({ color: COLORS.water }));
  const blocks = new THREE.Group();    // one many-times-drawn mesh per kind (the ground has a thousand blocks)
  const notes = new THREE.Group();
  const notePool = [];                 // the meshes of notes, used again from step to step
  const agents = crowd(scene, cube, (mesh, thing) => shape(mesh, thing), camera, box);   // see _agents.js
  const north = letter('N');
  // A thrown thing in the air. When it lands it stays put and stands in for the thing that landed.
  const flying = new THREE.Mesh(cube);
  flying.visible = false;
  let flight = null;       // { points, lost, start } while a throw is shown
  let shown = -1;          // the step drawn last, to tell a step forward from a jump elsewhere
  let shownFlew = false;   // whether that step already had its flight path when drawn
  let builtFor = null, known = null, middle = { x: 0, y: 0 };
  scene.add(water, blocks, notes, north, flying);

  function letter(text) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const pen = canvas.getContext('2d');
    pen.font = 'bold 96px system-ui'; pen.textAlign = 'center'; pen.textBaseline = 'middle';
    pen.fillStyle = '#fff'; pen.fillText(text, 64, 68);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.scale.setScalar(2);
    return sprite;
  }

  // Where the middle of a cell is, at a height. The picture is centred on the world.
  const place = (x, y, up) => new THREE.Vector3(x + 0.5 - middle.x, up, -(y + 0.5 - middle.y));

  // Once per run: the kinds' colours, and the camera placed so the whole world is in sight.
  function build(story, map) {
    kinds = story.setup?.kinds || {};
    for (const key of Object.keys(looks)) if (key !== 'note') { looks[key].dispose(); delete looks[key]; }
    let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const key of map.keys()) {
      const [x, y] = key.split(',').map(Number);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (minX === Infinity) [minX, maxX, minY, maxY] = [-5, 5, -5, 5];
    middle = { x: (minX + maxX + 1) / 2, y: (minY + maxY + 1) / 2 };
    const width = Math.max(maxX - minX, maxY - minY) + 1;
    water.scale.set(width * 12, 0.2, width * 12); water.position.y = -1.1;   // just under the ground's top
    north.position.copy(place(middle.x - 0.5, maxY + 2, 1));
    const back = Math.max(1, 1.5 / camera.aspect);   // further away in a narrow box, so everything fits
    camera.position.set(0, width * 0.62 * back, width * 0.78 * back);   // from the south, looking north
    controls.target.set(0, 0, 0);
  }

  // The blocks: one many-times-drawn mesh per kind. (Drawn again for every step: even a
  // thousand blocks take only a moment.) hide: where a thrown block comes to rest, while it
  // is still in the air.
  function drawBlocks(map, hide) {
    for (const mesh of blocks.children) mesh.dispose();
    blocks.clear();
    const byKind = {};
    for (const [where, kind] of map) if (where !== hide) (byKind[kind] ||= []).push(where.split(',').map(Number));
    const matrix = new THREE.Matrix4(), turn = new THREE.Quaternion(), whole = new THREE.Vector3(1, 1, 1),
          apart = new THREE.Vector3(0.94, 0.94, 0.94);   // the ground without gaps, other blocks with a small one
    for (const [kind, places] of Object.entries(byKind)) {
      const mesh = new THREE.InstancedMesh(cube, lookOf(kind), places.length);
      places.forEach(([x, y, z], i) => mesh.setMatrixAt(i, matrix.compose(place(x, y, z + 0.5), turn, z < 0 ? whole : apart)));
      blocks.add(mesh);
    }
  }

  function show(story, step, index, fresh) {
    wake();
    const state = step.state || {};
    // (A picture of a world that has just started has no steps: it brings all its blocks along.)
    known = story.steps ? blocksAt(story, index, known)
      : { blocks: new Map((step.blocks || []).map(([x, y, z, kind]) => [`${x},${y},${z}`, kind])) };
    const map = known.blocks;
    if (builtFor !== story.id) { build(story, map); builtFor = story.id; }

    // A throw is played when stepping forward onto it, not when jumping around in the run.
    const again = index === shown && flight && !fresh;   // redrawn while it is already playing
    // In a live run a throw first shows as "in progress" and gets its path a moment later.
    const justLanded = index === shown && !shownFlew;
    const play = step.flight && !fresh && (index === shown + 1 || again || justLanded);
    shown = index;
    shownFlew = !!step.flight;
    if (!again) {
      flight = play && { points: step.flight.path.map(([x, y, up]) => place(x - 0.5, y - 0.5, up)),
                         lost: step.flight.lost || step.flight.caught, start: performance.now() };
      flying.visible = false;
      if (flight) shape(flying, step.flight.what === 'note' ? 'note' : { block: step.flight.kind });
    }
    // Where the flying thing comes to rest: that one is not drawn until it has landed.
    const rest = flight && !flight.lost && step.flight.path.at(-1);
    const hide = rest && !isNote(step.flight.what)
      ? `${Math.floor(rest[0])},${Math.floor(rest[1])},${Math.floor(rest[2])}` : null;
    drawBlocks(map, hide);

    let used = 0;
    const lying = {};   // how many notes already lie at a spot, so they pile up visibly
    for (const [x, y, z] of state.notes || []) {
      const n = lying[[x, y, z]] = (lying[[x, y, z]] || 0) + 1;
      if (!notePool[used]) { notePool[used] = new THREE.Mesh(cube); notes.add(notePool[used]); }
      const mesh = notePool[used++];
      mesh.visible = true;
      shape(mesh, 'note');
      mesh.position.copy(place(x, y, z + SHEET * (n - 0.4)));
    }
    for (let i = used; i < notePool.length; i++) notePool[i].visible = false;
    agents.show(state.agents || [], place, fresh);
    if (story.steps) agents.speak(story.steps, index);   // what they say and think, in bubbles
  }

  const facts = ({ state }) => (state?.agents || []).filter(a => a.carrying && !a.dead).map(a =>
    `${state.agents.length > 1 ? `agent in place ${a.id}: ` : ''}carrying a ${a.carrying.note ? 'note' : `${a.carrying.block} block`}`);

  // Every note in the world at this step: where it is, and what it says.
  function notesAt({ state }) {
    const found = (state?.agents || []).filter(a => a.carrying?.note)
      .map(a => ({ where: 'In an agent’s hand', text: a.carrying.note }));
    const top = (x, y) => Math.max(0, ...[...(known?.blocks.keys() || [])]
      .map(k => k.split(',').map(Number)).filter(([bx, by]) => bx === x && by === y).map(([, , z]) => z + 1));
    for (const [x, y, z, text] of state?.notes || [])
      found.push({ where: `At (${x}, ${y})` + (z < top(x, y) ? ', under a block' : ''), text });
    return found;
  }

  // The drawing always fills its box, whatever size the window gives it.
  function fit() {
    if (!box.clientWidth || !box.clientHeight) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(box.clientWidth, box.clientHeight);
    camera.aspect = box.clientWidth / box.clientHeight;
    camera.updateProjectionMatrix();
    agents.resize(box.clientWidth, box.clientHeight);
    wake();
  }
  const resizing = new ResizeObserver(fit);
  resizing.observe(box);

  // The picture as it is now, as an image (for the cards of the new-world screen).
  function snapshot() {
    controls.update();
    agents.glide();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  function frame() {
    if (performance.now() > awake && !agents.busy()) {   // nothing moves: stop drawing until woken
      drawing = false;
      renderer.setAnimationLoop(null);
      return;
    }
    controls.update();   // points the camera at its target, also after the world placed it
    agents.glide();
    if (flight) {   // move the thrown thing along its recorded path
      const last = flight.points.length - 1;
      const along = Math.min((performance.now() - flight.start) / FLIGHT, 1) * last;
      const i = Math.min(Math.floor(along), last - 1);
      flying.position.lerpVectors(flight.points[i], flight.points[i + 1], along - i);
      flying.visible = !(flight.lost && along >= last);   // one that fell into the water disappears
      if (along >= last && !flight.lost) { flight = null; flying.visible = false; drawBlocks(known.blocks, null); }
    }
    renderer.render(scene, camera);
    agents.render();   // the bubbles over the picture
  }

  function remove() {
    renderer.setAnimationLoop(null);
    resizing.disconnect();
    controls.dispose();
    for (const mesh of blocks.children) mesh.dispose();
    renderer.dispose();
    renderer.forceContextLoss();   // give the browser its drawing context back at once
    renderer.domElement.remove();
    agents.remove();
  }

  return { show, facts, notes: notesAt, remove, fit, snapshot };
}
