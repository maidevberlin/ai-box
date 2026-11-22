// How the magic island is drawn in the viewer: in 3D, with three.js.
// (What a drawing file has to provide is described at the top of island.js.)
//
// One unit is one block. World x runs east, world y runs north, height runs up.
// Here every block has its own place (cell and level), because blocks can hang in the air
// or float in the water.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const FLIGHT = 700;   // milliseconds a thrown thing is in the air
const SHEET = 0.07;   // how thick a note is drawn
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const COLORS = dark
  ? { sky: 0x10161b, water: 0x1d4257, land: 0x4d7c4a, agent: 0xff6b4a, note: 0xf3df8a,
      grey: 0xaab2bd, green: 0x57d977, blue: 0x5aa2ff, gold: 0xf5c542 }
  : { sky: 0xdbe9f0, water: 0x7fb4cc, land: 0x93c47d, agent: 0xd9482b, note: 0xf2d34f,
      grey: 0x8a919c, green: 0x2fb457, blue: 0x2f7fe6, gold: 0xe0a800 };

export const hint = 'Drag to turn · scroll to zoom';

export function create(box) {
  const solid = name => new THREE.MeshLambertMaterial({ color: COLORS[name] });

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI / 2 - 0.05;   // never look from below the ground
  scene.background = new THREE.Color(COLORS.sky);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-10, 24, 14);
  scene.add(sun);
  box.append(renderer.domElement);

  const cube = new THREE.BoxGeometry(1, 1, 1);
  const looks = Object.fromEntries(['grey', 'green', 'blue', 'gold', 'note', 'agent'].map(name => [name, solid(name)]));
  // A thing in the hand or in the air: {block: colour} or {note: text}, or the name the world gave it.
  const lookOf = thing => looks[thing?.block || (typeof thing === 'string' && thing.split(' ')[0]) || 'note'] || looks.note;
  const isNote = thing => !!thing?.note || thing === 'note';
  const shape = (mesh, thing) => {   // make a mesh look like the thing it stands for
    mesh.material = lookOf(thing);
    mesh.scale.set(isNote(thing) ? 0.8 : 0.94, isNote(thing) ? SHEET : 0.94, isNote(thing) ? 0.8 : 0.94);
  };

  const water = new THREE.Mesh(cube, solid('water'));
  const things = new THREE.Group();   // blocks and notes
  // What the agent can see: a lighter patch on the ground around it.
  const sight = new THREE.Mesh(cube, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14 }));
  // The agent: a body, a head, and the thing it carries above its head.
  const agent = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.1, 20), looks.agent);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 14), looks.agent);
  const carried = new THREE.Mesh(cube, looks.grey);
  body.position.y = 0.55; head.position.y = 1.38; carried.position.y = 2.05;
  agent.add(body, head, carried);
  const north = letter('N');
  // A thrown thing in the air. When it lands it stays put and stands in for the thing that landed.
  const flying = new THREE.Mesh(cube, looks.grey);
  flying.visible = false;
  let flight = null;       // { points, lost, start } while a throw is shown
  let shown = -1;          // the step drawn last, to tell a step forward from a jump elsewhere
  let shownFlew = false;   // whether that step already had its flight path when drawn
  let land = null, target = new THREE.Vector3(), builtFor = null, middle = 0;
  scene.add(water, things, sight, agent, north, flying);

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

  // Where the middle of a cell is, at a height. The picture is centred between the two lands.
  const place = (x, y, up) => new THREE.Vector3(x + 0.5 - middle, up, -(y + 0.5));

  // The ground: one tile per cell of land. It depends only on the world's setup, so it is built once per run.
  function buildLand({ radius, far: [farX, farY, farRadius] }) {
    middle = (farX + farRadius - radius) / 2;   // halfway between the west and the east end
    const onLand = (x, y) => x * x + y * y <= (radius + 0.5) ** 2
      || (x - farX) ** 2 + (y - farY) ** 2 <= (farRadius + 0.5) ** 2;
    const cells = [];
    for (let x = -radius; x <= farX + farRadius; x++)
      for (let y = -radius; y <= radius; y++) if (onLand(x, y)) cells.push([x, y]);
    if (land) scene.remove(land);
    land = new THREE.InstancedMesh(cube, solid('land'), cells.length);
    cells.forEach(([x, y], i) => {
      const at = place(x, y, -0.2);
      land.setMatrixAt(i, new THREE.Matrix4().compose(at, new THREE.Quaternion(), new THREE.Vector3(0.97, 0.4, 0.97)));
    });
    scene.add(land);
    const width = farX + farRadius + radius + 1;
    water.scale.set(width * 12, 0.2, width * 12); water.position.y = -0.4;
    north.position.copy(place(0, radius + 2, 1));
    const back = Math.max(1, 1.5 / camera.aspect);      // further away in a narrow box, so everything fits
    camera.position.set(0, width * 0.62 * back, width * 0.78 * back);   // from the south, looking north
    controls.target.set(0, 0, 0);
  }

  function show(story, step, index, fresh) {
    const state = step.state;
    if (builtFor !== story.id) { buildLand(story.setup); builtFor = story.id; }

    // A throw is played when stepping forward onto it, not when jumping around in the run.
    const again = index === shown && flight && !fresh;   // redrawn while it is already playing
    // In a live run a throw first shows as "in progress" and gets its path a moment later.
    const justLanded = index === shown && !shownFlew;
    const play = step.flight && !fresh && (index === shown + 1 || again || justLanded);
    shown = index;
    shownFlew = !!step.flight;
    if (!again) {
      flight = play && { points: step.flight.path.map(([x, y, up]) => place(x - 0.5, y - 0.5, up)),
                         lost: step.flight.lost, start: performance.now() };
      flying.visible = false;
      if (flight) shape(flying, step.flight.what);
    }
    // Where the flying thing comes to rest: that one is not drawn until it has landed.
    const rest = flight && !flight.lost && step.flight.path.at(-1);
    const landing = (x, y, up) => rest && Math.floor(rest[0]) === x && Math.floor(rest[1]) === y && Math.abs(rest[2] - up) < 0.6;

    things.clear();
    for (const [x, y, z, colour] of state.blocks) {
      if (landing(x, y, z + 0.5) && !isNote(step.flight.what)) continue;
      const mesh = new THREE.Mesh(cube);
      shape(mesh, { block: colour });   // a small gap between blocks, so each one stays visible
      mesh.position.copy(place(x, y, z + 0.5));
      things.add(mesh);
    }
    const lying = {};   // how many notes already lie at a spot, so they pile up visibly
    state.notes.forEach(([x, y, level], i) => {
      if (i === state.notes.length - 1 && landing(x, y, level) && isNote(step.flight.what)) return;
      const n = lying[[x, y, level]] = (lying[[x, y, level]] || 0) + 1;
      const mesh = new THREE.Mesh(cube);
      shape(mesh, 'note');
      mesh.position.copy(place(x, y, level + SHEET * (n - 0.4)));
      things.add(mesh);
    });
    target = place(...state.pos, state.height);
    if (fresh) agent.position.copy(target);
    agent.visible = !state.dead;   // drowned: gone until a new agent wakes up
    carried.visible = !!state.carrying;
    if (state.carrying) { shape(carried, state.carrying); carried.scale.multiplyScalar(0.64); }
    const reach = state.view * 2 + 1;   // wider when the agent stands higher
    sight.scale.set(reach, 0.02, reach);
    sight.position.copy(place(...state.pos, 0.01));
  }

  const facts = ({ state }) => [state.carrying && (state.carrying.note ? 'carrying a note' : `carrying a ${state.carrying.block} block`)];

  // Every note in the world at this step: where it is, and what it says.
  function notes({ state }) {
    const found = state.carrying?.note ? [{ where: 'In the agent’s hand', text: state.carrying.note }] : [];
    const height = (x, y) => Math.max(0, ...state.blocks.filter(b => b[0] === x && b[1] === y).map(b => b[2] + 1));
    for (const [x, y, level, text] of state.notes)
      found.push({ where: `At (${x}, ${y})` + (level < height(x, y) ? ', under a block' : ''), text });
    return found;
  }

  // The drawing always fills its box, whatever size the window gives it.
  const resizing = new ResizeObserver(() => {
    renderer.setPixelRatio(devicePixelRatio);
    renderer.setSize(box.clientWidth, box.clientHeight);
    camera.aspect = box.clientWidth / box.clientHeight;
    camera.updateProjectionMatrix();
  });
  resizing.observe(box);

  renderer.setAnimationLoop(() => {
    agent.position.lerp(target, 0.18);   // glide to the new place instead of jumping there
    if (flight) {                         // move the thrown thing along its recorded path
      const last = flight.points.length - 1;
      const along = Math.min((performance.now() - flight.start) / FLIGHT, 1) * last;
      const i = Math.min(Math.floor(along), last - 1);
      flying.position.lerpVectors(flight.points[i], flight.points[i + 1], along - i);
      flying.visible = !(flight.lost && along >= last);   // one that fell into the water disappears
    }
    controls.update();
    renderer.render(scene, camera);
  });

  function remove() {
    renderer.setAnimationLoop(null);
    resizing.disconnect();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { show, facts, notes, remove };
}
