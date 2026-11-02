/** Human-readable controls for the actual video camera, independent of the editor view. */
import type { CameraState } from "./camera.ts";
import { add, clamp, cross, dist, len, mul, norm, sub, v, type Vec3 } from "./math.ts";

export type ShotAction =
  | "aim-left" | "aim-right" | "aim-up" | "aim-down"
  | "slide-left" | "slide-right" | "rise" | "lower"
  | "closer" | "further" | "zoom-in" | "zoom-out";

export function shotBasis(camera: CameraState): { forward: Vec3; right: Vec3; up: Vec3 } {
  let forward = norm(sub(camera.target, camera.position));
  if (len(forward) < 0.00001) forward = v(0, 0, -1);
  let right = norm(cross(forward, v(0, 1, 0)));
  if (len(right) < 0.00001) right = v(1, 0, 0);
  return { forward, right, up: norm(cross(right, forward)) };
}

/** Move or aim relative to what the photographer sees, not fixed world X/Y/Z. */
export function adjustShot(camera: CameraState, action: ShotAction, step = 0.15): CameraState {
  const { forward, right, up } = shotBasis(camera);
  const amount = Math.max(0.005, Math.min(2, Math.abs(step)));
  if (action === "zoom-in" || action === "zoom-out") {
    return { ...camera, fov: clamp(camera.fov + (action === "zoom-in" ? -1 : 1) * Math.max(1, amount * 12), 8, 120) };
  }
  if (action === "closer" || action === "further") {
    const d = Math.max(0.26, dist(camera.position, camera.target));
    const targetDistance = clamp(d + (action === "closer" ? -amount : amount), 0.26, 80);
    return { ...camera, position: add(camera.target, mul(forward, -targetDistance)) };
  }
  const vector = action === "aim-left" || action === "slide-left" ? mul(right, -amount)
    : action === "aim-right" || action === "slide-right" ? mul(right, amount)
    : action === "aim-up" || action === "rise" ? mul(up, amount)
    : mul(up, -amount);
  if (action.startsWith("aim")) return { ...camera, target: add(camera.target, vector) };
  return { ...camera, position: add(camera.position, vector), target: add(camera.target, vector) };
}

/** Translate a custom-path waypoint in camera-relative directions. */
export function adjustWaypoint(offset: Vec3, camera: CameraState, direction: "left" | "right" | "up" | "down" | "forward" | "backward", step = 0.15): Vec3 {
  const { forward, right } = shotBasis(camera);
  const vector = direction === "left" ? mul(right, -step)
    : direction === "right" ? mul(right, step)
    : direction === "up" ? v(0, step, 0)
    : direction === "down" ? v(0, -step, 0)
    : direction === "forward" ? mul(v(forward.x, 0, forward.z), step)
    : mul(v(forward.x, 0, forward.z), -step);
  return add(offset, vector);
}
