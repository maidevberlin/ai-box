// The agents as every world draws them: a body, a head, the thing carried above the head,
// and a lighter patch on the ground for what the agent sees.
// (Not a world's drawing itself: its name starts with "_".)
//
// Several agents can live in a world at the same time, each in its own place (1, 2, ...).
// A place has its own colour, the same one as in the conversation next to the picture.
import * as THREE from 'three';

export const PLACE_COLOURS = [0xe8553a, 0x8b5cf6, 0x14b8a6, 0xf59e0b];

// crowd(scene, cube, dress): dress(mesh, thing) makes the carried mesh look like the thing.
export function crowd(scene, cube, dress) {
  const figures = {};   // place -> { group, carried, sight, target }

  function figure(id) {
    const look = new THREE.MeshLambertMaterial({ color: PLACE_COLOURS[(id - 1) % PLACE_COLOURS.length] });
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.1, 20), look);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 14), look);
    const carried = new THREE.Mesh(cube);
    body.position.y = 0.55; head.position.y = 1.38; carried.position.y = 2.05;
    group.add(body, head, carried);
    const sight = new THREE.Mesh(cube, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14 }));
    scene.add(group, sight);
    return { group, carried, sight, target: new THREE.Vector3(), isNew: true };
  }

  // agents: [{ id, pos, height, carrying, dead, view }]. place(x, y, up) is the world's own.
  function show(agents, place, fresh) {
    for (const id in figures) if (!agents.some(a => a.id === +id)) figures[id].group.visible = figures[id].sight.visible = false;
    for (const a of agents) {
      const f = figures[a.id] ||= figure(a.id);
      f.target = place(...a.pos, a.height);
      if (fresh || f.isNew) f.group.position.copy(f.target);
      f.isNew = false;
      f.group.visible = f.sight.visible = !a.dead;   // drowned: gone until a new agent wakes up
      f.carried.visible = !!a.carrying;
      if (a.carrying) { dress(f.carried, a.carrying); f.carried.scale.multiplyScalar(0.64); }
      const reach = a.view * 2 + 1 + (a.id - 1) * 0.04;   // wider when the agent stands higher
      f.sight.scale.set(reach, 0.02, reach);
      f.sight.position.copy(place(...a.pos, 0.01 + a.id * 0.002));
    }
  }

  // Each figure glides to its new place instead of jumping there.
  const glide = () => { for (const f of Object.values(figures)) f.group.position.lerp(f.target, 0.18); };

  return { show, glide };
}
