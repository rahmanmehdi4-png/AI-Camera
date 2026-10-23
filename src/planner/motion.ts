import type { CameraState } from "./camera.ts";
import {
  add as addV,
  clamp,
  cross,
  dist,
  len,
  lerp,
  lerpV,
  mul,
  norm,
  rotateAround,
  rotateY,
  smoothstep,
  sub,
  v,
  type Vec3,
} from "./math.ts";

export const MOTION_KINDS = [
  "static",
  "pan",
  "tilt",
  "orbit",
  "dolly",
  "zoom",
  "hold",
  "return",
  "path",
] as const;

export type MotionKind = (typeof MOTION_KINDS)[number];

export type MotionDirection =
  | "left"
  | "right"
  | "up"
  | "down"
  | "in"
  | "out"
  | "cw"
  | "ccw"
  | "none";

export type MotionClip = {
  id: string;
  kind: MotionKind;
  /** Seconds from the start of the shot. */
  start: number;
  duration: number;
  /** Degrees, metres, or FOV degrees depending on kind. */
  amount: number;
  direction: MotionDirection;
  /** User-editable physical camera positions relative to the base camera (metres). */
  waypoints?: { t: number; offset: Vec3 }[];
};

export const MOTION_LABEL: Record<MotionKind, string> = {
  static: "Static",
  pan: "Pan",
  tilt: "Tilt",
  orbit: "Orbit",
  dolly: "Dolly / track",
  zoom: "Optical zoom",
  hold: "Hold",
  return: "Return",
  path: "Custom path",
};

export function directionsFor(kind: MotionKind): MotionDirection[] {
  switch (kind) {
    case "pan":
      return ["left", "right"];
    case "tilt":
      return ["up", "down"];
    case "orbit":
      return ["ccw", "cw"];
    case "dolly":
      return ["in", "out", "left", "right"];
    case "zoom":
      return ["in", "out"];
    case "path":
      return ["none"];
    default:
      return ["none"];
  }
}

export function sanitizeMotion(clip: MotionClip): MotionClip {
  const allowed = directionsFor(clip.kind);
  const direction = allowed.includes(clip.direction) ? clip.direction : (allowed[0] ?? "none");
  const amount = clip.kind === "hold" || clip.kind === "static" || clip.kind === "return" ? 0 : clip.amount;
  return { ...clip, direction, amount };
}

export function defaultAmount(kind: MotionKind): number {
  switch (kind) {
    case "pan":
    case "tilt":
      return 20;
    case "orbit":
      return 45;
    case "dolly":
      return 1;
    case "zoom":
      return 12;
    case "path":
      return 0;
    default:
      return 0;
  }
}

export function amountUnit(kind: MotionKind): string {
  if (kind === "dolly") return "m";
  if (kind === "zoom") return "° fov";
  if (kind === "hold" || kind === "static" || kind === "return" || kind === "path") return "";
  return "°";
}

export type MotionClass = "still" | "rotate" | "move" | "zoom" | "return";

export function motionClass(kind: MotionKind): MotionClass {
  switch (kind) {
    case "pan":
    case "tilt":
      return "rotate";
    case "orbit":
    case "dolly":
    case "path":
      return "move";
    case "zoom":
      return "zoom";
    case "return":
      return "return";
    default:
      return "still";
  }
}

export type MotionIssue = { clipId: string; message: string };

export function validateMotions(clips: MotionClip[], total: number): MotionIssue[] {
  const issues: MotionIssue[] = [];
  if (!(total > 0) || !Number.isFinite(total)) {
    issues.push({ clipId: "", message: "Timeline duration must be greater than 0." });
    return issues;
  }
  for (const clip of clips) {
    if (!Number.isFinite(clip.start) || clip.start < -1e-4) {
      issues.push({ clipId: clip.id, message: "Start time cannot be negative." });
    }
    if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
      issues.push({ clipId: clip.id, message: "Duration must be greater than 0." });
    }
    const end = clip.start + Math.max(0, clip.duration);
    if (end > total + 1e-3) {
      issues.push({
        clipId: clip.id,
        message: `Clip ends at ${end.toFixed(1)}s, after the ${total}s timeline.`,
      });
    }
    if (!Number.isFinite(clip.amount)) {
      issues.push({ clipId: clip.id, message: "Amount must be a finite number." });
    }
    if (clip.kind === "path") {
      if (!clip.waypoints || clip.waypoints.length < 2 || clip.waypoints.some((p) => !Number.isFinite(p.t) || p.t < 0 || p.t > 1 || ![p.offset.x, p.offset.y, p.offset.z].every(Number.isFinite))) {
        issues.push({ clipId: clip.id, message: "Custom path needs at least two valid waypoints with positions and progress between 0 and 1." });
      } else {
        // The first point is the current camera and the final point represents the
        // end of this clip. Unordered or repeated timestamps cause erratic jumps.
        const points = [...clip.waypoints].sort((a, b) => a.t - b.t);
        if (Math.abs(points[0]!.t) > 1e-5 || Math.abs(points[points.length - 1]!.t - 1) > 1e-5) {
          issues.push({ clipId: clip.id, message: "A custom path must start at 0% and finish at 100% of its duration." });
        }
        if (points.some((p, i) => i > 0 && p.t - points[i - 1]!.t < 1e-5)) {
          issues.push({ clipId: clip.id, message: "Each camera waypoint needs a distinct time on the timeline." });
        }
        const first = points[0]!.offset;
        if (Math.hypot(first.x, first.y, first.z) > 1e-4) {
          issues.push({ clipId: clip.id, message: "A custom path should begin at the current camera position (offset 0 m), avoiding a sudden jump." });
        }
      }
    }
    const allowed = directionsFor(clip.kind);
    if (!allowed.includes(clip.direction)) {
      issues.push({ clipId: clip.id, message: `Direction “${clip.direction}” does not apply to ${clip.kind}.` });
    }
  }
  return issues;
}


/** Insert a waypoint in the largest free interval without duplicating times.
 * Its interpolated position keeps the path visually close to its original shape.
 */
export function insertPathWaypoint(points: NonNullable<MotionClip["waypoints"]>): NonNullable<MotionClip["waypoints"]> {
  const ordered = points.map((p) => ({ t: p.t, offset: { ...p.offset } })).sort((a,b) => a.t-b.t);
  if (ordered.length < 2 || ordered.length >= 48) return ordered;
  let best = 0;
  for (let i=1; i<ordered.length-1; i++) {
    if (ordered[i+1]!.t - ordered[i]!.t > ordered[best+1]!.t - ordered[best]!.t) best = i;
  }
  const left = ordered[best]!;
  const right = ordered[best+1]!;
  if (right.t-left.t < 0.0001) return ordered;
  const point = { t: (left.t+right.t)/2, offset: lerpV(left.offset, right.offset, 0.5) };
  return [...ordered.slice(0,best+1), point, ...ordered.slice(best+1)];
}

export function clipWeight(clip: MotionClip, time: number): number {
  if (!(clip.duration > 0)) return 0;
  if (time < clip.start - 1e-6) return 0;
  return smoothstep((time - clip.start) / clip.duration);
}

export type ResolvedCamera = {
  position: Vec3;
  target: Vec3;
  fov: number;
  roll: number;
  positionDelta: number;
  fovDelta: number;
  aimDelta: number;
};

function basis(position: Vec3, target: Vec3): { forward: Vec3; right: Vec3 } {
  let forward = norm(sub(target, position));
  if (len(forward) < 1e-6) forward = v(0, 0, -1);
  let right = norm(cross(forward, v(0, 1, 0)));
  if (len(right) < 1e-6) right = v(1, 0, 0);
  return { forward, right };
}

/**
 * Motions are additive on the base framing.
 * Pan and tilt rotate the camera in place.
 * Orbit and dolly/track move the camera.
 * Zoom changes field of view only.
 * Return eases the result back toward the base framing.
 */
export function resolveCamera(base: CameraState, clips: MotionClip[], time: number): ResolvedCamera {
  let pan = 0;
  let tilt = 0;
  let orbit = 0;
  let dolly = 0;
  let track = 0;
  let zoom = 0;
  let ret = 0;
  let pathOffset = v();

  for (const clip of clips) {
    const w = clipWeight(clip, time);
    if (w <= 0) continue;
    const amount = clip.amount * w;
    if (clip.kind === "pan") pan += clip.direction === "left" ? -amount : amount;
    else if (clip.kind === "tilt") tilt += clip.direction === "up" ? amount : -amount;
    else if (clip.kind === "orbit") orbit += clip.direction === "ccw" ? amount : -amount;
    else if (clip.kind === "dolly") {
      if (clip.direction === "in") dolly += amount;
      else if (clip.direction === "out") dolly -= amount;
      else if (clip.direction === "right") track += amount;
      else if (clip.direction === "left") track -= amount;
    } else if (clip.kind === "zoom") zoom += clip.direction === "in" ? -amount : amount;
    else if (clip.kind === "path" && clip.waypoints?.length) {
      const t = clamp((time - clip.start) / clip.duration, 0, 1);
      const points = [...clip.waypoints].sort((a, b) => a.t - b.t);
      let a = points[0]!;
      let b = points[points.length - 1]!;
      for (let k = 1; k < points.length; k++) {
        if (t <= points[k]!.t) { b = points[k]!; a = points[k - 1]!; break; }
      }
      const fraction = b.t === a.t ? 1 : smoothstep((t - a.t) / (b.t - a.t));
      pathOffset = addV(pathOffset, lerpV(a.offset, b.offset, clamp(fraction, 0, 1)));
    }
    else if (clip.kind === "return") ret = Math.max(ret, w);
  }

  let position = { ...base.position };
  let target = { ...base.target };
  const offset = rotateY(sub(position, target), orbit);
  position = addV(target, offset);
  position = addV(position, pathOffset);

  let frame = basis(position, target);
  const gap = dist(position, target);
  const dollyApplied = dolly > 0 ? Math.min(dolly, Math.max(0, gap - 0.25)) : dolly;
  position = addV(position, mul(frame.forward, dollyApplied));
  position = addV(position, mul(frame.right, track));
  target = addV(target, mul(frame.right, track));

  frame = basis(position, target);
  const distance = Math.max(0.25, dist(position, target));
  let forward = rotateY(frame.forward, pan);
  forward = rotateAround(forward, frame.right, tilt);
  if (len(forward) < 1e-6) forward = frame.forward;
  target = addV(position, mul(norm(forward), distance));

  let fov = clamp(base.fov + zoom, 8, 120);
  let roll = base.roll;

  if (ret > 0) {
    position = lerpV(position, base.position, ret);
    target = lerpV(target, base.target, ret);
    fov = lerp(fov, base.fov, ret);
    roll = lerp(roll, base.roll, ret);
  }

  const aim = norm(sub(target, position));
  const baseAim = norm(sub(base.target, base.position));
  return {
    position,
    target,
    fov,
    roll,
    positionDelta: dist(position, base.position),
    fovDelta: Math.abs(fov - base.fov),
    aimDelta: len(sub(aim, baseAim)),
  };
}

export function sampleCameraPath(
  base: CameraState,
  clips: MotionClip[],
  duration: number,
  steps = 48,
): Vec3[] {
  const count = Math.max(2, steps);
  const points: Vec3[] = [];
  for (let i = 0; i <= count; i++) {
    points.push(resolveCamera(base, clips, (duration * i) / count).position);
  }
  return points;
}

export function pathMoves(points: Vec3[], epsilon = 0.04): boolean {
  for (let i = 1; i < points.length; i++) {
    if (dist(points[i]!, points[i - 1]!) > epsilon) return true;
  }
  return false;
}
