import { createProp, placeOnProp } from "../planner/project.ts";
import { propAabb, surfaceY } from "../planner/props.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { Mannequin } from "./mannequin.ts";
import {
  BODY_SURFACES,
  MANNEQUIN_REVISION,
  lowestBodyY,
  placeBodyOnFloor,
} from "../planner/body.ts";
import {
  uid,
  applyPreset,
  createCharacter,
  createProject,
  projectFromJson,
  projectToJson,
  toSceneCharacter,
  toSceneProp,
} from "../planner/project.ts";
import { JOINTS, worldJoints, type PresetId } from "../planner/skeleton.ts";
import { GROUP_PRESETS, applyGroupPreset } from "../planner/group-presets.ts";
import { generatePrompt } from "../planner/prompt.ts";
const presets: PresetId[] = [
  "stand",
  "sit",
  "kneel",
  "lean",
  "lie-up",
  "lie-down",
  "lie-left",
  "lie-right",
];
function meshMinimum(model: Mannequin) {
  model.root.updateMatrixWorld(true);
  let min = Infinity;
  const point = new THREE.Vector3();
  model.root.traverse((object) => {
    if (object instanceof THREE.Mesh && !object.name.startsWith("marker-")) {
      const positions = object.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        min = Math.min(min, point.y);
      }
    }
  });
  return min;
}
test("sculpted renderer matches saved rig under every pose and nonuniform root scale", () => {
  for (const preset of presets) {
    const c = createCharacter();
    c.scale = { x: 1.2, y: 0.85, z: 1.1 };
    c.rotation.y = 37;
    c.bulk = 1.15;
    applyPreset(c, preset, true);
    const model = new Mannequin(c);
    model.root.updateMatrixWorld(true);
    assert.equal(model.root.userData.renderer, MANNEQUIN_REVISION);
    const fk = worldJoints(c.pose, c.position, c.rotation, c.scale);
    for (const id of JOINTS) {
      const p = model.pivots[id].getWorldPosition(new THREE.Vector3());
      assert.ok(p.distanceTo(new THREE.Vector3(fk[id].x, fk[id].y, fk[id].z)) < 1e-8, id);
    }
    assert.ok(Math.abs(meshMinimum(model) - lowestBodyY(c)) < 1e-7, preset);
    assert.ok(Math.abs(meshMinimum(model) - 0.003) < 1e-7, `floor penetration: ${preset}`);
    model.dispose();
  }
});
test("all 112 formations preserve distinct editable rigs, body contact and project export", () => {
  for (const preset of GROUP_PRESETS) {
    const p = createProject();
    applyGroupPreset(p, preset);
    for (const c of p.characters) assert.ok(Math.abs(lowestBodyY(c) - 0.003) < 1e-7, preset.name);
    const before = p.characters[1]!.pose.forearmL.x;
    p.characters[0]!.pose.forearmL.x = -73;
    assert.equal(p.characters[1]!.pose.forearmL.x, before);
    const reloaded = projectFromJson(projectToJson(p)).project!;
    assert.ok(reloaded);
    assert.equal(reloaded.characters[0]!.pose.forearmL.x, -73);
    const prompt = generatePrompt({
      duration: p.duration,
      characters: p.characters.map(toSceneCharacter),
      props: p.props.map(toSceneProp),
      camera: p.camera,
      motions: p.motions,
      profile: p.profile,
      mode: p.mode,
    });
    assert.ok(prompt);
  }
});
test("unrestricted articulation and repeated bulk changes do not drift or disconnect the skeleton", () => {
  const c = createCharacter();
  c.jointLimits = false;
  c.pose.thighL = { x: 160, y: 120, z: -130 };
  c.pose.forearmR = { x: 170, y: -150, z: 125 };
  c.rotation = { x: 23, y: 71, z: -19 };
  const m = new Mannequin(c);
  for (const bulk of [0.45, 1.8, 0.7, 1, 1.8, 0.45]) {
    c.bulk = bulk;
    placeBodyOnFloor(c);
    m.apply(c, "thighL", true);
    assert.ok(Math.abs(meshMinimum(m) - 0.003) < 1e-7);
  }
  assert.equal(m.pivots.thighL.rotation.x, THREE.MathUtils.degToRad(160));
  m.dispose();
});
test("human silhouettes, shared geometry and bounded mesh complexity", () => {
  const a = new Mannequin(createCharacter()),
    b = new Mannequin(createCharacter());
  for (const id of JOINTS) {
    const mesh = a.pivots[id].getObjectByName(`surface-${id}`) as THREE.Mesh;
    assert.equal(
      mesh.geometry,
      (b.pivots[id].getObjectByName(`surface-${id}`) as THREE.Mesh).geometry,
    );
    assert.ok(mesh.geometry.getAttribute("normal").array.every(Number.isFinite));
  }
  const triangles = Object.values(BODY_SURFACES).reduce((n, s) => n + s.indices.length / 3, 0);
  assert.ok(triangles < 12000, `triangle budget: ${triangles}`);
  assert.ok(BODY_SURFACES.handL.positions.length > BODY_SURFACES.forearmL.positions.length);
  assert.ok(a.pivots.head.getObjectByName("face-direction"));
  a.dispose();
  b.dispose();
});

test("local HTTP preview can create projects without secure-context randomUUID", () => {
  const original = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    const ids = new Set(Array.from({ length: 100 }, uid));
    assert.equal(ids.size, 100);
    for (const id of ids)
      assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.ok(createProject().id);
  } finally {
    if (original) Object.defineProperty(crypto, "randomUUID", original);
    else delete (crypto as unknown as Record<string, unknown>).randomUUID;
  }
});

test("reclining on a bed uses visible body contact at different bulk and scales", () => {
  const bed=createProp("bed");const top=surfaceY(bed.kind,propAabb(bed.kind,bed.position,bed.rotation,bed.scale));
  for(const bulk of [.45,1,1.8]) for(const mode of ["lie-up","lie-down","lie-side"] as const){
    const character=createCharacter({bulk,scale:{x:1.2,y:.8,z:1.1}});placeOnProp(character,bed,mode);
    const model=new Mannequin(character);assert.ok(Math.abs(meshMinimum(model)-top-.003)<1e-7);model.dispose();
  }
});
