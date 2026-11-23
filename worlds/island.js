// How the island is drawn in the viewer: in 3D, with three.js.
//
// The viewer loads the file named after a run's world and calls create(box). What comes
// back has three things:
//   show(story, step, index, fresh)  draw one step (fresh: this run is on screen for the first time)
//   facts(step)                      short labels about the step, shown on top of the drawing
//   notes(step)                      optional: the texts lying around in the world, for the notes panel
//   remove()                         clean up when another world takes over
//
// One unit is one block. World x runs east, world y runs south, height runs up.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { crowd } from './_agents.js';

const FLIGHT = 700;   // milliseconds a thrown block is in the air
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const COLORS = dark
  ? { sky: 0x10161b, water: 0x1d4257, land: 0x4d7c4a, block: 0xaab2bd, note: 0xf3df8a, agent: 0xff6b4a }
  : { sky: 0xdbe9f0, water: 0x7fb4cc, land: 0x93c47d, block: 0x8a919c, note: 0xf2d34f, agent: 0xd9482b };

export const hint = 'Drag to turn · scroll to zoom';

export function create(box) {
  const solid = name => new THREE.MeshLambertMaterial({ color: COLORS[name] });

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  // The picture is only drawn while something moves: drawing it 60 times a second all the
  // time kept the whole computer busy. Anything that changes it calls wake().
  let awake = 0;
  const wake = () => { awake = performance.now() + 1500; };   // long enough for a throw and a glide
  controls.addEventListener('change', wake);
  controls.maxPolarAngle = Math.PI / 2 - 0.05;   // never look from below the ground
  scene.background = new THREE.Color(COLORS.sky);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-10, 24, 14);
  scene.add(sun);
  box.append(renderer.domElement);

  const cube = new THREE.BoxGeometry(1, 1, 1);
  // A thing is a block, one high, or a note: a flat yellow sheet that adds no height.
  const SHEET = 0.07;   // how thick a note is drawn
  const shape = (mesh, thing) => {   // make a mesh look like the thing it stands for
    mesh.material = lookOf(thing);
    mesh.scale.set(thing === 'block' ? 0.94 : 0.8, thing === 'block' ? 0.94 : SHEET, thing === 'block' ? 0.94 : 0.8);
  };
  const looks = { block: solid('block'), note: solid('note') };
  const lookOf = thing => looks[thing === 'block' ? 'block' : 'note'];
  // Runs from before notes were things recorded only how many blocks each stack had.
  const stacksOf = state => state.stacks || state.blocks.map(([x, y, n]) => [x, y, Array(n).fill('block')]);

  const water = new THREE.Mesh(cube, solid('water'));
  const land = new THREE.Mesh(cube, solid('land'));
  const blocks = new THREE.Group();
  const agents = crowd(scene, cube, (mesh, thing) => shape(mesh, thing), camera, box);   // the agents: see _agents.js
  const north = letter('N');
  // A thrown block in the air. When it lands it stays put and stands in for the top block there.
  const flying = new THREE.Mesh(cube, looks.block);
  flying.scale.setScalar(0.94);
  flying.visible = false;
  let flight = null;       // { points, lost, start } while a throw is shown
  let shown = -1;          // the step drawn last, to tell a step forward from a jump elsewhere
  let shownFlew = false;   // whether that step already had its flight path when drawn
  let grid = null, builtFor = null;
  scene.add(water, land, blocks, north, flying);

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

  // The parts that depend only on the island's size: built once per run.
  function buildIsland(size) {
    water.scale.set(size * 12, 0.2, size * 12); water.position.y = -0.5;
    land.scale.set(size, 0.4, size); land.position.y = -0.2;
    if (grid) scene.remove(grid);
    grid = new THREE.GridHelper(size, size, 0x000000, 0x000000);
    grid.material.transparent = true; grid.material.opacity = 0.12; grid.position.y = 0.005;
    scene.add(grid);
    north.position.set(0, 1, -size / 2 - 1.5);
    const back = Math.max(1, 1.5 / camera.aspect);      // further away in a narrow box, so the island fits
    camera.position.set(0, size * 0.85 * back, size * 1.15 * back);   // from the south, looking north
    controls.target.set(0, 0, 0);
  }

  function show(story, step, index, fresh) {
    wake();
    const { size, north: northIs } = story.setup, state = step.state;
    if (builtFor !== story.id) { buildIsland(size); builtFor = story.id; }
    // Where the middle of a cell is. Older runs counted y from the south.
    const place = (x, y, up) =>
      new THREE.Vector3(x - size / 2 + 0.5, up, (northIs > 0 ? size - 1 - y : y) - size / 2 + 0.5);

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
      if (flight) shape(flying, step.flight.what === 'note' ? 'note' : 'block');
    }
    const rest = flight && !flight.lost && step.flight.path.at(-1);   // where the flying block comes to rest

    blocks.clear();
    let under = 0;   // how high the stack is that the agent stands on
    for (const [x, y, things] of stacksOf(state)) {
      const flyingIn = rest && Math.floor(rest[0]) === x && Math.floor(rest[1]) === y;   // its top thing is still in the air
      let level = 0, sheets = 0;   // blocks below this thing, and notes lying directly on top of each other
      for (const thing of flyingIn ? things.slice(0, -1) : things) {
        const mesh = new THREE.Mesh(cube);
        shape(mesh, thing);   // blocks keep a small gap, so single blocks in a stack stay visible
        if (thing === 'block') { mesh.position.copy(place(x, y, level + 0.5)); level++; sheets = 0; }
        else mesh.position.copy(place(x, y, level + SHEET * (sheets++ + 0.6)));
        blocks.add(mesh);
      }
      if (x === state.pos[0] && y === state.pos[1]) under = things.filter(thing => thing === 'block').length;
    }
    // Runs from before several agents could live side by side recorded only the one.
    agents.show(state.agents || [{ id: 1, pos: state.pos, height: under, carrying: state.carrying, dead: state.dead, view: state.view }],
                place, fresh);
    if (story.steps) agents.speak(story.steps, index);   // what they say and think, in bubbles
  }

  const facts = ({ state }) => [state.carrying && (state.carrying.note ? 'carrying a note' : 'carrying a block')];

  // Every note in the world at this step: where it is, and what it says.
  function notes({ state }) {
    const found = state.carrying?.note ? [{ where: 'In the agent’s hand', text: state.carrying.note }] : [];
    for (const [x, y, things] of stacksOf(state)) {
      things.forEach((thing, i) => {
        if (thing === 'block') return;
        const above = things.length - 1 - i;   // what lies on top of it hides it from the agent
        found.push({ where: `At (${x}, ${y})` + (above ? `, under ${above} other thing${above > 1 ? 's' : ''}` : ''), text: thing.note });
      });
    }
    return found;
  }

  // The drawing always fills its box, whatever size the window gives it.
  const resizing = new ResizeObserver(() => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(box.clientWidth, box.clientHeight);
    camera.aspect = box.clientWidth / box.clientHeight;
    camera.updateProjectionMatrix();
    wake();
  });
  resizing.observe(box);

  renderer.setAnimationLoop(() => {
    controls.update();   // turning or zooming wakes the picture up
    if (performance.now() > awake && !agents.busy()) return;
    agents.glide();
    if (flight) {                         // move the thrown block along its recorded path
      const last = flight.points.length - 1;
      const along = Math.min((performance.now() - flight.start) / FLIGHT, 1) * last;
      const i = Math.min(Math.floor(along), last - 1);
      flying.position.lerpVectors(flight.points[i], flight.points[i + 1], along - i);
      flying.visible = !(flight.lost && along >= last);   // one that fell into the water disappears
    }
    renderer.render(scene, camera);
  });

  function remove() {
    renderer.setAnimationLoop(null);
    resizing.disconnect();
    renderer.dispose();
    renderer.domElement.remove();
    agents.remove();
  }

  return { show, facts, notes, remove };
}
