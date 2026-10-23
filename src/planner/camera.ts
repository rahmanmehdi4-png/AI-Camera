import {
  add,
  clamp,
  cross,
  deg,
  dist,
  dot,
  fmtNum,
  len,
  mul,
  norm,
  rad,
  sub,
  v,
  type Vec3,
} from "./math.ts";

export const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "21:9"] as const;
export type AspectId = (typeof ASPECTS)[number];

export const ASPECT_VALUE: Record<AspectId, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:3": 4 / 3,
  "21:9": 21 / 9,
};

export type CameraState = {
  position: Vec3;
  target: Vec3;
  /** Degrees, applied after look-at. Positive rolls clockwise in the viewfinder. */
  roll: number;
  /** Vertical field of view, degrees. */
  fov: number;
  aspect: AspectId;
};

export function cameraDistance(cam: Pick<CameraState, "position" | "target">): number {
  return dist(cam.position, cam.target);
}

export function elevationDeg(cam: Pick<CameraState, "position" | "target">): number {
  const d = sub(cam.position, cam.target);
  const distance = len(d);
  if (distance < 1e-6) return 0;
  return deg(Math.asin(clamp(d.y / distance, -1, 1)));
}

/** Degrees. 0 looks from north (+Z) toward the target. Positive is from the east (+X). */
export function azimuthDeg(cam: Pick<CameraState, "position" | "target">): number {
  const d = sub(cam.position, cam.target);
  return deg(Math.atan2(d.x, d.z));
}

/** 35mm-style focal length using a 24mm sensor height (vertical FOV). */
export function focalLengthMm(fovDeg: number, sensorHeight = 24): number {
  const half = rad(fovDeg) / 2;
  const t = Math.tan(half);
  if (t < 1e-6) return 999;
  return sensorHeight / 2 / t;
}

export function horizontalFov(fovDeg: number, aspect: number): number {
  const vertical = Math.tan(rad(fovDeg) / 2);
  return deg(2 * Math.atan(vertical * aspect));
}

export type ShotSize =
  | "close-up"
  | "medium close-up"
  | "medium"
  | "full"
  | "wide"
  | "establishing";

export function frameHeightAt(distance: number, fovDeg: number): number {
  return 2 * Math.max(0, distance) * Math.tan(rad(fovDeg) / 2);
}

export function shotSize(distance: number, fovDeg: number, subjectHeight: number): ShotSize {
  const frame = frameHeightAt(distance, fovDeg);
  const ratio = frame / Math.max(0.25, subjectHeight);
  if (ratio > 3.4) return "establishing";
  if (ratio > 2.15) return "wide";
  if (ratio > 1.25) return "full";
  if (ratio > 0.78) return "medium";
  if (ratio > 0.42) return "medium close-up";
  return "close-up";
}

export function elevationPhrase(elev: number): string {
  if (elev < -25) return "a low angle, looking up";
  if (elev < -8) return "a slightly low angle";
  if (elev <= 12) return "near eye level";
  if (elev <= 32) return "a slightly elevated angle";
  if (elev <= 62) return "a high angle";
  return "overhead";
}

/**
 * Where the camera sits relative to a subject's horizontal facing.
 * `forward` is the direction the subject looks, in world space.
 */
export function approachPhrase(cameraPos: Vec3, target: Vec3, forward: Vec3): string {
  const flatFwd = norm(v(forward.x, 0, forward.z));
  const toCam = norm(v(cameraPos.x - target.x, 0, cameraPos.z - target.z));
  if (len(flatFwd) < 1e-4 || len(toCam) < 1e-4) return "from above the subject";
  const facing = dot(flatFwd, toCam);
  const right = norm(cross(v(0, 1, 0), flatFwd));
  const side = dot(right, toCam);
  if (facing > 0.75) return "from the front";
  if (facing < -0.75) return "from behind";
  if (facing > 0.35 && side > 0.3) return "from the front-right";
  if (facing > 0.35 && side < -0.3) return "from the front-left";
  if (facing < -0.35 && side > 0.3) return "from the back-right";
  if (facing < -0.35 && side < -0.3) return "from the back-left";
  if (side >= 0) return "from the right side";
  return "from the left side";
}

export type CameraPresetId =
  | "front"
  | "three-quarter"
  | "high"
  | "low"
  | "overhead"
  | "profile"
  | "close"
  | "wide";

export const CAMERA_PRESET_LABEL: Record<CameraPresetId, string> = {
  front: "Front",
  "three-quarter": "Three-quarter",
  high: "High",
  low: "Low",
  overhead: "Overhead",
  profile: "Profile",
  close: "Close-up",
  wide: "Wide",
};

export function cameraPreset(
  preset: CameraPresetId,
  focus: Vec3,
  forward: Vec3,
): Pick<CameraState, "position" | "target" | "fov"> {
  const flat = norm(v(forward.x, 0, forward.z));
  const fwd = len(flat) < 1e-4 ? v(0, 0, 1) : flat;
  const right = norm(cross(v(0, 1, 0), fwd));
  const place = (offset: Vec3, fov: number, look: Vec3 = focus) => ({
    position: add(focus, offset),
    target: look,
    fov,
  });
  switch (preset) {
    case "front":
      return place(add(mul(fwd, 3.3), v(0, 0.35, 0)), 38);
    case "three-quarter":
      return place(add(mul(norm(add(fwd, mul(right, 0.85))), 3.5), v(0, 0.7, 0)), 36);
    case "high":
      return place(add(mul(fwd, 2.6), v(0, 2.3, 0)), 40);
    case "low":
      return place(add(mul(fwd, 2.5), v(0, -0.55, 0)), 34, add(focus, v(0, 0.15, 0)));
    case "overhead":
      return place(add(mul(fwd, 0.45), v(0, 4.4, 0)), 42);
    case "profile":
      return place(add(mul(right, 3.2), v(0, 0.35, 0)), 38);
    case "close":
      return place(add(mul(fwd, 1.15), v(0, 0.12, 0)), 30);
    case "wide":
      return place(add(mul(fwd, 6.4), v(0, 1.5, 0)), 48);
  }
}

export function formatFocal(fov: number): string {
  return `${fmtNum(focalLengthMm(fov), 0)} mm`;
}
