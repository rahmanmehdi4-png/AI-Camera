import assert from "node:assert/strict";
import { test } from "node:test";
import { GROUP_PRESETS, applyGroupPreset } from "./group-presets.ts";
import { createMotion, createProject, projectFromJson, projectToJson } from "./project.ts";
import { resolveCamera, validateMotions, insertPathWaypoint } from "./motion.ts";

test("neutral multi-person presets cover two, three and four people", () => {
  assert.equal(GROUP_PRESETS.length, 112);
  assert.deepEqual([...new Set(GROUP_PRESETS.map((p) => p.count))].sort(), [2, 3, 4]);
  for (const preset of GROUP_PRESETS) {
    assert.equal(preset.members.length, preset.count);
    assert.ok(preset.name.length > 3);
    assert.ok(!/sex|explicit|nsfw/i.test(preset.name));
  }
});

test("preset adds required characters without deleting user work", () => {
  const project = createProject("Test");
  applyGroupPreset(project, GROUP_PRESETS.find((p) => p.count === 3)!);
  assert.equal(project.characters.length, 3);
  assert.deepEqual(project.characters.map((c) => c.name), ["Character A", "Character B", "Character C"]);
  applyGroupPreset(project, GROUP_PRESETS.find((p) => p.count === 2)!);
  assert.equal(project.characters.length, 3);
});

test("custom camera path goes up, down, and holds after its duration", () => {
  const project = createProject();
  const base = project.camera;
  const clip = createMotion("path", 0);
  clip.duration = 8;
  assert.equal(validateMotions([clip], 15).length, 0);
  const begin = resolveCamera(base, [clip], 0);
  const middle = resolveCamera(base, [clip], 4);
  const end = resolveCamera(base, [clip], 8);
  const after = resolveCamera(base, [clip], 12);
  assert.ok(Math.abs(middle.position.y - begin.position.y - 1.3) < 0.0001);
  assert.ok(Math.abs(end.position.y - begin.position.y) < 0.0001);
  assert.ok(Math.abs(after.position.y - begin.position.y) < 0.0001);
});

test("completed camera moves hold their framing until a return clip", () => {
  const project = createProject();
  const pan = createMotion("pan", 0);
  pan.duration = 3;
  const end = resolveCamera(project.camera, [pan], 3);
  const later = resolveCamera(project.camera, [pan], 7);
  assert.ok(Math.abs(end.target.x - later.target.x) < 0.00001);
});

test("original project format remains readable after group poses and new path clips", () => {
  const project = createProject();
  applyGroupPreset(project, GROUP_PRESETS.find((p) => p.count === 4)!);
  project.motions = [createMotion("path", 2)];
  const result = projectFromJson(projectToJson(project));
  assert.ok(result.project);
  assert.equal(result.project!.version, 1);
  assert.equal(result.project!.characters.length, 4);
  assert.equal(result.project!.motions[0]!.waypoints?.length, 3);
});


test("camera paths reject discontinuities and repeated waypoint times", () => {
  const clip = createMotion("path", 0);
  const valid = validateMotions([clip], 15);
  assert.equal(valid.length, 0);
  const repeat = structuredClone(clip);
  repeat.waypoints![1]!.t = 0;
  assert.ok(validateMotions([repeat], 15).some((issue) => issue.message.includes("distinct time")));
  const jump = structuredClone(clip);
  jump.waypoints![0]!.offset = { x: 0, y: 1, z: 0 };
  assert.ok(validateMotions([jump], 15).some((issue) => issue.message.includes("sudden jump")));
  const short = structuredClone(clip);
  short.waypoints![short.waypoints!.length-1]!.t = 0.8;
  assert.ok(validateMotions([short], 15).some((issue) => issue.message.includes("100%")));
});

test("adding multiple camera path points never repeats a timestamp", () => {
  const clip=createMotion("path",0);
  let points=clip.waypoints!;
  for(let i=0;i<20;i++){
    points=insertPathWaypoint(points);
    assert.equal(points.length,i+4);
    assert.ok(points.every((p,j)=>j===0 || p.t>points[j-1]!.t));
    const changed={...clip,waypoints:points};
    assert.deepEqual(validateMotions([changed],15),[]);
  }
});
