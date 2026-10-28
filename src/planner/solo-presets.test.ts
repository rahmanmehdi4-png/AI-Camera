import assert from "node:assert/strict";
import { test } from "node:test";
import { SOLO_ADULT_PRESETS, ADULT_GROUP_PRESETS, GROUP_PRESETS, applySoloAdultPreset } from "./group-presets.ts";
import { createCharacter, createProject, projectFromJson, projectToJson } from "./project.ts";
import { JOINTS, worldJoints } from "./skeleton.ts";
import { lowestBodyY } from "./body.ts";

test("solo posing references are distinct from standard and paired-adult presets", () => {
  assert.equal(GROUP_PRESETS.length, 112);
  assert.equal(ADULT_GROUP_PRESETS.length, 12);
  assert.equal(SOLO_ADULT_PRESETS.length, 43);
  const ids = SOLO_ADULT_PRESETS.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(SOLO_ADULT_PRESETS.map(p => p.name)).size, ids.length);
  for (const p of SOLO_ADULT_PRESETS) {
    assert.equal(p.count, 1);
    assert.equal(p.members.length, 1);
    assert.equal(p.category, "adult");
    assert.ok(p.members[0]?.joints && Object.keys(p.members[0].joints).length > 0);
  }
});

test("solo presets edit only the selected character and round-trip safely", () => {
  for (const preset of SOLO_ADULT_PRESETS) {
    const project = createProject("Solo reference");
    const target = project.characters[0]!;
    target.position.x = 2.3;
    target.position.z = -1.6;
    project.characters.push(createCharacter({name: "Other person"}));
    const other = structuredClone(project.characters[1]);
    const originalCamera = structuredClone(project.camera);
    const originalProps = structuredClone(project.props);
    applySoloAdultPreset(project, preset, target.id);
    assert.equal(project.characters.length, 2);
    assert.deepEqual(project.characters[1], other, preset.name + ": unrelated person changed");
    assert.deepEqual(project.camera, originalCamera);
    assert.deepEqual(project.props, originalProps);
    assert.equal(target.position.x, 2.3);
    assert.equal(target.position.z, -1.6);
    assert.ok(Number.isFinite(lowestBodyY(target)), preset.name);
    assert.ok(lowestBodyY(target) >= -0.02, preset.name + ": body clips below floor");
    const joints = worldJoints(target.pose, target.position, target.rotation, target.scale);
    for (const joint of JOINTS) {
      for (const axis of ["x","y","z"] as const) assert.ok(Number.isFinite(joints[joint][axis]), preset.name + " " + joint + "." + axis);
    }
    const result = projectFromJson(projectToJson(project));
    assert.deepEqual(result.issues, [], preset.name);
    assert.deepEqual(result.project?.characters[0]?.pose, target.pose);
    const current = target.pose.head.x;
    target.pose.head.x += 2;
    assert.equal(target.pose.head.x, current + 2);
  }
});

test("solo selection ignores invalid IDs without altering the scene", () => {
  const p = createProject();
  const before = structuredClone(p);
  applySoloAdultPreset(p, SOLO_ADULT_PRESETS[0]!, "not-a-character");
  assert.deepEqual(p, before);
});
