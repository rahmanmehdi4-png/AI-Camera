import { approachPhrase, elevationDeg, elevationPhrase, shotSize, type CameraState } from "./camera.ts";
import {
  angleBetween,
  compassName,
  dist,
  dot,
  len,
  norm,
  sub,
  v,
  type Vec3,
} from "./math.ts";
import { LIE_KINDS, SEAT_KINDS, pointInAabb, propAabb, propSpec, surfaceY, type PropKind } from "./props.ts";
import {
  bodyBasis,
  worldJoints,
  type JointId,
  type Pose,
} from "./skeleton.ts";
import type { EulerDeg } from "./math.ts";

export const POSE_LABELS = [
  "auto",
  "standing",
  "sitting",
  "kneeling",
  "leaning",
  "lying-face-up",
  "lying-face-down",
  "lying-left",
  "lying-right",
] as const;

export type PoseLabel = (typeof POSE_LABELS)[number];

export const POSE_PHRASE: Record<Exclude<PoseLabel, "auto">, string> = {
  standing: "standing",
  sitting: "sitting",
  kneeling: "kneeling",
  leaning: "leaning forward",
  "lying-face-up": "lying face-up",
  "lying-face-down": "lying face-down",
  "lying-left": "lying on their left side",
  "lying-right": "lying on their right side",
};

export type Confidence = "high" | "low";

export type AutoPose = {
  label: Exclude<PoseLabel, "auto"> | "unclear";
  confidence: Confidence;
};

export type RigInput = {
  pose: Pose;
  position: Vec3;
  rotation: EulerDeg;
  scale: Vec3;
};

export function classifyPose(rig: RigInput): AutoPose & {
  forward: Vec3;
  up: Vec3;
  joints: Record<JointId, Vec3>;
} {
  const joints = worldJoints(rig.pose, rig.position, rig.rotation, rig.scale);
  const basis = bodyBasis(rig.pose, rig.rotation);
  const upDot = basis.up.y;
  const faceDot = basis.forward.y;
  const rightDot = basis.right.y;

  const pack = (label: AutoPose["label"], confidence: Confidence) => ({
    label,
    confidence,
    forward: basis.forward,
    up: basis.up,
    joints,
  });

  if (faceDot > 0.72 && upDot < 0.55) {
    return pack("lying-face-up", faceDot > 0.86 ? "high" : "low");
  }
  if (faceDot < -0.72 && upDot < 0.55) {
    return pack("lying-face-down", faceDot < -0.86 ? "high" : "low");
  }
  if (rightDot > 0.72 && Math.abs(upDot) < 0.55) {
    return pack("lying-left", rightDot > 0.86 ? "high" : "low");
  }
  if (rightDot < -0.72 && Math.abs(upDot) < 0.55) {
    return pack("lying-right", rightDot < -0.86 ? "high" : "low");
  }

  if (upDot > 0.62) {
    const hip = joints.hips;
    const kneeL = joints.shinL;
    const kneeR = joints.shinR;
    const ankleL = joints.footL;
    const ankleR = joints.footR;
    const thighL = norm(sub(kneeL, hip));
    const thighR = norm(sub(kneeR, hip));
    const shinL = norm(sub(ankleL, kneeL));
    const shinR = norm(sub(ankleR, kneeR));
    const bend = (angleBetween(thighL, shinL) + angleBetween(thighR, shinR)) / 2;
    const thighVert = (Math.abs(thighL.y) + Math.abs(thighR.y)) / 2;
    const shinVert = (Math.abs(shinL.y) + Math.abs(shinR.y)) / 2;
    const flatFwd = norm(v(basis.forward.x, 0, basis.forward.z));
    const kneeDirL = norm(v(kneeL.x - hip.x, 0, kneeL.z - hip.z));
    const kneeDirR = norm(v(kneeR.x - hip.x, 0, kneeR.z - hip.z));
    const kneeForward =
      (dot(kneeDirL, flatFwd) + dot(kneeDirR, flatFwd)) / (len(flatFwd) < 1e-4 ? 1 : 1);
    const torso = norm(sub(joints.chest, hip));

    if (thighVert > 0.72 && shinVert < 0.5 && bend > 55) {
      return pack("kneeling", shinVert < 0.35 ? "high" : "low");
    }
    if (bend > 50 && kneeForward > 0.25 && shinVert > 0.45) {
      return pack("sitting", bend > 70 && kneeForward > 0.45 ? "high" : "low");
    }
    if (torso.y < 0.93 && bend < 45 && thighVert > 0.65) {
      return pack("leaning", torso.y < 0.9 ? "high" : "low");
    }
    if (bend < 38 && thighVert > 0.75) {
      return pack("standing", bend < 22 ? "high" : "low");
    }
    return pack("unclear", "low");
  }

  return pack("unclear", "low");
}

export type SceneProp = {
  id: string;
  name: string;
  kind: PropKind;
  position: Vec3;
  rotation: EulerDeg;
  scale: Vec3;
};

export type SceneCharacter = RigInput & {
  id: string;
  name: string;
  poseLabel: PoseLabel;
  relationNote: string;
};

export type SupportHit = { propId: string; name: string; kind: PropKind; how: "sitting-on" | "lying-on" };

export function supportFor(character: SceneCharacter, props: SceneProp[]): SupportHit | null {
  const pose = classifyPose(character);
  const hips = pose.joints.hips;
  let best: SupportHit | null = null;
  let bestGap = Infinity;
  for (const prop of props) {
    const box = propAabb(prop.kind, prop.position, prop.rotation, prop.scale);
    const surface = surfaceY(prop.kind, box);
    const horizontal =
      hips.x >= box.min.x - 0.28 &&
      hips.x <= box.max.x + 0.28 &&
      hips.z >= box.min.z - 0.28 &&
      hips.z <= box.max.z + 0.28;
    if (!horizontal) continue;
    const gap = Math.abs(hips.y - surface);
    if (pose.label === "sitting" && SEAT_KINDS.includes(prop.kind) && hips.y >= surface - 0.2 && hips.y <= surface + 0.55) {
      if (gap < bestGap) {
        best = { propId: prop.id, name: prop.name, kind: prop.kind, how: "sitting-on" };
        bestGap = gap;
      }
    }
    if (
      (pose.label === "lying-face-up" ||
        pose.label === "lying-face-down" ||
        pose.label === "lying-left" ||
        pose.label === "lying-right") &&
      LIE_KINDS.includes(prop.kind) &&
      hips.y >= surface - 0.15 &&
      hips.y <= surface + 0.7 &&
      pointInAabb(v(hips.x, surface, hips.z), box, 0.35)
    ) {
      if (gap < bestGap) {
        best = { propId: prop.id, name: prop.name, kind: prop.kind, how: "lying-on" };
        bestGap = gap;
      }
    }
  }
  return best;
}

export function resolvedPhrase(character: SceneCharacter): { text: string; confidence: Confidence; source: "user" | "auto" } {
  if (character.poseLabel !== "auto") {
    return { text: POSE_PHRASE[character.poseLabel], confidence: "high", source: "user" };
  }
  const auto = classifyPose(character);
  if (auto.label === "unclear") return { text: "in an unclear pose", confidence: "low", source: "auto" };
  return { text: POSE_PHRASE[auto.label], confidence: auto.confidence, source: "auto" };
}

function sidePhrase(from: Vec3, to: Vec3, forward: Vec3): string | null {
  const flat = v(to.x - from.x, 0, to.z - from.z);
  const distance = len(flat);
  if (distance < 0.2) {
    const dy = to.y - from.y;
    if (dy > 0.35) return "above";
    if (dy < -0.35) return "below";
    return "level with";
  }
  const dir = norm(flat);
  const fwd = norm(v(forward.x, 0, forward.z));
  if (len(fwd) < 1e-4) return null;
  const right = norm({ x: fwd.z, y: 0, z: -fwd.x });
  // right = cross(up, forward) = (fz, 0, -fx)? 
  // cross((0,1,0),(fx,0,fz)) = (1*fz - 0*0, 0*fx - 0*fz, 0*0 - 1*fx) = (fz, 0, -fx)
  // If forward is +Z (0,0,1), right = (1, 0, 0). Good. I wrote (fz, 0, -fx) which is (1, 0, 0). Yes.
  const forwardness = dot(dir, fwd);
  const sideness = dot(dir, right);
  const vertical = to.y - from.y;
  const height = vertical > 0.4 ? ", higher" : vertical < -0.4 ? ", lower" : "";
  if (forwardness > 0.55 && Math.abs(forwardness) >= Math.abs(sideness)) return `in front${height}`;
  if (forwardness < -0.55 && Math.abs(forwardness) >= Math.abs(sideness)) return `behind${height}`;
  if (sideness > 0.45) return `to the right${height}`;
  if (sideness < -0.45) return `to the left${height}`;
  if (forwardness > 0.2) return `ahead and to the ${sideness >= 0 ? "right" : "left"}${height}`;
  if (forwardness < -0.2) return `behind and to the ${sideness >= 0 ? "right" : "left"}${height}`;
  return null;
}

export type RelationLine = { text: string; confident: boolean };

export function relationsFor(characters: SceneCharacter[]): RelationLine[] {
  const lines: RelationLine[] = [];
  const analyzed = characters.map((character) => ({ character, pose: classifyPose(character) }));
  for (let i = 0; i < analyzed.length; i++) {
    for (let j = i + 1; j < analyzed.length; j++) {
      const a = analyzed[i]!;
      const b = analyzed[j]!;
      const hipsA = a.pose.joints.hips;
      const hipsB = b.pose.joints.hips;
      const separation = dist(hipsA, hipsB);
      if (separation > 4.5) continue;
      const headA = a.pose.joints.head;
      const headB = b.pose.joints.head;
      const chestA = a.pose.joints.chest;
      const chestB = b.pose.joints.chest;
      const near = (p: Vec3, q: Vec3, limit: number) => dist(p, q) <= limit;

      if (near(headA, chestB, 0.34)) {
        lines.push({
          text: `${a.character.name}'s head is near ${b.character.name}'s chest.`,
          confident: true,
        });
      } else if (near(headB, chestA, 0.34)) {
        lines.push({
          text: `${b.character.name}'s head is near ${a.character.name}'s chest.`,
          confident: true,
        });
      } else if (near(headA, headB, 0.3)) {
        lines.push({
          text: `${a.character.name}'s head is near ${b.character.name}'s head.`,
          confident: true,
        });
      }

      const toB = norm(sub(hipsB, hipsA));
      const aFaces = dot(norm(a.pose.forward), toB) > 0.55;
      const bFaces = dot(norm(b.pose.forward), mulNeg(toB)) > 0.55;
      if (aFaces && bFaces && separation < 3.2 && separation > 0.35) {
        lines.push({
          text: `${a.character.name} and ${b.character.name} are facing one another.`,
          confident: true,
        });
        continue;
      }

      const where = sidePhrase(hipsA, hipsB, a.pose.forward);
      if (where && separation >= 0.25) {
        lines.push({
          text: `${b.character.name} is ${where} ${a.character.name} (${separation < 1 ? "close" : `${separation.toFixed(1)} m hip to hip`}).`,
          confident: separation < 3,
        });
      }
    }
  }
  return lines.slice(0, 8);
}

function mulNeg(p: Vec3): Vec3 {
  return v(-p.x, -p.y, -p.z);
}

export function facingPhrase(forward: Vec3): string {
  return compassName(forward);
}

export function cameraSummary(
  cam: CameraState,
  focus: Vec3,
  subjectForward: Vec3,
  subjectHeight: number,
): {
  distance: number;
  elevation: number;
  shot: ReturnType<typeof shotSize>;
  approach: string;
  elevationText: string;
} {
  const distance = dist(cam.position, cam.target);
  const elevation = elevationDeg(cam);
  return {
    distance,
    elevation,
    shot: shotSize(distance, cam.fov, subjectHeight),
    approach: approachPhrase(cam.position, focus, subjectForward),
    elevationText: elevationPhrase(elevation),
  };
}

export function propNoun(kind: PropKind): string {
  return propSpec(kind).label.toLowerCase();
}
