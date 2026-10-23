import {
  ASPECT_VALUE,
  focalLengthMm,
  formatFocal,
  horizontalFov,
  type CameraState,
} from "./camera.ts";
import {
  cameraSummary,
  classifyPose,
  facingPhrase,
  relationsFor,
  resolvedPhrase,
  supportFor,
  type SceneCharacter,
  type SceneProp,
} from "./detect.ts";
import { fmtNum } from "./math.ts";
import {
  MOTION_LABEL,
  motionClass,
  resolveCamera,
  validateMotions,
  type MotionClip,
} from "./motion.ts";
import { significantBends, JOINT_LABEL } from "./skeleton.ts";

export type PromptProfile = "h3max" | "wan3";
export type PromptMode = "simple" | "detailed";

export type PromptProject = {
  duration: number;
  characters: SceneCharacter[];
  props: SceneProp[];
  camera: CameraState;
  motions: MotionClip[];
  profile: PromptProfile;
  mode: PromptMode;
};

function subjectHeight(characters: SceneCharacter[]): number {
  if (characters.length === 0) return 1.7;
  const avg =
    characters.reduce((sum, character) => sum + 1.72 * character.scale.y, 0) / characters.length;
  return Math.max(0.4, avg);
}

function averageForward(characters: SceneCharacter[]) {
  if (characters.length === 0) return { x: 0, y: 0, z: 1 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const character of characters) {
    const basis = classifyPose(character);
    x += basis.forward.x;
    y += basis.forward.y;
    z += basis.forward.z;
  }
  return { x, y, z };
}

function focusOf(characters: SceneCharacter[], fallback: { x: number; y: number; z: number }) {
  if (characters.length === 0) return fallback;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const character of characters) {
    const hip = classifyPose(character).joints.hips;
    x += hip.x;
    y += hip.y;
    z += hip.z;
  }
  const n = characters.length;
  return { x: x / n, y: y / n, z: z / n };
}

function describeClip(clip: MotionClip, mode: PromptMode): string {
  const span = `${fmtNum(clip.start)}–${fmtNum(clip.start + clip.duration)}s`;
  const amount = fmtNum(clip.amount);
  switch (clip.kind) {
    case "pan":
      return `${span}: pan ${clip.direction} ${amount}°. The camera rotates in place and does not move.`;
    case "tilt":
      return `${span}: tilt ${clip.direction} ${amount}°. The camera rotates in place and does not move.`;
    case "orbit":
      return `${span}: orbit ${clip.direction === "cw" ? "clockwise" : "counter-clockwise"} ${amount}° around the target. The camera moves. The lens does not zoom.`;
    case "dolly":
      if (clip.direction === "in" || clip.direction === "out") {
        return `${span}: dolly ${clip.direction} ${amount} m. The camera physically moves ${clip.direction === "in" ? "closer to" : "farther from"} the subject. This is not a zoom.`;
      }
      return `${span}: track ${clip.direction} ${amount} m. The camera moves sideways. This is not a pan.`;
    case "zoom":
      return `${span}: optical zoom ${clip.direction} by ${amount}° of vertical field of view. The camera stays in place. Only the lens changes.`;
    case "return":
      return `${span}: ease back to the base framing marked in the planner.`;
    case "hold":
      return `${span}: hold the framing. No move, rotation, or zoom.`;
    case "static":
      return `${span}: static camera. No move, rotation, or zoom.`;
    case "path": {
      const pts = (clip.waypoints ?? []).map((p, i) => `${i + 1}: at ${fmtNum(clip.start + p.t * clip.duration)}s, camera displacement X ${fmtNum(p.offset.x, 2)} m, height Y ${fmtNum(p.offset.y, 2)} m, depth Z ${fmtNum(p.offset.z, 2)} m`);
      return `${span}: physically move the camera along a custom, smooth path relative to the original position: ${pts.join("; ")}. These are camera positions, not lens zooms or pan rotations.`;
    }
    default:
      return mode === "detailed" ? `${span}: ${MOTION_LABEL[clip.kind]}.` : `${span}: camera note.`;
  }
}

function characterBlock(character: SceneCharacter, props: SceneProp[], mode: PromptMode): string[] {
  const phrase = resolvedPhrase(character);
  const pose = classifyPose(character);
  const support = supportFor(character, props);
  const lines: string[] = [];
  let poseText = phrase.text;
  if (support && phrase.source === "auto" && phrase.confidence === "high") {
    if (support.how === "sitting-on") poseText = `sitting on the ${support.name}`;
    if (support.how === "lying-on") poseText = `${phrase.text} on the ${support.name}`;
  } else if (support && phrase.source === "user") {
    poseText = `${phrase.text}. The rig places them on the ${support.name}`;
  }
  const facing = facingPhrase(pose.forward);
  const hip = pose.joints.hips;
  lines.push(
    `${character.name} is ${poseText}, facing ${facing}.`,
  );
  if (phrase.confidence === "low" && phrase.source === "auto") {
    lines.push(
      `The pose of ${character.name} is not clear from the joints. Do not invent a more specific action.`,
    );
  }
  if (mode === "detailed") {
    lines.push(
      `Root position ${fmtNum(character.position.x, 2)}, ${fmtNum(character.position.y, 2)}, ${fmtNum(character.position.z, 2)} m. Hips at ${fmtNum(hip.x, 2)}, ${fmtNum(hip.y, 2)}, ${fmtNum(hip.z, 2)} m. Scale ${fmtNum(character.scale.x, 2)} × ${fmtNum(character.scale.y, 2)} × ${fmtNum(character.scale.z, 2)}.`,
    );
    const bends = significantBends(character.pose);
    if (bends.length) {
      const bits = bends
        .slice(0, 8)
        .map((bend) => `${JOINT_LABEL[bend.id]} ${fmtNum(bend.euler.x)}/${fmtNum(bend.euler.y)}/${fmtNum(bend.euler.z)}`);
      lines.push(`Notable joint rotations (bend/twist/side °): ${bits.join("; ")}.`);
    }
  }
  if (character.relationNote.trim()) {
    lines.push(`Stated by the user for ${character.name}: ${character.relationNote.trim()}`);
  }
  return lines;
}

function propBlock(prop: SceneProp, mode: PromptMode): string {
  const noun = prop.name || prop.kind;
  if (mode === "simple") {
    return `${noun} (${prop.kind}) near ${fmtNum(prop.position.x)}, ${fmtNum(prop.position.z)} on the floor plan, facing ${facingPhrase({ x: Math.sin((prop.rotation.y * Math.PI) / 180), y: 0, z: Math.cos((prop.rotation.y * Math.PI) / 180) })}.`;
  }
  return `${noun}: ${prop.kind}, position ${fmtNum(prop.position.x, 2)}, ${fmtNum(prop.position.y, 2)}, ${fmtNum(prop.position.z, 2)} m, rotation ${fmtNum(prop.rotation.x)}°, ${fmtNum(prop.rotation.y)}°, ${fmtNum(prop.rotation.z)}°, scale ${fmtNum(prop.scale.x, 2)} × ${fmtNum(prop.scale.y, 2)} × ${fmtNum(prop.scale.z, 2)}.`;
}

export function generatePrompt(project: PromptProject): string {
  const duration = project.duration;
  const characters = [...project.characters].sort((a, b) => a.name.localeCompare(b.name));
  const height = subjectHeight(characters);
  const forward = averageForward(characters);
  const focus = focusOf(characters, project.camera.target);
  const summary = cameraSummary(project.camera, focus, forward, height);
  const issues = validateMotions(project.motions, duration);
  const lines: string[] = [];

  if (project.profile === "h3max") {
    lines.push(
      project.mode === "simple"
        ? `${fmtNum(duration, 0)}-second continuous shot.`
        : `${fmtNum(duration, 0)}-second continuous shot. Profile: H3 Max. Describe only the staged poses, placement, and camera.`,
    );
  } else {
    lines.push(
      `${fmtNum(duration, 0)}-second continuous shot. Use plain spatial language. Camera instructions describe what the viewer sees. Do not assume named camera-move tokens.`,
    );
  }

  if (characters.length === 0) {
    lines.push("No characters are in the scene.");
  } else {
    lines.push("");
    lines.push(characters.length === 1 ? "Character:" : "Characters:");
    for (const character of characters) {
      for (const line of characterBlock(character, project.props, project.mode)) lines.push(line);
    }
  }

  const relations = relationsFor(characters);
  if (relations.length) {
    lines.push("");
    lines.push("Spatial relationships:");
    for (const relation of relations) lines.push(relation.text);
  }

  if (project.props.length) {
    lines.push("");
    lines.push("Set:");
    for (const prop of project.props) lines.push(propBlock(prop, project.mode));
  }

  lines.push("");
  lines.push("Camera:");
  const shot = summary.shot;
  lines.push(
    `${shot} shot, ${project.camera.aspect}, ${summary.approach}, ${summary.elevationText}. Distance about ${fmtNum(summary.distance)} m.`,
  );
  if (project.mode === "detailed") {
    const end = resolveCamera(project.camera, project.motions, duration);
    lines.push(
      `Base position ${fmtNum(project.camera.position.x, 2)}, ${fmtNum(project.camera.position.y, 2)}, ${fmtNum(project.camera.position.z, 2)} m. Target ${fmtNum(project.camera.target.x, 2)}, ${fmtNum(project.camera.target.y, 2)}, ${fmtNum(project.camera.target.z, 2)} m.`,
    );
    lines.push(
      `Elevation ${fmtNum(summary.elevation)}°. Vertical FOV ${fmtNum(project.camera.fov)}° (about ${formatFocal(project.camera.fov)} on a 24 mm sensor height). Horizontal FOV ${fmtNum(horizontalFov(project.camera.fov, ASPECT_VALUE[project.camera.aspect]))}°. Roll ${fmtNum(project.camera.roll)}°.`,
    );
    if (end.positionDelta > 0.02 || end.fovDelta > 0.2) {
      lines.push(
        `At ${fmtNum(duration)}s the camera is at ${fmtNum(end.position.x, 2)}, ${fmtNum(end.position.y, 2)}, ${fmtNum(end.position.z, 2)} m, FOV ${fmtNum(end.fov)}°, focal length about ${fmtNum(focalLengthMm(end.fov), 0)} mm.`,
      );
    }
  } else if (Math.abs(project.camera.roll) > 1) {
    lines.push(`Dutch roll about ${fmtNum(project.camera.roll)}°.`);
  }

  lines.push("");
  lines.push("Motion:");
  if (issues.length) {
    lines.push("Timeline has errors. Fix them before trusting the move list.");
    for (const issue of issues) lines.push(issue.message);
  }
  const clips = [...project.motions].sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
  if (clips.length === 0) {
    lines.push(
      `The camera holds this framing for the full ${fmtNum(duration, 0)} seconds. It does not move, rotate, or zoom.`,
    );
  } else {
    const classes = new Set(clips.map((clip) => motionClass(clip.kind)));
    for (const clip of clips) lines.push(describeClip(clip, project.mode));
    if (classes.has("move") && classes.has("zoom")) {
      lines.push("A camera move and an optical zoom both occur. Keep them distinct.");
    }
    if (classes.has("rotate") && !classes.has("move")) {
      lines.push("Any pan or tilt is rotation only. The camera body stays put.");
    }
  }

  lines.push("");
  lines.push(
    "Do not add contact, actions, or emotions that are not stated above. Hands have no individual finger pose. Faces have no expression.",
  );

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
