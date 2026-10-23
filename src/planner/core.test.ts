import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { elevationDeg, focalLengthMm, shotSize } from "./camera.ts";
import { classifyPose, supportFor } from "./detect.ts";
import {
  deg,
  eulerXYZFromMatrix,
  eulerXYZMatrix,
  rad,
  rotateEuler,
  smoothstep,
} from "./math.ts";
import { resolveCamera, sampleCameraPath, validateMotions } from "./motion.ts";
import { generatePrompt } from "./prompt.ts";
import {
  applyPreset,
  createCharacter,
  createMotion,
  createProject,
  createProp,
  duplicateCharacter,
  placeOnProp,
  projectFromJson,
  projectToJson,
  type Character,
} from "./project.ts";
import { buildZip } from "./zip.ts";
import { clampJoint, emptyPose, presetPose, worldJoints } from "./skeleton.ts";

function nearly(a: number, b: number, eps = 1e-5) {
  assert.ok(Math.abs(a - b) <= eps, `${a} !== ${b}`);
}

describe("euler matches three.js", () => {
  it("rotates a forward vector the same way as THREE.Euler XYZ", () => {
    const samples = [
      { x: 0, y: 0, z: 0 },
      { x: -90, y: 0, z: 0 },
      { x: 90, y: 0, z: 0 },
      { x: 0, y: 35, z: 0 },
      { x: -90, y: 25, z: 10 },
      { x: 12, y: -40, z: 80 },
    ];
    for (const euler of samples) {
      for (const point of [
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]) {
        const got = rotateEuler(euler, point);
        const expected = new THREE.Vector3(point.x, point.y, point.z).applyEuler(
          new THREE.Euler(rad(euler.x), rad(euler.y), rad(euler.z), "XYZ"),
        );
        nearly(got.x, expected.x, 1e-6);
        nearly(got.y, expected.y, 1e-6);
        nearly(got.z, expected.z, 1e-6);
      }
    }
  });

  it("round-trips a matrix back to degrees", () => {
    const euler = { x: -25, y: 40, z: 15 };
    const back = eulerXYZFromMatrix(eulerXYZMatrix(euler));
    nearly(back.x, euler.x, 1e-6);
    nearly(back.y, euler.y, 1e-6);
    nearly(back.z, euler.z, 1e-6);
  });
});

describe("skeleton", () => {
  it("stands upright with the head above the hips and feet near the ground", () => {
    const joints = worldJoints(emptyPose(), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    assert.ok(joints.head.y > joints.hips.y);
    assert.ok(joints.footL.y < 0.08);
    assert.ok(joints.footL.y > -0.02);
    const pose = classifyPose({
      pose: emptyPose(),
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    assert.equal(pose.label, "standing");
    assert.equal(pose.confidence, "high");
  });

  it("keeps a posed character after a structured clone", () => {
    const character = createCharacter();
    applyPreset(character, "sit", false);
    const copy = structuredClone(character);
    assert.deepEqual(copy.pose.thighL, character.pose.thighL);
    assert.equal(copy.poseLabel, "sitting");
  });

  it("classifies the built-in presets", () => {
    const expectLabel = (preset: Parameters<typeof applyPreset>[1], label: string) => {
      const character = createCharacter();
      applyPreset(character, preset, true);
      const pose = classifyPose(character);
      assert.equal(pose.label, label, `${preset} classified as ${pose.label}`);
    };
    expectLabel("stand", "standing");
    expectLabel("sit", "sitting");
    expectLabel("kneel", "kneeling");
    expectLabel("lean", "leaning");
    expectLabel("lie-up", "lying-face-up");
    expectLabel("lie-down", "lying-face-down");
    expectLabel("lie-left", "lying-left");
    expectLabel("lie-right", "lying-right");
  });

  it("clamps a hyperextended knee when limits are on", () => {
    const clamped = clampJoint("shinL", { x: 200, y: 40, z: -30 }, true);
    assert.equal(clamped.x, 145);
    assert.ok(clamped.y <= 10);
    const free = clampJoint("shinL", { x: 200, y: 40, z: -30 }, false);
    assert.equal(free.x, 180);
  });

  it("puts a seated character on a chair and a lying character on a bed", () => {
    const chair = createProp("chair", { position: { x: 1, y: 0.45, z: -0.4 }, name: "Chair" });
    const sitter = createCharacter({ name: "Character A" });
    placeOnProp(sitter, chair, "sit");
    const sit = classifyPose(sitter);
    assert.equal(sit.label, "sitting");
    assert.ok(sit.joints.hips.y > chair.position.y - 0.05);
    assert.ok(sit.joints.hips.y < chair.position.y + 0.55);

    const bed = createProp("bed", { position: { x: 0, y: 0.275, z: 0 }, name: "Bed" });
    const sleeper = createCharacter({ name: "Character B", position: { x: 2, y: 0, z: 2 } });
    placeOnProp(sleeper, bed, "lie-up");
    const lie = classifyPose(sleeper);
    assert.equal(lie.label, "lying-face-up");
    assert.ok(Math.abs(lie.joints.hips.x - bed.position.x) < 0.2);
    assert.ok(lie.joints.hips.y > bed.position.y);
  });
});

describe("camera and motion", () => {
  const base = {
    position: { x: 0, y: 1.6, z: 4 },
    target: { x: 0, y: 1, z: 0 },
    roll: 0,
    fov: 40,
    aspect: "16:9" as const,
  };

  it("reports elevation, shot size and focal length", () => {
    assert.ok(elevationDeg(base) > 5 && elevationDeg(base) < 15);
    assert.equal(shotSize(6.2, 50, 1.7), "establishing");
    assert.equal(shotSize(1.1, 28, 1.7), "close-up");
    assert.ok(focalLengthMm(40) > 30 && focalLengthMm(40) < 40);
    nearly(deg(Math.atan(24 / 2 / focalLengthMm(50))), 50 / 2, 0.05);
  });

  it("pans in place, dollies by moving, and zooms only the lens", () => {
    const pan = resolveCamera(base, [{ id: "p", kind: "pan", start: 0, duration: 2, amount: 20, direction: "left" }], 2);
    nearly(pan.position.x, base.position.x);
    nearly(pan.position.y, base.position.y);
    nearly(pan.position.z, base.position.z);
    assert.ok(pan.aimDelta > 0.05);
    assert.ok(pan.target.x < base.target.x);

    const dolly = resolveCamera(base, [{ id: "d", kind: "dolly", start: 0, duration: 2, amount: 1, direction: "in" }], 2);
    assert.ok(dolly.positionDelta > 0.9);
    nearly(dolly.fov, base.fov);
    assert.ok(dolly.position.z < base.position.z);

    const zoom = resolveCamera(base, [{ id: "z", kind: "zoom", start: 0, duration: 2, amount: 10, direction: "in" }], 2);
    nearly(zoom.position.x, base.position.x);
    nearly(zoom.position.z, base.position.z);
    nearly(zoom.fov, 30);

    const orbit = resolveCamera(base, [{ id: "o", kind: "orbit", start: 0, duration: 2, amount: 90, direction: "ccw" }], 2);
    assert.ok(orbit.position.x < -1);
    nearly(orbit.target.x, base.target.x, 1e-6);
  });

  it("smoothsteps overlapping pan and zoom and returns to the base framing", () => {
    assert.equal(smoothstep(0), 0);
    assert.equal(smoothstep(1), 1);
    nearly(smoothstep(0.5), 0.5);
    const mid = resolveCamera(
      base,
      [
        { id: "p", kind: "pan", start: 0, duration: 4, amount: 40, direction: "right" },
        { id: "z", kind: "zoom", start: 0, duration: 4, amount: 8, direction: "out" },
      ],
      2,
    );
    assert.ok(mid.target.x > base.target.x);
    nearly(mid.fov, 44);
    nearly(mid.position.z, base.position.z);

    const back = resolveCamera(
      base,
      [
        { id: "p", kind: "pan", start: 0, duration: 2, amount: 30, direction: "left" },
        { id: "r", kind: "return", start: 2, duration: 2, amount: 0, direction: "none" },
      ],
      4,
    );
    nearly(back.position.x, base.position.x, 1e-6);
    nearly(back.target.x, base.target.x, 1e-4);
    nearly(back.fov, base.fov, 1e-6);
  });

  it("rejects a clip that runs past the timeline", () => {
    const issues = validateMotions(
      [{ id: "late", kind: "hold", start: 14, duration: 3, amount: 0, direction: "none" }],
      15,
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.message, /after/);
    const path = sampleCameraPath(base, [], 15, 4);
    assert.equal(path.length, 5);
    nearly(path[0]!.z, path[4]!.z);
  });
});

describe("prompt and project file", () => {
  function posed(name: string, preset: Parameters<typeof presetPose>[0], position = { x: 0, y: 0, z: 0 }): Character {
    const character = createCharacter({ name, position });
    applyPreset(character, preset, true);
    character.poseLabel = "auto";
    return character;
  }

  it("describes two people and does not invent contact", () => {
    const project = createProject();
    project.characters = [
      posed("Character A", "lie-up", { x: 0, y: 0, z: 0 }),
      posed("Character B", "sit", { x: 1.6, y: 0, z: 0.2 }),
    ];
    project.characters[1]!.rotation = { x: 0, y: 180, z: 0 };
    project.motions = [createMotion("dolly", 0)];
    project.motions[0]!.direction = "in";
    project.motions[0]!.amount = 0.8;
    project.motions[0]!.duration = 5;
    const text = generatePrompt({
      ...project,
      characters: project.characters,
      props: [],
    });
    assert.match(text, /Character A is lying face-up/);
    assert.match(text, /Character B is sitting/);
    assert.match(text, /dolly in/);
    assert.match(text, /not a zoom/);
    assert.doesNotMatch(text, /kiss|holding hands|embrace|smiling|angry/i);
  });

  it("uses a user pose label and keeps pan distinct from movement", () => {
    const character = posed("Character A", "stand");
    character.poseLabel = "lying-face-up";
    character.relationNote = "Head toward the window.";
    const text = generatePrompt({
      duration: 15,
      characters: [character],
      props: [],
      camera: createProject().camera,
      motions: [{ id: "p", kind: "pan", start: 1, duration: 3, amount: 15, direction: "left" }],
      profile: "h3max",
      mode: "simple",
    });
    assert.match(text, /lying face-up/);
    assert.match(text, /rotates in place/);
    assert.match(text, /Head toward the window/);
    assert.doesNotMatch(text, /Wan/);
  });

  it("writes a Wan profile without H3-only wording", () => {
    const text = generatePrompt({
      duration: 15,
      characters: [posed("Character A", "lean")],
      props: [createProp("wall", { name: "Wall" })],
      camera: createProject().camera,
      motions: [],
      profile: "wan3",
      mode: "detailed",
    });
    assert.match(text, /plain spatial language/);
    assert.match(text, /does not move, rotate, or zoom/);
    assert.match(text, /Wall/);
    assert.doesNotMatch(text, /H3 Max/);
  });

  it("matches a staged chair, bed, and overlapping moves to the prompt", () => {
    const project = createProject("Coverage");
    const chair = createProp("chair", { name: "Chair", position: { x: 0.2, y: 0.45, z: 0.4 } });
    const bed = createProp("bed", { name: "Bed", position: { x: -1.4, y: 0.28, z: -0.2 } });
    const sitter = createCharacter({ name: "Character A" });
    const sleeper = createCharacter({ name: "Character B" });
    placeOnProp(sitter, chair, "sit");
    placeOnProp(sleeper, bed, "lie-up");
    sitter.poseLabel = "auto";
    sleeper.poseLabel = "auto";
    project.characters = [sitter, sleeper];
    project.props = [chair, bed];
    project.motions = [
      { id: "pan", kind: "pan", start: 0, duration: 4, amount: 18, direction: "left" },
      { id: "zoom", kind: "zoom", start: 2, duration: 4, amount: 8, direction: "in" },
      { id: "dolly", kind: "dolly", start: 8, duration: 4, amount: 0.6, direction: "out" },
    ];

    const mid = resolveCamera(project.camera, project.motions, 4);
    nearly(mid.position.x, project.camera.position.x);
    nearly(mid.position.y, project.camera.position.y);
    nearly(mid.position.z, project.camera.position.z);
    assert.ok(mid.fov < project.camera.fov - 3);
    const later = resolveCamera(project.camera, project.motions, 12);
    assert.ok(later.positionDelta > 0.4);
    // Zoom finished at 6s. V2 holds the new lens until an explicit return clip.
    nearly(later.fov, project.camera.fov - 8);
    const returned = resolveCamera(
      project.camera,
      [
        ...project.motions,
        { id: "back", kind: "return", start: 12, duration: 2, amount: 0, direction: "none" },
      ],
      14,
    );
    nearly(returned.fov, project.camera.fov, 1e-4);
    nearly(returned.position.x, project.camera.position.x, 1e-3);
    nearly(returned.position.z, project.camera.position.z, 1e-3);

    const sit = classifyPose(sitter);
    const lie = classifyPose(sleeper);
    assert.equal(sit.label, "sitting");
    assert.equal(lie.label, "lying-face-up");
    assert.equal(supportFor(sitter, project.props)?.how, "sitting-on");
    assert.equal(supportFor(sleeper, project.props)?.how, "lying-on");
    assert.ok(sit.joints.hips.y > chair.position.y - 0.05);
    assert.ok(lie.joints.hips.y > bed.position.y);

    const text = generatePrompt({ ...project, characters: project.characters, props: project.props });
    assert.match(text, /sitting on the Chair/);
    assert.match(text, /lying face-up on the Bed/);
    assert.match(text, /rotates in place and does not move/);
    assert.match(text, /Only the lens changes/);
    assert.match(text, /physically moves farther/);
    assert.match(text, /A camera move and an optical zoom both occur/);
    assert.doesNotMatch(text, /holding|hugging|smiling|asleep|talking/i);

    const behind = createCharacter({ name: "Character C", position: { x: 0, y: 0, z: -1.4 } });
    applyPreset(behind, "stand", true);
    behind.poseLabel = "auto";
    const relations = generatePrompt({
      duration: 15,
      characters: [posed("Character A", "stand"), behind],
      props: [],
      camera: project.camera,
      motions: [],
      profile: "h3max",
      mode: "simple",
    });
    assert.match(relations, /Character C is behind Character A/);
    assert.doesNotMatch(relations, /holding|hugging|touching|smiling/i);

    const loaded = projectFromJson(projectToJson(project));
    assert.equal(loaded.issues.length, 0);
    assert.equal(loaded.project?.characters.length, 2);
    assert.equal(loaded.project?.motions.length, 3);
  });

  it("round-trips a project and duplicates a character", () => {
    const project = createProject("Night shot");
    project.props.push(createProp("bed", { name: "Bed" }));
    project.motions.push(createMotion("orbit", 2));
    const loaded = projectFromJson(projectToJson(project));
    assert.equal(loaded.issues.length, 0);
    assert.equal(loaded.project?.name, "Night shot");
    assert.equal(loaded.project?.props[0]?.kind, "bed");
    assert.equal(loaded.project?.motions[0]?.kind, "orbit");
    const copy = duplicateCharacter(project, project.characters[0]!.id);
    assert.ok(copy);
    assert.notEqual(copy!.id, project.characters[0]!.id);
    assert.ok(copy!.position.x > project.characters[0]!.position.x);
    const bad = projectFromJson("{");
    assert.equal(bad.project, null);
    const wrong = projectFromJson(JSON.stringify({ version: 9 }));
    assert.match(wrong.issues[0]!.message, /version/i);
  });

  it("builds a zip that contains the instruction file", () => {
    const blob = buildZip([{ name: "instructions.txt", data: new TextEncoder().encode("hello camera") }]);
    assert.equal(blob.type, "application/zip");
    assert.ok(blob.size > 40);
  });
});
