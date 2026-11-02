import assert from "node:assert/strict";
import { test } from "node:test";
import { ADULT_GROUP_PRESETS, GROUP_PRESETS, applyGroupPreset } from "./group-presets.ts";
import { createProject, projectFromJson, projectToJson } from "./project.ts";
import { JOINTS, worldJoints } from "./skeleton.ts";
import { lowestBodyY } from "./body.ts";

test("adult positions are separate from the original 112 standard formations", () => {
  assert.equal(GROUP_PRESETS.length, 112);
  assert.equal(ADULT_GROUP_PRESETS.length, 42);
  assert.equal(new Set(ADULT_GROUP_PRESETS.map(p => p.id)).size, 42);
  assert.equal(new Set(ADULT_GROUP_PRESETS.map(p => p.name)).size, 42);
  assert.equal(ADULT_GROUP_PRESETS.filter(p => p.count === 2).length, 28);
  assert.equal(ADULT_GROUP_PRESETS.filter(p => p.count === 3).length, 14);
  for (const preset of ADULT_GROUP_PRESETS) {
    assert.equal(preset.category, "adult");
    assert.ok(preset.count === 2 || preset.count === 3);
    assert.equal(preset.members.length, preset.count);
    assert.ok(preset.members.some(member => member.joints && Object.keys(member.joints).length));
  }
  for (const name of ["Missionary", "Cowgirl", "Reverse Cowgirl", "Doggy Style", "Spooning"]) {
    assert.ok(ADULT_GROUP_PRESETS.some(p => p.name === name), name);
  }
});

test("adult presets create editable figures with finite joints and round-trip through saved projects", () => {
  for (const preset of ADULT_GROUP_PRESETS) {
    const project = createProject("Adult pose reference");
    const originalId = project.characters[0]!.id;
    applyGroupPreset(project, preset);
    assert.equal(project.characters.length, preset.count);
    assert.equal(project.characters[0]!.id, originalId);
    for (const character of project.characters) {
      assert.ok(Number.isFinite(character.position.y));
      const floorY = lowestBodyY(character);
      const lift = preset.members[project.characters.indexOf(character)]!.lift ?? 0;
      assert.ok(Math.abs(floorY - (lift + 0.003)) < 0.008, `${preset.name}: rendered body contact ${floorY}`);
      const joints = worldJoints(character.pose, character.position, character.rotation, character.scale);
      for (const joint of JOINTS) {
        assert.ok(Number.isFinite(joints[joint].x), `${preset.name}: ${joint}.x`);
        assert.ok(Number.isFinite(joints[joint].y), `${preset.name}: ${joint}.y`);
        assert.ok(Number.isFinite(joints[joint].z), `${preset.name}: ${joint}.z`);
      }
    }
    const parsed = projectFromJson(projectToJson(project));
    assert.deepEqual(parsed.issues, []);
    assert.deepEqual(parsed.project?.characters.map(c => c.pose), project.characters.map(c => c.pose));
    const previous = project.characters[1]!.pose.head.x;
    project.characters[1]!.pose.head.x += 2;
    assert.equal(project.characters[1]!.pose.head.x, previous + 2);
  }
});


test("group presets normalize scene centres, trim stale extra characters, and apply deterministically", () => {
  const scene = createProject();
  const duo = ADULT_GROUP_PRESETS.find(p => p.id === "adult-standing-embrace")!;
  const trio = ADULT_GROUP_PRESETS.find(p => p.id === "adult-trio-close-triangle")!;
  scene.characters[0]!.position.x = 17;
  scene.characters[0]!.position.z = -9;
  applyGroupPreset(scene, trio);
  assert.equal(scene.characters.length, 3);
  assert.ok(scene.characters.every(c => Math.abs(c.position.x) < 2 && Math.abs(c.position.z) < 2));
  const first = scene.characters.map(c => ({position:c.position,rotation:c.rotation,pose:c.pose}));
  applyGroupPreset(scene, trio);
  assert.deepEqual(scene.characters.map(c => ({position:c.position,rotation:c.rotation,pose:c.pose})),first);
  applyGroupPreset(scene, duo);
  assert.equal(scene.characters.length, 2, "Switching from trio to pair must remove the previous third figure");
  const centres = scene.characters.map(c => c.position.x);
  assert.ok(centres[0] !== centres[1] || scene.characters[0]!.position.z !== scene.characters[1]!.position.z);
});
