import type { AspectId, CameraState } from "./camera.ts";
import { cameraPreset } from "./camera.ts";
import type { PoseLabel, SceneCharacter, SceneProp } from "./detect.ts";
import {
  add,
  eulerXYZFromMatrix,
  eulerXYZMatrix,
  mulMat,
  rotX,
  rotY,
  sub,
  v,
  type EulerDeg,
  type Vec3,
} from "./math.ts";
import type { MotionClip, MotionDirection, MotionKind } from "./motion.ts";
import { defaultAmount, directionsFor } from "./motion.ts";
import { propAabb, propSpec, surfaceY, type PropKind } from "./props.ts";
import {
  clampPose,
  emptyPose,
  presetPose,
  worldJoints,
  type JointId,
  type Pose,
  type PresetId,
} from "./skeleton.ts";

import { placeBodyOnFloor } from "./body.ts";

export const PROJECT_VERSION = 1;

export type Character = {
  id: string;
  name: string;
  position: Vec3;
  rotation: EulerDeg;
  scale: Vec3;
  bulk: number;
  pose: Pose;
  color: string;
  jointLimits: boolean;
  poseLabel: PoseLabel;
  relationNote: string;
};

export type Prop = {
  id: string;
  name: string;
  kind: PropKind;
  position: Vec3;
  rotation: EulerDeg;
  scale: Vec3;
  color: string;
};

export type Project = {
  version: typeof PROJECT_VERSION;
  id: string;
  name: string;
  duration: number;
  characters: Character[];
  props: Prop[];
  camera: CameraState;
  motions: MotionClip[];
  profile: "h3max" | "wan3";
  mode: "simple" | "detailed";
};

export function uid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID is secure-context-only; local HTTP previews still expose getRandomValues.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function createCharacter(partial?: Partial<Character>): Character {
  return {
    id: partial?.id ?? uid(),
    name: partial?.name ?? "Character A",
    position: partial?.position ?? v(0, 0, 0),
    rotation: partial?.rotation ?? { x: 0, y: 0, z: 0 },
    scale: partial?.scale ?? v(1, 1, 1),
    bulk: partial?.bulk ?? 1,
    pose: partial?.pose ?? emptyPose(),
    color: partial?.color ?? "#d9d2c6",
    jointLimits: partial?.jointLimits ?? false,
    poseLabel: partial?.poseLabel ?? "auto",
    relationNote: partial?.relationNote ?? "",
  };
}

export function createProp(kind: PropKind, partial?: Partial<Prop>): Prop {
  const spec = propSpec(kind);
  const y = kind === "plane" ? 0.01 : spec.size.y / 2;
  return {
    id: partial?.id ?? uid(),
    name: partial?.name ?? spec.label,
    kind,
    position: partial?.position ?? v(0.9, y, 0),
    rotation: partial?.rotation ?? { x: 0, y: 0, z: 0 },
    scale: partial?.scale ?? v(1, 1, 1),
    color: partial?.color ?? spec.color,
  };
}

export function defaultCamera(): CameraState {
  const preset = cameraPreset("three-quarter", v(0, 1, 0), v(0, 0, 1));
  return {
    position: preset.position,
    target: preset.target,
    roll: 0,
    fov: preset.fov,
    aspect: "16:9",
  };
}

export function createProject(name = "Untitled shot"): Project {
  return {
    version: PROJECT_VERSION,
    id: uid(),
    name,
    duration: 15,
    characters: [createCharacter({ name: "Character A", position: v(0, 0, 0) })],
    props: [],
    camera: defaultCamera(),
    motions: [],
    profile: "h3max",
    mode: "simple",
  };
}

export function nextCharacterName(project: Project): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const used = new Set(project.characters.map((character) => character.name));
  for (let i = 0; i < letters.length; i++) {
    const name = `Character ${letters[i]}`;
    if (!used.has(name)) return name;
  }
  return `Character ${project.characters.length + 1}`;
}

export function duplicateCharacter(project: Project, id: string): Character | null {
  const source = project.characters.find((character) => character.id === id);
  if (!source) return null;
  const copy = structuredClone(source);
  copy.id = uid();
  copy.name = `${source.name} copy`;
  copy.position = add(source.position, v(0.55, 0, 0));
  return copy;
}

export function duplicateProp(project: Project, id: string): Prop | null {
  const source = project.props.find((prop) => prop.id === id);
  if (!source) return null;
  const copy = structuredClone(source);
  copy.id = uid();
  copy.name = `${source.name} copy`;
  copy.position = add(source.position, v(0.4, 0, 0.4));
  return copy;
}

export function applyPreset(character: Character, preset: PresetId, snap: boolean): void {
  const next = presetPose(preset);
  const yaw = character.rotation.y;
  character.pose = character.jointLimits ? clampPose(next.pose, true) : next.pose;
  character.rotation = eulerXYZFromMatrix(mulMat(rotY(yaw), eulerXYZMatrix(next.rotation)));
  if (snap || preset.startsWith("lie") || preset === "kneel") {
    placeBodyOnFloor(character);
  }
  if (preset === "stand") character.poseLabel = "standing";
  else if (preset === "sit") character.poseLabel = "sitting";
  else if (preset === "kneel") character.poseLabel = "kneeling";
  else if (preset === "lean") character.poseLabel = "leaning";
  else if (preset === "lie-up") character.poseLabel = "lying-face-up";
  else if (preset === "lie-down") character.poseLabel = "lying-face-down";
  else if (preset === "lie-left") character.poseLabel = "lying-left";
  else if (preset === "lie-right") character.poseLabel = "lying-right";
}

export function placeOnProp(character: Character, prop: Prop, mode: "sit" | "lie-up" | "lie-down" | "lie-side"): void {
  const box = propAabb(prop.kind, prop.position, prop.rotation, prop.scale);
  const surface = surfaceY(prop.kind, box);
  const preset: PresetId =
    mode === "sit" ? "sit" : mode === "lie-down" ? "lie-down" : mode === "lie-side" ? "lie-left" : "lie-up";
  const shaped = presetPose(preset);
  character.pose = character.jointLimits ? clampPose(shaped.pose, true) : shaped.pose;
  if (mode === "sit") {
    character.rotation = { x: 0, y: prop.rotation.y, z: 0 };
    const hipY = 0.96 * character.scale.y;
    character.position = v(prop.position.x, surface + 0.115 * character.scale.y + 0.003 - hipY, prop.position.z);
  } else {
    const pitch = mode === "lie-down" ? rotX(90) : mode === "lie-side" ? rotZ(90) : rotX(-90);
    character.rotation = eulerXYZFromMatrix(mulMat(rotY(prop.rotation.y), pitch));
    const hip = worldJoints(character.pose, v(0, 0, 0), character.rotation, character.scale).hips;
    const target = v(prop.position.x, surface + 0.12, prop.position.z);
    character.position = sub(target, hip);
    placeBodyOnFloor(character, surface);
  }
  character.poseLabel =
    mode === "sit"
      ? "sitting"
      : mode === "lie-down"
        ? "lying-face-down"
        : mode === "lie-side"
          ? "lying-left"
          : "lying-face-up";
}

function rotZ(degrees: number): number[] {
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function createMotion(kind: MotionKind = "pan", start = 0): MotionClip {
  const direction = directionsFor(kind)[0] ?? "none";
  return {
    id: uid(),
    kind,
    start,
    duration: kind === "hold" || kind === "static" ? 2 : 4,
    amount: defaultAmount(kind),
    direction,
    ...(kind === "path" ? { waypoints: [
      { t: 0, offset: v(0, 0, 0) },
      { t: 0.5, offset: v(0, 1.3, 0) },
      { t: 1, offset: v(0, 0, 0) },
    ] } : {}),
  };
}

export function sanitizeMotion(clip: MotionClip): MotionClip {
  const allowed = directionsFor(clip.kind);
  const direction: MotionDirection = allowed.includes(clip.direction) ? clip.direction : (allowed[0] ?? "none");
  return { ...clip, direction, amount: clip.kind === "hold" || clip.kind === "static" || clip.kind === "return" ? 0 : clip.amount };
}

export type ProjectIssue = { path: string; message: string };

function isVec3(value: unknown): value is Vec3 {
  if (!value || typeof value !== "object") return false;
  const v3 = value as Vec3;
  return [v3.x, v3.y, v3.z].every((n) => typeof n === "number" && Number.isFinite(n));
}

function isEuler(value: unknown): value is EulerDeg {
  return isVec3(value);
}

const ASPECTS: AspectId[] = ["16:9", "9:16", "1:1", "4:3", "21:9"];

export function validateProject(input: unknown): { project: Project | null; issues: ProjectIssue[] } {
  const issues: ProjectIssue[] = [];
  if (!input || typeof input !== "object") {
    return { project: null, issues: [{ path: "", message: "Project file is not an object." }] };
  }
  const raw = input as Partial<Project>;
  if (raw.version !== PROJECT_VERSION) {
    issues.push({
      path: "version",
      message: `Unsupported project version ${String(raw.version)}. This app reads version ${PROJECT_VERSION}.`,
    });
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) issues.push({ path: "name", message: "Project name is missing." });
  if (typeof raw.duration !== "number" || raw.duration <= 0 || raw.duration > 120) {
    issues.push({ path: "duration", message: "Duration must be between 0 and 120 seconds." });
  }
  if (!Array.isArray(raw.characters)) issues.push({ path: "characters", message: "Characters are missing." });
  if (!Array.isArray(raw.props)) issues.push({ path: "props", message: "Props are missing." });
  if (!Array.isArray(raw.motions)) issues.push({ path: "motions", message: "Motions are missing." });
  if (!raw.camera || !isVec3(raw.camera.position) || !isVec3(raw.camera.target)) {
    issues.push({ path: "camera", message: "Camera position or target is invalid." });
  }
  if (raw.camera && !ASPECTS.includes(raw.camera.aspect)) {
    issues.push({ path: "camera.aspect", message: "Unknown aspect ratio." });
  }
  if (issues.length) return { project: null, issues };

  const project = structuredClone(raw) as Project;
  project.name = project.name.trim();
  for (const character of project.characters) {
    if (!character.id || !isVec3(character.position) || !isEuler(character.rotation) || !character.pose) {
      return { project: null, issues: [{ path: "characters", message: `Character “${character.name ?? "?"}” is incomplete.` }] };
    }
    character.jointLimits = Boolean(character.jointLimits);
    character.relationNote ??= "";
    character.poseLabel ??= "auto";
    character.bulk = Number.isFinite(character.bulk) ? character.bulk : 1;
  }
  for (const prop of project.props) {
    if (!prop.id || !prop.kind || !isVec3(prop.position) || !isEuler(prop.rotation) || !isVec3(prop.scale)) {
      return { project: null, issues: [{ path: "props", message: `Object “${prop.name ?? "?"}” is incomplete.` }] };
    }
  }
  return { project, issues: [] };
}

export function projectToJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function projectFromJson(text: string): { project: Project | null; issues: ProjectIssue[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { project: null, issues: [{ path: "", message: "That file is not valid JSON." }] };
  }
  return validateProject(parsed);
}

export function toSceneCharacter(character: Character): SceneCharacter {
  return {
    id: character.id,
    name: character.name,
    pose: character.pose,
    position: character.position,
    rotation: character.rotation,
    scale: character.scale,
    poseLabel: character.poseLabel,
    relationNote: character.relationNote,
  };
}

export function toSceneProp(prop: Prop): SceneProp {
  return {
    id: prop.id,
    name: prop.name,
    kind: prop.kind,
    position: prop.position,
    rotation: prop.rotation,
    scale: prop.scale,
  };
}

export function groupFocus(project: Project): Vec3 {
  const points: Vec3[] = [];
  for (const character of project.characters) {
    points.push(worldJoints(character.pose, character.position, character.rotation, character.scale).chest);
  }
  for (const prop of project.props) points.push(prop.position);
  if (points.length === 0) return v(0, 1, 0);
  const acc = points.reduce((sum, p) => add(sum, p), v());
  return { x: acc.x / points.length, y: acc.y / points.length, z: acc.z / points.length };
}

export function headFocus(character: Character): Vec3 {
  return worldJoints(character.pose, character.position, character.rotation, character.scale).head;
}

export type { JointId };
