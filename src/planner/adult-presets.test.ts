import assert from "node:assert/strict";
import { test } from "node:test";
import { ADULT_GROUP_PRESETS, GROUP_PRESETS, applyGroupPreset } from "./group-presets.ts";
import { createProject, projectFromJson, projectToJson } from "./project.ts";
import { JOINTS, worldJoints } from "./skeleton.ts";

test("adult positions are separate from the original 112 standard formations", () => {
  assert.equal(GROUP_PRESETS.length, 112);
  assert.equal(ADULT_GROUP_PRESETS.length, 12);
  assert.equal(new Set(ADULT_GROUP_PRESETS.map(p => p.id)).size, 12);
  for (const preset of ADULT_GROUP_PRESETS) {
    assert.equal(preset.category, "adult");
    assert.equal(preset.count, 2);
    assert.equal(preset.members.length, 2);
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
    assert.equal(project.characters.length, 2);
    assert.equal(project.characters[0]!.id, originalId);
    for (const character of project.characters) {
      assert.ok(Number.isFinite(character.position.y));
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
