import { create } from "zustand";
import type { CameraState } from "@/planner/camera";
import type { MotionClip, MotionKind } from "@/planner/motion";
import { sanitizeMotion } from "@/planner/motion";
import {
  applyPreset,
  createCharacter,
  createMotion,
  createProject,
  createProp,
  duplicateCharacter,
  duplicateProp,
  nextCharacterName,
  placeOnProp,
  type Character,
  type Project,
  type Prop,
} from "@/planner/project";
import type { PropKind } from "@/planner/props";
import { applyGroupPreset, type GroupPreset } from "@/planner/group-presets";
import { propSpec } from "@/planner/props";
import { clampPose, clampJoint, lowestJointDelta, worldJoints, type JointId, type PresetId } from "@/planner/skeleton";
import type { EulerDeg, Vec3 } from "@/planner/math";

export type Tool = "move" | "rotate" | "scale" | "pose";
export type ViewMode = "split" | "scene" | "camera";
export type ControlMode = "workspace" | "camera" | "character" | "object" | "path";
export type Selection =
  | { type: "character"; id: string }
  | { type: "prop"; id: string }
  | { type: "camera" }
  | { type: "target" }
  | null;

type Snap = { project: Project; selection: Selection; joint: JointId | null };

const initial = createProject("Untitled shot");

type DragValue = {
  position?: Vec3;
  rotation?: EulerDeg;
  scale?: Vec3;
  pose?: Character["pose"];
  camera?: CameraState;
};

export type PlannerState = {
  project: Project;
  selection: Selection;
  joint: JointId | null;
  tool: Tool;
  controlMode: ControlMode;
  pathAxis: "horizontal" | "vertical";
  view: ViewMode;
  past: Snap[];
  future: Snap[];
  gesture: Snap | null;
  time: number;
  playing: boolean;
  status: string;
  replaceProject: (project: Project, status?: string) => void;
  select: (selection: Selection) => void;
  setJoint: (joint: JointId | null) => void;
  setTool: (tool: Tool) => void;
  setControlMode: (mode: ControlMode) => void;
  setPathAxis: (axis: "horizontal" | "vertical") => void;
  setView: (view: ViewMode) => void;
  setTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setStatus: (status: string) => void;
  undo: () => void;
  redo: () => void;
  begin: () => void;
  end: () => void;
  commit: (recipe: (project: Project) => void, selection?: Selection) => void;
  preview: (recipe: (project: Project) => void) => void;
  addCharacter: () => void;
  addProp: (kind: PropKind) => void;
  duplicateSelection: () => void;
  deleteSelection: () => void;
  applyPose: (preset: PresetId) => void;
  applyGroup: (preset: GroupPreset) => void;
  placeSelectedOn: (propId: string, mode: "sit" | "lie-up" | "lie-down" | "lie-side") => void;
  snapSelected: () => void;
  patchCharacter: (id: string, patch: Partial<Character>, history?: boolean) => void;
  patchProp: (id: string, patch: Partial<Prop>, history?: boolean) => void;
  setJointEuler: (id: string, joint: JointId, euler: EulerDeg, history?: boolean) => void;
  patchCamera: (patch: Partial<CameraState>, history?: boolean) => void;
  addClip: (kind: MotionKind) => void;
  updateClip: (id: string, patch: Partial<MotionClip>, history?: boolean) => void;
  deleteClip: (id: string) => void;
  resetScene: () => void;
  applyDrag: (value: DragValue, history: boolean) => void;
};

function take(state: PlannerState): Snap {
  return {
    project: structuredClone(state.project),
    selection: state.selection,
    joint: state.joint,
  };
}

function edit(
  state: PlannerState,
  recipe: (project: Project) => void,
  history: boolean,
  selection?: Selection,
): Partial<PlannerState> {
  const before = history && !state.gesture ? take(state) : null;
  const project = structuredClone(state.project);
  recipe(project);
  const next: Partial<PlannerState> = { project };
  if (selection) next.selection = selection;
  if (before) {
    next.past = [...state.past, before].slice(-50);
    next.future = [];
    next.gesture = null;
  }
  return next;
}

export const usePlanner = create<PlannerState>((set, get) => ({
  project: initial,
  selection: { type: "character", id: initial.characters[0]!.id },
  joint: "chest",
  tool: "move",
  controlMode: "workspace",
  pathAxis: "horizontal",
  view: "split",
  past: [],
  future: [],
  gesture: null,
  time: 0,
  playing: false,
  status: "Ready",
  replaceProject: (project, status = "Project loaded") => {
    const first = project.characters[0]?.id;
    set({
      project,
      selection: first ? { type: "character", id: first } : { type: "camera" },
      joint: "chest",
      past: [],
      future: [],
      gesture: null,
      time: 0,
      playing: false,
      status,
    });
  },
  select: (selection) => set({ selection }),
  setJoint: (joint) => set({ joint, tool: joint ? "pose" : get().tool }),
  setTool: (tool) => set({ tool }),
  setPathAxis: (pathAxis) => set({ pathAxis }),
  setControlMode: (controlMode) => set((state) => {
    // Switching modes also selects the object type that this mode manipulates.
    // Without this, Camera mode can accidentally keep nudging a character.
    let selection = state.selection;
    let joint = state.joint;
    let tool = state.tool;
    if (controlMode === "camera" || controlMode === "path") {
      selection = { type: "camera" };
      joint = null;
      tool = "move";
    } else if (controlMode === "character") {
      const selectedId = state.selection?.type === "character" ? state.selection.id : null;
      const selected = selectedId !== null && state.project.characters.some((person) => person.id === selectedId);
      selection = selected && selectedId ? { type: "character", id: selectedId }
        : state.project.characters[0] ? { type: "character", id: state.project.characters[0].id } : null;
      tool = "pose";
      if (!selected) joint = null;
    } else if (controlMode === "object") {
      const selectedId = state.selection?.type === "prop" ? state.selection.id : null;
      const selected = selectedId !== null && state.project.props.some((prop) => prop.id === selectedId);
      selection = selected && selectedId ? { type: "prop", id: selectedId }
        : state.project.props[0] ? { type: "prop", id: state.project.props[0].id } : null;
      joint = null;
      tool = "move";
    }
    return { controlMode, selection, joint, tool,
      status: `${controlMode[0]!.toUpperCase()}${controlMode.slice(1)} controls active` };
  }),
  setView: (view) => set({ view }),
  setTime: (time) => set({ time: Math.max(0, Math.min(get().project.duration, time)) }),
  setPlaying: (playing) => set({ playing }),
  setStatus: (status) => set({ status }),
  undo: () => {
    const state = get();
    const prev = state.past[state.past.length - 1];
    if (!prev) return;
    set({
      project: structuredClone(prev.project),
      selection: prev.selection,
      joint: prev.joint,
      past: state.past.slice(0, -1),
      future: [take(state), ...state.future].slice(0, 50),
      gesture: null,
      status: "Undone",
    });
  },
  redo: () => {
    const state = get();
    const next = state.future[0];
    if (!next) return;
    set({
      project: structuredClone(next.project),
      selection: next.selection,
      joint: next.joint,
      past: [...state.past, take(state)].slice(-50),
      future: state.future.slice(1),
      gesture: null,
      status: "Redone",
    });
  },
  begin: () => {
    if (get().gesture) return;
    set({ gesture: take(get()) });
  },
  end: () => {
    const state = get();
    if (!state.gesture) return;
    const changed = JSON.stringify(state.gesture.project) !== JSON.stringify(state.project);
    set({
      gesture: null,
      past: changed ? [...state.past, state.gesture].slice(-50) : state.past,
      future: changed ? [] : state.future,
    });
  },
  commit: (recipe, selection) => set((state) => edit(state, recipe, true, selection)),
  preview: (recipe) => set((state) => edit(state, recipe, false)),
  addCharacter: () =>
    set((state) => {
      let id = "";
      const partial = edit(
        state,
        (project) => {
          const character = createCharacter({
            name: nextCharacterName(project),
            position: { x: project.characters.length * 0.75, y: 0, z: 0 },
          });
          id = character.id;
          project.characters.push(character);
        },
        true,
      );
      return { ...partial, selection: { type: "character", id } };
    }),
  addProp: (kind) =>
    set((state) => {
      let id = "";
      const partial = edit(
        state,
        (project) => {
          const count = project.props.filter((prop) => prop.kind === kind).length + 1;
          const spec = propSpec(kind);
          const prop = createProp(kind, {
            name: count > 1 ? `${spec.label} ${count}` : spec.label,
            position: {
              x: 0.85 + (project.props.length % 4) * 0.35,
              y: kind === "plane" ? 0.01 : spec.size.y / 2,
              z: -0.6 - Math.floor(project.props.length / 4) * 0.4,
            },
          });
          id = prop.id;
          project.props.push(prop);
        },
        true,
      );
      return { ...partial, selection: { type: "prop", id } };
    }),
  duplicateSelection: () => {
    const state = get();
    if (state.selection?.type === "character") {
      const copy = duplicateCharacter(state.project, state.selection.id);
      if (!copy) return;
      set((current) => ({
        ...edit(current, (project) => project.characters.push(structuredClone(copy)), true),
        selection: { type: "character" as const, id: copy.id },
      }));
    } else if (state.selection?.type === "prop") {
      const copy = duplicateProp(state.project, state.selection.id);
      if (!copy) return;
      set((current) => ({
        ...edit(current, (project) => project.props.push(structuredClone(copy)), true),
        selection: { type: "prop" as const, id: copy.id },
      }));
    }
  },
  deleteSelection: () =>
    set((state) => {
      if (!state.selection || state.selection.type === "camera" || state.selection.type === "target") return {};
      const id = state.selection.id;
      const type = state.selection.type;
      let selection: Selection = { type: "camera" };
      const partial = edit(state, (project) => {
        if (type === "character") project.characters = project.characters.filter((character) => character.id !== id);
        if (type === "prop") project.props = project.props.filter((prop) => prop.id !== id);
        selection = project.characters[0]
          ? { type: "character", id: project.characters[0].id }
          : project.props[0]
            ? { type: "prop", id: project.props[0].id }
            : { type: "camera" };
      }, true);
      return { ...partial, selection };
    }),
  applyPose: (preset) =>
    set((state) => {
      if (state.selection?.type !== "character") return {};
      const id = state.selection.id;
      return edit(state, (project) => {
        const character = project.characters.find((item) => item.id === id);
        if (character) applyPreset(character, preset, preset !== "sit" && preset !== "lean");
      }, true);
    }),
  applyGroup: (preset) => set((state) => edit(state, (project) => applyGroupPreset(project, preset), true)),
  placeSelectedOn: (propId, mode) =>
    set((state) => {
      if (state.selection?.type !== "character") return {};
      const id = state.selection.id;
      return edit(state, (project) => {
        const character = project.characters.find((item) => item.id === id);
        const prop = project.props.find((item) => item.id === propId);
        if (character && prop) placeOnProp(character, prop, mode);
      }, true);
    }),
  snapSelected: () =>
    set((state) => {
      if (state.selection?.type !== "character") return {};
      const id = state.selection.id;
      return edit(state, (project) => {
        const character = project.characters.find((item) => item.id === id);
        if (!character) return;
        const points = Object.values(
          worldJoints(character.pose, character.position, character.rotation, character.scale),
        );
        character.position = {
          x: character.position.x,
          y: character.position.y + lowestJointDelta(points),
          z: character.position.z,
        };
      }, true);
    }),
  patchCharacter: (id, patch, history = true) =>
    set((state) =>
      edit(state, (project) => {
        const character = project.characters.find((item) => item.id === id);
        if (character) Object.assign(character, patch);
      }, history),
    ),
  patchProp: (id, patch, history = true) =>
    set((state) =>
      edit(state, (project) => {
        const prop = project.props.find((item) => item.id === id);
        if (prop) Object.assign(prop, patch);
      }, history),
    ),
  setJointEuler: (id, joint, euler, history = false) =>
    set((state) =>
      edit(state, (project) => {
        const character = project.characters.find((item) => item.id === id);
        if (!character) return;
        character.pose = { ...character.pose, [joint]: clampJoint(joint, euler, character.jointLimits) };
      }, history),
    ),
  patchCamera: (patch, history = true) =>
    set((state) =>
      edit(state, (project) => {
        project.camera = { ...project.camera, ...patch };
      }, history),
    ),
  addClip: (kind) =>
    set((state) =>
      edit(state, (project) => {
        const start = Math.min(project.duration - 0.5, Math.max(0, state.time));
        project.motions.push(createMotion(kind, Math.round(start * 10) / 10));
      }, true),
    ),
  updateClip: (id, patch, history = true) =>
    set((state) =>
      edit(state, (project) => {
        const clip = project.motions.find((item) => item.id === id);
        if (!clip) return;
        Object.assign(clip, patch);
        if (clip.kind === "path" && (!clip.waypoints || clip.waypoints.length < 2)) {
          clip.waypoints = [
            { t: 0, offset: { x: 0, y: 0, z: 0 } },
            { t: 0.5, offset: { x: 0, y: 1.3, z: 0 } },
            { t: 1, offset: { x: 0, y: 0, z: 0 } },
          ];
        }
        const clean = sanitizeMotion(clip);
        clip.direction = clean.direction;
        clip.amount = clean.amount;
      }, history),
    ),
  deleteClip: (id) =>
    set((state) =>
      edit(state, (project) => {
        project.motions = project.motions.filter((clip) => clip.id !== id);
      }, true),
    ),
  resetScene: () =>
    set((state) => {
      const fresh = createProject(state.project.name);
      fresh.id = state.project.id;
      fresh.profile = state.project.profile;
      fresh.mode = state.project.mode;
      return {
        project: fresh,
        selection: { type: "character", id: fresh.characters[0]!.id },
        joint: "chest",
        past: [...state.past, take(state)].slice(-50),
        future: [],
        time: 0,
        playing: false,
        status: "Scene reset",
        gesture: null,
      };
    }),
  applyDrag: (value, history) =>
    set((state) => {
      const selection = state.selection;
      return edit(state, (project) => {
        if (value.camera) project.camera = value.camera;
        if (!selection) return;
        if (selection.type === "character") {
          const character = project.characters.find((item) => item.id === selection.id);
          if (!character) return;
          if (value.position) character.position = { ...value.position };
          if (value.rotation) character.rotation = { ...value.rotation };
          if (value.scale) character.scale = { ...value.scale };
          if (value.pose) {
            character.pose = character.jointLimits ? clampPose(value.pose, true) : value.pose;
          }
        } else if (selection.type === "prop") {
          const prop = project.props.find((item) => item.id === selection.id);
          if (!prop) return;
          if (value.position) prop.position = { ...value.position };
          if (value.rotation) prop.rotation = { ...value.rotation };
          if (value.scale) prop.scale = { ...value.scale };
        } else if (selection.type === "camera" && value.position) {
          project.camera = { ...project.camera, position: { ...value.position } };
        } else if (selection.type === "target" && value.position) {
          project.camera = { ...project.camera, target: { ...value.position } };
        }
      }, history);
    }),
}));
