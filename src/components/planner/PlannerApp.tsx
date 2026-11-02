import { uid } from "@/planner/project";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Clock3,
  Copy,
  Download,
  FolderOpen,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  UserRound,
  Box,
  Focus,
  Move,
  RotateCw,
  Scaling,
  PersonStanding,
  CircleHelp,
  Settings2,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  Hand,
  Route,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Crosshair,
  ListRestart,
} from "lucide-react";
import {
  ASPECTS,
  CAMERA_PRESET_LABEL,
  cameraPreset,
  formatFocal,
  type AspectId,
  type CameraPresetId,
} from "@/planner/camera";
import { adjustShot, adjustWaypoint, type ShotAction } from "@/planner/shot-controls";
import { classifyPose, POSE_LABELS, POSE_PHRASE, type PoseLabel } from "@/planner/detect";
import { validateMotions, insertPathWaypoint, MOTION_KINDS, MOTION_LABEL, amountUnit, directionsFor, type MotionKind } from "@/planner/motion";
import { generatePrompt } from "@/planner/prompt";
import {
  groupFocus,
  headFocus,
  projectFromJson,
  projectToJson,
  toSceneCharacter,
  toSceneProp,
} from "@/planner/project";
import { PROP_LIBRARY, type PropKind } from "@/planner/props";
import { ADULT_GROUP_PRESETS, SOLO_ADULT_PRESETS, GROUP_PRESETS, applySoloAdultPreset, type GroupPreset } from "@/planner/group-presets";
import { PresetScenePreview } from "./PresetScenePreview";
import { deleteStoredProject, listProjects, loadLastProject, saveProject, type StoredProject } from "@/planner/storage";
import { JOINT_GROUPS, JOINT_LABEL, PRESET_LABEL, type JointId, type PresetId } from "@/planner/skeleton";
import { blobBytes, buildZip, downloadBlob } from "@/planner/zip";
import { usePlanner, type Tool, type ViewMode, type ControlMode } from "@/state/planner-store";
import { Viewport, type ViewportHandle } from "@/three/viewport";

const TOOLS: { id: Tool; label: string; icon: typeof Move }[] = [
  { id: "move", label: "Move", icon: Move },
  { id: "rotate", label: "Rotate", icon: RotateCw },
  { id: "scale", label: "Scale", icon: Scaling },
  { id: "pose", label: "Pose", icon: PersonStanding },
];

const MODES: { id: ControlMode; label: string; description: string; icon: typeof Move }[] = [
  { id: "workspace", label: "Explore", description: "Move your viewpoint: orbit with one finger, pinch to zoom, two fingers to pan. Objects stay put.", icon: Hand },
  { id: "character", label: "People", description: "Tap a person, select joints or pose the whole body.", icon: PersonStanding },
  { id: "camera", label: "Camera", description: "Move and aim your virtual shot camera. This changes the generated video instructions.", icon: Camera },
  { id: "object", label: "Props", description: "Adjust furniture or scene objects without accidentally moving a person.", icon: Box },
  { id: "path", label: "Movement", description: "Edit the camera timeline and preview its path.", icon: Route },
];

const MOTION_EXPLAIN: Record<MotionKind, string> = {
  static: "Keep the camera completely still.",
  pan: "Turn left/right from one spot; the camera does not travel.",
  tilt: "Point the camera up/down without changing its position.",
  orbit: "Move around your subject while looking toward it.",
  dolly: "Move the whole camera forward, backward or sideways.",
  zoom: "Change the lens field of view, not the camera position.",
  hold: "Pause the camera movement and hold the framing.",
  return: "Smoothly return to the original camera position and framing.",
  path: "Set multiple points that the camera visits, with exact positions and times.",
};

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "scene", label: "Scene" },
  { id: "split", label: "Split" },
  { id: "camera", label: "Shot" },
];

export function PlannerApp() {
  const store = usePlanner();
  const viewRef = useRef<ViewportHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [poseSearch, setPoseSearch] = useState("");
  const [poseCount, setPoseCount] = useState(2);
  const [showAdultPresets, setShowAdultPresets] = useState(false);
  const [previewPreset, setPreviewPreset] = useState<GroupPreset | null>(null);
  const [customLayouts, setCustomLayouts] = useState<{name:string; members:ReturnType<typeof usePlanner.getState>["project"]["characters"]}[]>(() => {
    try { return JSON.parse(localStorage.getItem("camera-planner:v2:custom-poses") || "[]"); } catch { return []; }
  });
  const [mobile, setMobile] = useState<"library" | "pose" | "camera" | "time" | "export" | null>(null);
  const [help, setHelp] = useState(false);
  const [helpMode, setHelpMode] = useState(false);
  const [controlHelp, setControlHelp] = useState<string | null>(null);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [resetMenu, setResetMenu] = useState(false);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [nudgeStep, setNudgeStep] = useState(0.1);
  const [nudgeAxis, setNudgeAxis] = useState<"position" | "rotation" | "joint">("position");
  const [projects, setProjects] = useState<StoredProject[] | null>(null);
  const [clipId, setClipId] = useState<string | null>(null);
  const { project } = store;

  const prompt = useMemo(
    () =>
      generatePrompt({
        duration: project.duration,
        characters: project.characters.map(toSceneCharacter),
        props: project.props.map(toSceneProp),
        camera: project.camera,
        motions: project.motions,
        profile: project.profile,
        mode: "detailed",
      }),
    [project],
  );
  const issues = validateMotions(project.motions, project.duration);

  useEffect(() => {
    let cancel = false;
    loadLastProject()
      .then((saved) => {
        if (cancel || !saved) return;
        store.replaceProject(saved, "Restored the last shot");
      })
      .catch(() => store.setStatus("Could not read the saved shot"));
    if (window.innerWidth < 1024) store.setView("scene");
    return () => {
      cancel = true;
    };
    // Restore once when the editor mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const current = usePlanner.getState();
      saveProject(current.project)
        .then(() => current.setStatus("Saved on this device"))
        .catch(() => current.setStatus("Could not save on this device"));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        const api = usePlanner.getState();
        if (event.shiftKey) api.redo();
        else api.undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        usePlanner.getState().duplicateSelection();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        usePlanner.getState().deleteSelection();
      } else if (event.key === " ") {
        event.preventDefault();
        const api = usePlanner.getState();
        api.setPlaying(!api.playing);
      } else if (event.key.toLowerCase() === "f") {
        viewRef.current?.frame();
      } else if (event.key === "1") usePlanner.getState().setTool("move");
      else if (event.key === "2") usePlanner.getState().setTool("rotate");
      else if (event.key === "3") usePlanner.getState().setTool("scale");
      else if (event.key === "4") usePlanner.getState().setTool("pose");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selection = store.selection;

  function nudge(axis: "x" | "y" | "z", amount: number) {
    const value = amount * (nudgeAxis === "position" ? nudgeStep : Math.max(1, nudgeStep * 100));
    const selected = store.selection;
    if (nudgeAxis === "joint") {
      if (selected?.type !== "character" || !store.joint) { store.setStatus("Select a character joint first"); return; }
      const person = project.characters.find((p) => p.id === selected.id);
      if (person) store.setJointEuler(person.id, store.joint, { ...person.pose[store.joint], [axis]: person.pose[store.joint][axis] + value }, true);
    } else if (selected?.type === "character") {
      const person = project.characters.find((p) => p.id === selected.id);
      if (person) {
        const field = nudgeAxis;
        store.patchCharacter(person.id, { [field]: { ...person[field], [axis]: person[field][axis] + value } }, true);
      }
    } else if (selected?.type === "prop") {
      const prop = project.props.find((p) => p.id === selected.id);
      if (prop) {
        const field = nudgeAxis;
        store.patchProp(prop.id, { [field]: { ...prop[field], [axis]: prop[field][axis] + value } }, true);
      }
    } else if (selected?.type === "camera" || selected?.type === "target" || !selected) {
      if (nudgeAxis === "position") {
        const camera = project.camera;
        if (selected?.type === "target") {
          store.patchCamera({ target: { ...camera.target, [axis]: camera.target[axis] + value } }, true);
        } else {
          store.patchCamera({ position: { ...camera.position, [axis]: camera.position[axis] + value } }, true);
        }
      } else store.setStatus("Select Position to nudge the shot camera or aim point");
    }
  }
  function activateMode(mode: ControlMode) {
    store.setControlMode(mode);
    if (mode === "camera") store.select({type:"camera"});
    if (mode === "path") setMobile("time");
    if (mode === "character" && store.selection?.type !== "character" && project.characters[0]) store.select({ type:"character",id:project.characters[0].id });
    if (mode === "object" && project.props[0]) store.select({ type:"prop", id:project.props[0].id });
  }

  const selectedCharacter =
    selection?.type === "character"
      ? project.characters.find((character) => character.id === selection.id)
      : undefined;
  const selectedProp =
    selection?.type === "prop" ? project.props.find((prop) => prop.id === selection.id) : undefined;
  const reading = selectedCharacter ? classifyPose(selectedCharacter) : null;

  async function exportPack() {
    const view = viewRef.current;
    if (!view) return;
    if(issues.length){store.setStatus("Fix the camera timeline errors before exporting: "+issues[0]!.message);return;}
    store.setStatus("Rendering start, middle and end shot references…");
    try {
      const pose = await view.capture("pose",0);
      const shot = await view.capture("camera",0);
      const mid = await view.capture("camera",project.duration*0.5);
      const end = await view.capture("camera",project.duration);
      const annotated = await view.capture("annotated",0);
      const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shot";
      const zip = buildZip([
        { name: "instructions.txt", data: new TextEncoder().encode(prompt) },
        { name: "pose-reference.png", data: await blobBytes(pose) },
        { name: "camera-view.png", data: await blobBytes(shot) },
        { name: "camera-mid.png", data: await blobBytes(mid) },
        { name: "camera-end.png", data: await blobBytes(end) },
        { name: "annotated-scene.png", data: await blobBytes(annotated) },
        { name: "project.json", data: new TextEncoder().encode(projectToJson(project)) },
      ]);
      downloadBlob(zip, `${slug}-grok.zip`);
      try {
        await navigator.clipboard.writeText(prompt);
        store.setStatus("Exported the Grok package and copied the instructions");
      } catch {
        store.setStatus("Exported the Grok package");
      }
    } catch (error) {
      store.setStatus(error instanceof Error ? error.message : "Export failed");
    }
  }

  async function saveShot(kind: "pose" | "camera" | "annotated", filename: string) {
    try {
      const blob = await viewRef.current?.capture(kind);
      if (!blob) return;
      downloadBlob(blob, filename);
      store.setStatus("Screenshot saved");
    } catch (error) {
      store.setStatus(error instanceof Error ? error.message : "Screenshot failed");
    }
  }

  const library = (
    <div className="flex flex-col gap-4 p-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Library</span>
        <input className="field" value={query} placeholder="Search objects" onChange={(event) => setQuery(event.target.value)} />
      </label>
      <button className="btn" type="button" onClick={() => store.addCharacter()}>
        <Plus className="size-4" /> Add person
      </button>
      {(["Primitives", "Furniture", "Room"] as const).map((category) => {
        const items = PROP_LIBRARY.filter(
          (item) => item.category === category && item.label.toLowerCase().includes(query.toLowerCase()),
        );
        if (!items.length) return null;
        return (
          <div key={category} className="flex flex-col gap-2">
            <h2 className="text-xs font-medium tracking-wide text-muted uppercase">{category}</h2>
            <div className="grid grid-cols-2 gap-2">
              {items.map((item) => (
                <button key={item.kind} className="btn" type="button" onClick={() => store.addProp(item.kind as PropKind)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex flex-col gap-1">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">In the scene</h2>
        {project.characters.map((character) => (
          <button
            key={character.id}
            className="btn justify-start"
            data-on={store.selection?.type === "character" && store.selection.id === character.id}
            type="button"
            onClick={() => store.select({ type: "character", id: character.id })}
          >
            <UserRound className="size-4" /> {character.name}
          </button>
        ))}
        {project.props.map((prop) => (
          <button
            key={prop.id}
            className="btn justify-start"
            data-on={store.selection?.type === "prop" && store.selection.id === prop.id}
            type="button"
            onClick={() => store.select({ type: "prop", id: prop.id })}
          >
            <Box className="size-4" /> {prop.name}
          </button>
        ))}
        <button className="btn justify-start" data-on={store.selection?.type === "camera"} type="button" onClick={() => store.select({ type: "camera" })}>
          <Camera className="size-4" /> Shot camera
        </button>
      </div>
    </div>
  );

  const groupLibrary = (
    <section className="rounded-xl border border-border bg-surface-2 p-3">
      <h3 className="mb-1 text-sm font-semibold">Multi-person pose presets</h3>
      <p className="mb-2 text-xs text-muted">112 neutral arrangements, including mirrored and rotated versions. All limbs remain freely editable.</p>
      <div className="mb-2 flex gap-2">{[2, 3, 4].map((n) => <button className="btn flex-1" data-on={poseCount === n} key={n} type="button" onClick={() => setPoseCount(n)}>{n} people</button>)}</div>
      <input className="field mb-2" value={poseSearch} onChange={(e) => setPoseSearch(e.target.value)} placeholder="Search arrangements" aria-label="Search group pose library" />
      <button className="btn mb-2 w-full" type="button" title="Save all characters and their poses to your private offline pose library" onClick={() => {
        const name = window.prompt("Name your reusable arrangement:", `My ${project.characters.length}-person arrangement`);
        if (!name?.trim()) return;
        const next = [...customLayouts, { name: name.trim(), members: structuredClone(project.characters) }].slice(-500);
        try { localStorage.setItem("camera-planner:v2:custom-poses", JSON.stringify(next)); setCustomLayouts(next); store.setStatus("Custom pose saved on this device"); }
        catch { store.setStatus("Could not save custom pose — device storage may be full"); }
      }}>+ Save current arrangement</button>
      {customLayouts.length ? <details className="mb-2 rounded-lg border border-border p-2"><summary className="text-sm">My saved arrangements ({customLayouts.length})</summary><div className="mt-2 flex max-h-44 flex-col gap-2 overflow-auto">{customLayouts.map((saved, index) => <div className="flex gap-1" key={index}><button className="btn flex-1 justify-start" type="button" onClick={() => store.commit((draft) => {
        // Apply the saved arrangement as a new set of actors, keeping furniture and camera.
        draft.characters = saved.members.map((member) => ({...structuredClone(member), id: uid()}));
      })}>{saved.name} ({saved.members.length})</button><button className="btn" aria-label={`Remove saved preset ${saved.name}`} onClick={() => {
        const next = customLayouts.filter((_, i) => i !== index); localStorage.setItem("camera-planner:v2:custom-poses", JSON.stringify(next)); setCustomLayouts(next);
      }}>×</button></div>)}</div></details> : null}
      <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto">
        {GROUP_PRESETS.filter((preset) => preset.count === poseCount && preset.name.toLowerCase().includes(poseSearch.toLowerCase())).map((preset) => (
          <button key={preset.id} type="button" className="btn h-auto flex-col items-start text-left" title={preset.description} onClick={() => setPreviewPreset(preset)}><span className="text-xs font-semibold">{preset.name}</span><span className="text-[11px] text-muted">{preset.description}</span></button>
        ))}
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={showAdultPresets} onChange={(e) => setShowAdultPresets(e.target.checked)} aria-label="Show adult pose presets" />
        Show 18+ / NSFW positions (non-graphic mannequins)
      </label>
      {showAdultPresets ? (
        <div className="mt-2 rounded-lg border border-border p-2">
          <h4 className="mb-1 text-sm font-semibold">Adult / NSFW positions · {ADULT_GROUP_PRESETS.filter(p => p.count === poseCount).length} for {poseCount} people</h4>
          {poseCount === 4 ? (
            <p className="text-xs text-muted">Choose 2 or 3 people above for adult arrangements.</p>
          ) : (
            <div className="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto">
              {ADULT_GROUP_PRESETS.filter((preset) => preset.count === poseCount && preset.name.toLowerCase().includes(poseSearch.toLowerCase())).map((preset) => (
                <button key={preset.id} type="button" className="btn h-auto flex-col items-start text-left" title={preset.description} onClick={() => setPreviewPreset(preset)}>
                  <span className="text-xs font-semibold">{preset.name}</span>
                  <span className="text-[11px] text-muted">{preset.description}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 border-t border-border pt-3">
            <h5 className="mb-1 text-sm font-semibold">Solo / JOI positions ({SOLO_ADULT_PRESETS.length})</h5>
            <p className="mb-2 text-xs text-muted">Clearly labelled JOI mannequin references; non-graphic and fully editable. Only the selected character changes.</p>
            <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto">
              {SOLO_ADULT_PRESETS.filter((preset) => preset.name.toLowerCase().includes(poseSearch.toLowerCase())).map((preset) => (
                <button key={preset.id} type="button" className="btn h-auto flex-col items-start text-left" title={preset.description} onClick={() => setPreviewPreset(preset)}>
                  <span className="text-xs font-semibold">{preset.name}</span>
                  <span className="text-[11px] text-muted">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );

  const inspector = (
    <div className="flex flex-col gap-4 p-3">
      {selectedCharacter ? (
        <CharacterPanel
          character={selectedCharacter}
          reading={reading?.label ?? "unclear"}
          confidence={reading?.confidence ?? "low"}
          props={project.props}
          onFocusJoint={() => viewRef.current?.focusJoint()}
        />
      ) : null}
      {selectedCharacter ? groupLibrary : null}
      {selectedProp ? <PropPanel prop={selectedProp} /> : null}
      {store.selection?.type === "camera" || store.selection?.type === "target" || !store.selection ? (
        <CameraPanel />
      ) : (
        <button className="btn" type="button" onClick={() => store.select({ type: "camera" })}>
          Edit shot camera
        </button>
      )}
      {!selectedCharacter && !selectedProp && store.selection?.type !== "camera" && store.selection?.type !== "target" ? (
        <p className="text-sm text-muted">Select a person, object, or the shot camera.</p>
      ) : null}
    </div>
  );

  const renderTimeline = () => (
    <Timeline
      clipId={clipId}
      onSelectClip={setClipId}
      issues={issues.map((issue) => issue.message)}
    />
  );

  const exporter = (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" data-on={project.profile === "h3max"} type="button" onClick={() => store.commit((draft) => void (draft.profile = "h3max"))}>
          H3 Max
        </button>
        <button className="btn" data-on={project.profile === "wan3"} type="button" onClick={() => store.commit((draft) => void (draft.profile = "wan3"))}>
          Wan 3
        </button>
        <p className="col-span-2 text-xs text-muted">Export: always detailed. Grok translates the shot preview and technical data into natural cinematic language.</p>
      </div>
      <textarea className="area area-prompt font-mono text-xs leading-relaxed" readOnly value={prompt} aria-label="Generated instructions" />
      <div className="grid grid-cols-2 gap-2">
        <button
          className="btn"
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(prompt).then(
              () => store.setStatus("Instructions copied"),
              () => store.setStatus("Clipboard was blocked"),
            );
          }}
        >
          <Copy className="size-4" /> Copy text
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => downloadBlob(new Blob([prompt], { type: "text/plain" }), "instructions.txt")}
        >
          <Download className="size-4" /> Text file
        </button>
        <button className="btn" type="button" onClick={() => saveShot("pose", "pose-reference.png")}>
          Pose PNG
        </button>
        <button className="btn" type="button" onClick={() => saveShot("camera", "camera-view.png")}>
          Shot PNG
        </button>
        <button className="btn" type="button" onClick={() => saveShot("annotated", "annotated-scene.png")}>
          Annotated PNG
        </button>
        <button className="btn btn-ghost" type="button" title="Help and controls" aria-label="Help" onClick={() => setHelp(true)}>
          <CircleHelp className="size-5" />
        </button>
        <button className="btn btn-ghost" type="button" title="Reset options" aria-label="Reset options" onClick={() => setResetMenu(true)}>
          <RotateCcw className="size-4" />
        </button>
        <button className="btn-primary btn" type="button" onClick={() => void exportPack()}>
          Export for Grok
        </button>
      </div>
      <p className="text-xs text-muted">
        The ZIP includes actual start, middle and end shot previews, pose and scene references, a detailed Grok translation brief and your editable project.
        Bring your own photograph separately.
      </p>
    </div>
  );

  return (
    <div className="app-shell relative flex flex-col bg-bg text-fg" onClickCapture={(event) => {
      if(!helpMode) return;
      const button = (event.target as HTMLElement).closest("button");
      if(!button || button.hasAttribute("data-help-toggle")) return;
      event.preventDefault();event.stopPropagation();
      const label = (button.getAttribute("aria-label") || button.innerText || "Control").trim();
      const explanation: Record<string,string> = {
        Scene:"Shows the 3D workspace. Moving this view does not change the video shot.",
        Shot:"Shows the exact shot camera framing that will be exported for Grok.",
        Split:"See the workspace and shot camera together. Drag their divider to resize.",
        Explore:"Rotate and zoom your workspace view without moving objects.",
        People:"Select a person, modify their position or adjust individual limbs.",
        Camera:"Change the actual video shot viewpoint, direction or lens zoom.",
        Props:"Add and position scene furniture and other objects.",
        Movement:"Edit the camera route and timeline. These movements affect the exported video.",
        Precision:"Exact adjustments for selected object and joint movements.",
        Frame:"Centre your workspace around the current selection.",
        "Zoom in":"Moves your workspace viewpoint closer. It does not zoom the actual video shot.",
        "Zoom out":"Moves your workspace viewpoint further away, not the shot camera.",
        "Shot +":"Magnifies the actual video shot without moving the 3D workspace.",
        Undo:"Revert the most recent scene change.",
        Redo:"Reapply a scene change you undid.",
        "Export for Grok":"Download the detailed camera instructions and visual reference images together.",
      };
      setControlHelp(button.getAttribute("title") || explanation[label] || `${label}: ${button.getAttribute("aria-label") || "Tap this control to perform the named action."}`);
    }}>
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="hidden size-8 items-center justify-center rounded-lg bg-primary text-primary-fg sm:flex">
          <Camera className="size-4" />
        </div>
        <span className="shrink-0 rounded-md border border-accent/50 bg-accent/10 px-2 py-1 text-[10px] font-semibold tracking-wider text-accent" aria-label="Application version 2.1">V2.1</span>
        <div className="min-w-0 flex-1">
          <input
            className="field font-medium"
            aria-label="Project name"
            value={project.name}
            onFocus={() => store.begin()}
            onChange={(event) => store.preview((draft) => void (draft.name = event.target.value))}
            onBlur={() => store.end()}
          />
        </div>
        <button className="btn !min-h-9" type="button" data-help-toggle="true" data-on={helpMode}
          aria-pressed={helpMode} title="Help Mode: tap any button to learn what it does" onClick={() => {setHelpMode(v=>!v);setControlHelp(null);}}>
          <CircleHelp className="size-4" /> <span className="hidden sm:inline">{helpMode?"Exit help":"Help mode"}</span>
        </button>
        <button className="btn !min-h-9" type="button" data-help-toggle="true" title="Temporarily hide the extra editing toolbars" onClick={()=>{setChromeHidden(v=>!v);setMobile(null);}}>
          {chromeHidden?"Show tools":"Hide tools"}
        </button>
        <button className="btn btn-ghost" type="button" aria-label="Undo" onClick={() => store.undo()}>
          <Undo2 className="size-4" />
        </button>
        <button className="btn btn-ghost" type="button" aria-label="Redo" onClick={() => store.redo()}>
          <Redo2 className="size-4" />
        </button>
        <button className="btn hidden sm:inline-flex" type="button" onClick={() => fileRef.current?.click()}>
          <FolderOpen className="size-4" /> Open
        </button>
        <button
          className="btn hidden sm:inline-flex"
          type="button"
          onClick={() => {
            downloadBlob(new Blob([projectToJson(project)], { type: "application/json" }), `${project.name || "shot"}.json`);
            store.setStatus("Project file downloaded");
          }}
        >
          <Save className="size-4" /> File
        </button>
        <button className="btn-primary btn" type="button" onClick={() => void exportPack()}>
          <Download className="size-4" /> <span className="hidden sm:inline">Export</span>
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="panel-scroll hidden w-72 shrink-0 border-r border-border 2xl:block">{library}</aside>
        <div className="relative min-w-0 flex-1">
          <Viewport ref={viewRef} />
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center gap-2">
            <div className="pointer-events-auto flex gap-1 rounded-xl border border-border bg-surface p-1">
              {VIEWS.map((view) => (
                <button key={view.id} className="btn" data-on={store.view === view.id} type="button" onClick={() => store.setView(view.id)}>
                  {view.label}
                </button>
              ))}
            </div>
          </div>
          <div className={`pointer-events-none absolute left-2 right-2 top-[4.8rem] z-10 justify-center ${chromeHidden?"hidden":"flex"}`}>
            <div className="pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-surface/95 p-1 shadow-lg" role="group" aria-label="Control mode">
              <select className="field !min-h-9 !w-44 2xl:hidden" aria-label="Choose editing mode" value={store.controlMode} onChange={e=>activateMode(e.target.value as ControlMode)}>
                {MODES.map(mode=><option value={mode.id} key={mode.id}>{mode.label}</option>)}
              </select>
              <div className="hidden gap-1 2xl:flex">
                {MODES.map(mode => <button key={mode.id} className="btn mode-button shrink-0" data-on={store.controlMode===mode.id} type="button"
                  title={mode.description} aria-label={`${mode.label} control mode`} onClick={()=>activateMode(mode.id)}>
                  <mode.icon className="size-4"/><span>{mode.label}</span>
                </button>)}
              </div>
            </div>
          </div>
          <div className={`pointer-events-none absolute bottom-3 left-3 flex-wrap gap-2 ${chromeHidden?"hidden":"flex"}`}>
            <div className="pointer-events-auto flex gap-1 rounded-xl border border-border bg-surface p-1">
              {TOOLS.map((tool) => (
                <button key={tool.id} className="btn" data-on={store.tool === tool.id} type="button" onClick={() => store.setTool(tool.id)} aria-label={tool.label} title={`Tool: ${tool.label}`}>
                  <tool.icon className="size-4" />
                  <span className="hidden md:inline">{tool.label}</span>
                </button>
              ))}
            </div>
            <button className="btn pointer-events-auto" title="Zoom out of the workspace" aria-label="Zoom out" type="button" onClick={() => viewRef.current?.zoomView(1.3)}><ZoomOut className="size-4" /></button>
            <button className="btn pointer-events-auto" title="Zoom into the workspace" aria-label="Zoom in" type="button" onClick={() => viewRef.current?.zoomView(0.77)}><ZoomIn className="size-4" /></button>
            {(store.view === "camera" || store.view === "split") ? (
              <button className="btn pointer-events-auto" type="button" aria-label="Zoom in the actual shot" title="Zoom the video shot, not the workspace" onClick={() => { store.patchCamera(adjustShot(store.project.camera,"zoom-in",0.2),true); store.setStatus("Shot lens zoomed in"); }}>Shot +</button>
            ) : null}
            <button className="btn pointer-events-auto" title="Reset the workspace view without moving objects" aria-label="Reset workspace view" type="button" onClick={() => viewRef.current?.resetView()}><Crosshair className="size-4" /></button>
            <button className="btn pointer-events-auto" type="button" title="Fine movement controls" onClick={() => setNudgeOpen((v) => !v)}>
              <Settings2 className="size-4" /> <span className="hidden md:inline">Precision</span>
            </button>
            {store.controlMode === "path" ? (
              <button
                className="btn pointer-events-auto"
                type="button"
                data-on={store.pathAxis === "vertical"}
                title="Switch dragging a camera point between floor movement and height"
                aria-pressed={store.pathAxis === "vertical"}
                onClick={() => store.setPathAxis(store.pathAxis === "horizontal" ? "vertical" : "horizontal")}
              >
                {store.pathAxis === "vertical" ? "Drag: height" : "Drag: floor"}
              </button>
            ) : null}
            <button className="btn pointer-events-auto" type="button" onClick={() => viewRef.current?.frame()}>
              <Focus className="size-4" /> <span className="hidden md:inline">Frame selected</span>
            </button>
            <button className="btn pointer-events-auto" title="Fit everyone into the workspace view without changing the actual shot camera" type="button" onClick={() => viewRef.current?.frameAll()}>
              Fit everyone
            </button>
          </div>
          {nudgeOpen ? (
            <div className="pointer-events-auto absolute bottom-20 right-2 z-10 w-[min(20rem,94%)] rounded-2xl border border-border bg-surface p-3 shadow-2xl">
              <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Precision controls</h3><button className="btn btn-ghost" type="button" aria-label="Close precision controls" onClick={() => setNudgeOpen(false)}>×</button></div>
              <p className="mb-2 text-xs text-muted">Select a person, prop or camera. Tap arrows to move exactly one step. Choose Joint to rotate a selected limb.</p>
              <div className="mb-2 grid grid-cols-3 gap-1">{(["position", "rotation", "joint"] as const).map((mode) => <button key={mode} type="button" className="btn" data-on={nudgeAxis === mode} onClick={() => setNudgeAxis(mode)}>{mode === "position" ? "Move" : mode === "rotation" ? "Rotate" : "Joint"}</button>)}</div>
              <div className="mb-2 grid grid-cols-3 gap-1">{([0.01, 0.1, 0.5] as const).map((step) => <button key={step} className="btn" data-on={nudgeStep === step} type="button" onClick={() => setNudgeStep(step)}>{nudgeAxis === "position" ? `${step * 100} cm` : `${Math.max(1, step * 100)}°`}</button>)}</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <button className="btn" onClick={() => nudge("x", -1)} aria-label="Move left" title="Left / negative X"><ArrowLeft className="size-5" /></button>
                <button className="btn" onClick={() => nudge("y", 1)} aria-label="Move up" title="Up / positive Y"><ArrowUp className="size-5" /></button>
                <button className="btn" onClick={() => nudge("x", 1)} aria-label="Move right" title="Right / positive X"><ArrowRight className="size-5" /></button>
                <button className="btn" onClick={() => nudge("z", -1)} aria-label="Move backward" title="Negative Z">Z−</button>
                <button className="btn" onClick={() => nudge("y", -1)} aria-label="Move down" title="Down / negative Y"><ArrowDown className="size-5" /></button>
                <button className="btn" onClick={() => nudge("z", 1)} aria-label="Move forward" title="Positive Z">Z+</button>
              </div>
            </div>
          ) : null}
          {helpMode ? <div className="pointer-events-auto absolute right-2 top-1/3 z-50 w-[min(22rem,94%)] rounded-xl border border-accent bg-surface p-3 shadow-2xl">
            <p className="text-sm font-semibold">Help Mode is on</p>
            <p className="mt-1 text-xs text-muted">{controlHelp || "Tap any button to see its explanation. Buttons will not perform actions until you exit Help Mode."}</p>
            <button data-help-toggle="true" className="btn mt-2 !min-h-9" type="button" onClick={()=>{setHelpMode(false);setControlHelp(null);}}>Done · use controls</button>
          </div> : null}
          <p className="pointer-events-none absolute top-[8.4rem] right-3 rounded-lg bg-surface px-2 py-1 text-xs text-muted">
            {store.status}
          </p>
        </div>
        <aside className="hidden min-h-0 w-80 shrink-0 flex-col border-l border-border 2xl:flex">
          <div className="panel-scroll min-h-0 flex-1">{inspector}</div>
          <div className="panel-scroll max-h-[min(24rem,48%)] shrink-0 border-t border-border bg-surface">{exporter}</div>
        </aside>
      </div>
      <div className="hidden border-t border-border 2xl:block">{renderTimeline()}</div>
      {mobile ? (
        <div className="panel-scroll absolute bottom-[3.5rem] left-1 right-1 z-30 max-h-[min(60dvh,32rem)] rounded-xl border border-border bg-surface shadow-2xl md:left-auto md:w-[min(26rem,95vw)] 2xl:hidden">
          {mobile === "library" ? library : null}
          {mobile === "pose" || mobile === "camera" ? inspector : null}
          {mobile === "time" ? renderTimeline() : null}
          {mobile === "export" ? exporter : null}
        </div>
      ) : null}
      {previewPreset ? <div role="dialog" aria-modal="true" aria-label={`Preview ${previewPreset.name}`}
        className="absolute inset-0 z-[70] flex items-center justify-center bg-black/75 p-3">
        <div className="w-[min(26rem,96vw)] max-h-[90dvh] overflow-y-auto rounded-2xl border border-border bg-surface p-4 shadow-2xl">
          <h2 className="text-base font-semibold">{previewPreset.name}</h2>
          <p className="my-2 text-xs text-muted">{previewPreset.description}</p>
          <PresetScenePreview preset={previewPreset} />
          <p className="my-2 text-xs text-muted">This renders the actual mannequin geometry before applying the arrangement. Your current scene remains unchanged until you select Apply.</p>
          <div className="flex gap-2">
            <button className="btn flex-1" type="button" onClick={()=>setPreviewPreset(null)}>Cancel</button>
            <button className="btn btn-primary flex-1" type="button" onClick={() => {
              const preset=previewPreset;
              if(preset.count===1){
                if(!selectedCharacter) {store.setStatus("Select a character first");setPreviewPreset(null);return;}
                store.commit(draft=>applySoloAdultPreset(draft,preset,selectedCharacter.id));
              } else {store.applyGroup(preset);}
              store.setControlMode("character");
              setPreviewPreset(null);
              window.requestAnimationFrame(()=>viewRef.current?.frameAll());
            }}>Apply arrangement</button>
          </div>
        </div>
      </div> : null}
      <nav className="grid grid-cols-5 border-t border-border bg-surface 2xl:hidden">
        {(
          [
            ["library", "Add", Plus],
            ["pose", "Pose", PersonStanding],
            ["camera", "Camera", Camera],
            ["time", "Time", Clock3],
            ["export", "Export", Download],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            className="btn btn-ghost rounded-none border-0"
            data-on={mobile === id}
            type="button"
            onClick={() => setMobile((current) => (current === id ? null : id))}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </nav>
      <div className="hidden items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-muted 2xl:flex">
        <span>Grid +Z is north. Drag the scene to orbit. Drag the shot view to aim the camera. Scroll to dolly.</span>
        <span className="flex gap-2">
          <button className="btn" type="button" onClick={() => setHelp(true)}>
            How to use
          </button>
          <button className="btn" type="button" onClick={() => void listProjects().then(setProjects).catch(() => store.setStatus("Could not list saves"))}>
            Saved shots
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              if (window.confirm("Reset the scene? The project name is kept.")) store.resetScene();
            }}
          >
            <RotateCcw className="size-4" /> Reset
          </button>
        </span>
      </div>
      {help ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-bg/80 p-4 sm:items-center" onClick={() => setHelp(false)}>
          <div className="panel-scroll max-h-[85dvh] w-full max-w-2xl rounded-2xl border border-border bg-surface p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">How to use the planner</h2><button className="btn" onClick={() => setHelp(false)} aria-label="Close help">Close</button></div>
            <p className="mt-2 text-sm text-muted">This guide is available offline. Touch and hold a control to show its name. Start with Explore mode.</p>
            {[
              ["1 · Move around the workspace", "Choose Explore. Drag one finger to orbit your viewpoint. Pinch with two fingers to zoom, and move two fingers together to pan. Use + / − and Reset View if you get lost. Moving the view does not change your video camera."],
              ["2 · Pose people", "Choose People, then Pose. Tap or select a body joint; larger invisible touch targets make joint selection easier. In Precision controls choose Joint to bend, twist or turn it by small increments. Apply a preset first for faster setup."],
              ["3 · Furniture and props", "Choose Props, add a bed or chair and select it. Move, rotate or scale the object. Use Precision controls for exact left/right/up/down movement."],
              ["4 · Video camera", "Choose Camera to adjust the actual video shot. Move the camera in the scene or use the Shot view to aim it. Pan and tilt rotate a stationary camera; orbit and dolly physically move it."],
              ["5 · Camera movement and timeline", "Choose Movement or Time to add a motion clip. Pan rotates horizontally, Tilt points up/down, Orbit moves around the subject, Dolly tracks physically, Zoom changes the lens. A finished move holds until you add a Return clip. Custom paths use orange points: drag them across the floor, or switch Drag height (or hold Shift) to change height. Start and duration are in seconds. Play previews the full shot in real time."],
              ["6 · Multi-person presets", "Open Pose and choose a neutral arrangement for two or three people. After applying a preset, select each person and adjust them independently. You can save scenes locally and reopen JSON projects."],
              ["7 · Reset and export", "Use the reset button in the top bar to reset just the view, the selected item, the video camera, or the entire scene. Undo restores unintended changes. Export for Grok creates screenshots and a text prompt, without cloud processing."],
            ].map(([title, body]) => <details key={title} className="border-b border-border py-3"><summary className="cursor-pointer font-medium">{title}</summary><p className="pt-2 text-sm leading-relaxed text-muted">{body}</p></details>)}
          </div>
        </div>
      ) : null}
      {resetMenu ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-bg/80 p-3 sm:items-center" onClick={() => setResetMenu(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex justify-between"><h2 className="text-lg font-semibold">Reset options</h2><button className="btn" onClick={() => setResetMenu(false)}>Close</button></div>
            <p className="my-2 text-sm text-muted">Saved projects are not deleted. Resetting a scene can be undone.</p>
            <div className="grid grid-cols-1 gap-2">
              <button className="btn justify-start" onClick={() => { viewRef.current?.resetView(); setResetMenu(false); }}>Reset workspace view only</button>
              <button className="btn justify-start" onClick={() => { if (store.selection?.type === "character") store.applyPose("stand"); const selection = store.selection; if (selection?.type === "prop") { const current = project.props.find(p=>p.id===selection.id); if (current) store.patchProp(current.id, { rotation:{x:0,y:0,z:0}, scale:{x:1,y:1,z:1} }, true); } setResetMenu(false); }}>Reset selected pose</button>
              <button className="btn justify-start" onClick={() => { const next = cameraPreset("three-quarter", groupFocus(project), {x:0,y:0,z:1}); store.commit((p)=>{ p.camera={ ...p.camera, ...next, roll:0 }; p.motions=[]; }); setResetMenu(false); }}>Reset camera and movements</button>
              <button className="btn justify-start" onClick={() => { if (window.confirm("Reset the entire scene? You can undo, and saved projects will remain.")) store.resetScene(); setResetMenu(false); }}>Reset entire scene</button>
            </div>
          </div>
        </div>
      ) : null}
      {projects ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-bg/80 p-4 sm:items-center" onClick={() => setProjects(null)}>
          <div className="flex max-h-[70dvh] w-full max-w-md flex-col gap-2 overflow-auto rounded-xl border border-border bg-surface p-4" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-semibold">Saved on this device</h2>
            {projects.length === 0 ? <p className="text-sm text-muted">Nothing else is stored yet.</p> : null}
            {projects.map((item) => (
              <div key={item.id} className="flex gap-2">
                <button
                  className="btn flex-1 justify-start"
                  type="button"
                  onClick={() => {
                    store.replaceProject(item.data, `Opened ${item.name}`);
                    setProjects(null);
                  }}
                >
                  {item.name}
                </button>
                <button
                  className="btn"
                  type="button"
                  aria-label={`Delete ${item.name}`}
                  onClick={() => {
                    void deleteStoredProject(item.id).then(() => setProjects((list) => list?.filter((entry) => entry.id !== item.id) ?? null));
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button className="btn" type="button" onClick={() => setProjects(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      <input
        ref={fileRef}
        className="hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          file.text().then((text) => {
            const loaded = projectFromJson(text);
            if (!loaded.project) {
              store.setStatus(loaded.issues[0]?.message ?? "Could not open that file");
              return;
            }
            store.replaceProject(loaded.project, `Opened ${loaded.project.name}`);
          });
        }}
      />
    </div>
  );
}

function NumberBox({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const begin = usePlanner((state) => state.begin);
  const end = usePlanner((state) => state.end);
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <input
        className="field font-mono"
        type="number"
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        onFocus={() => begin()}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        onBlur={() => end()}
      />
    </label>
  );
}

function CharacterPanel({
  character,
  reading,
  confidence,
  props,
  onFocusJoint,
}: {
  character: ReturnType<typeof usePlanner.getState>["project"]["characters"][number];
  reading: string;
  confidence: string;
  props: ReturnType<typeof usePlanner.getState>["project"]["props"];
  onFocusJoint: () => void;
}) {
  const store = usePlanner();
  const patch = (partial: Partial<typeof character>, history = false) => store.patchCharacter(character.id, partial, history);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input className="field" value={character.name} aria-label="Character name" onChange={(event) => patch({ name: event.target.value }, true)} />
        <input className="field w-14" type="color" aria-label="Character color" value={character.color} onChange={(event) => patch({ color: event.target.value }, true)} />
      </div>
      <p className="text-sm text-muted">
        Read as {reading === "unclear" ? "unclear" : POSE_PHRASE[reading as Exclude<PoseLabel, "auto">] ?? reading}
        {confidence === "low" ? " · low confidence" : ""}
      </p>
      <details className="rounded-xl border border-border p-2">
      <summary className="cursor-pointer text-xs font-semibold">Advanced person coordinates and scale</summary>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberBox key={axis} label={`Pos ${axis.toUpperCase()}`} step={0.05} value={character.position[axis]} onChange={(value) => patch({ position: { ...character.position, [axis]: value } })} />
        ))}
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberBox key={`r${axis}`} label={`Rot ${axis.toUpperCase()}`} step={1} value={character.rotation[axis]} onChange={(value) => patch({ rotation: { ...character.rotation, [axis]: value } })} />
        ))}
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberBox key={`s${axis}`} label={`Scale ${axis.toUpperCase()}`} step={0.05} value={character.scale[axis]} onChange={(value) => patch({ scale: { ...character.scale, [axis]: value } })} />
        ))}
      </div>
      <NumberBox label="Bulk" step={0.05} value={character.bulk} onChange={(bulk) => patch({ bulk })} />
      </details>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PRESET_LABEL) as PresetId[]).map((preset) => (
          <button key={preset} className="btn" type="button" onClick={() => { store.setControlMode("character"); store.applyPose(preset); }}>
            {PRESET_LABEL[preset]}
          </button>
        ))}
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        Realistic joint limits
        <input
          type="checkbox"
          checked={character.jointLimits}
          onChange={(event) => patch({ jointLimits: event.target.checked }, true)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Pose label
        <select
          className="field"
          value={character.poseLabel}
          onChange={(event) => patch({ poseLabel: event.target.value as PoseLabel }, true)}
        >
          {POSE_LABELS.map((label) => (
            <option key={label} value={label}>
              {label === "auto" ? "Auto" : POSE_PHRASE[label]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Relationship note
        <textarea
          className="area"
          value={character.relationNote}
          placeholder="Only if the rig cannot say it. This is quoted as your note."
          onChange={(event) => patch({ relationNote: event.target.value }, true)}
        />
      </label>
      {props.length ? (
        <label className="flex flex-col gap-1 text-sm">
          Place on furniture
          <select
            className="field"
            defaultValue=""
            onChange={(event) => {
              const [mode, id] = event.target.value.split(":");
              if (id && mode) store.placeSelectedOn(id, mode as "sit" | "lie-up" | "lie-down" | "lie-side");
              event.target.value = "";
            }}
          >
            <option value="">Choose…</option>
            {props.map((prop) => (
              <optgroup key={prop.id} label={prop.name}>
                <option value={`sit:${prop.id}`}>Sit on {prop.name}</option>
                <option value={`lie-up:${prop.id}`}>Lie face-up on {prop.name}</option>
                <option value={`lie-down:${prop.id}`}>Lie face-down on {prop.name}</option>
                <option value={`lie-side:${prop.id}`}>Lie on left side on {prop.name}</option>
              </optgroup>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex flex-col gap-2">
        {JOINT_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <h3 className="text-xs text-muted">{group.label}</h3>
            <div className="flex flex-wrap gap-1">
              {group.ids.map((id) => (
                <button key={id} className="btn" data-on={store.joint === id} type="button" onClick={() => store.setJoint(id)} title={`Select ${JOINT_LABEL[id]} for accurate posing`}>
                  {JOINT_LABEL[id]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {store.joint ? (
        <div className="rounded-xl border border-border bg-bg p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <strong className="text-sm">Editing {JOINT_LABEL[store.joint]}</strong>
            <HelpTip text="Tap a limb directly on the 3D person, or select its name above. Adjust bend and twist with sliders. The selected body part glows teal." />
            <button className="btn !min-h-9 text-xs" type="button" onClick={onFocusJoint}>Focus limb</button>
            <button className="btn !min-h-9 text-xs" type="button" onClick={() => store.setJointEuler(character.id,store.joint!,{x:0,y:0,z:0},true)}>Straighten</button>
          </div>
          {(["x", "y", "z"] as const).map((axis) => (
            <label className="mb-3 flex flex-col gap-1" key={axis}>
              <span className="flex justify-between text-xs"><span>{axis==="x"?"Bend forwards / backwards":axis==="y"?"Turn / twist":"Move sideways"}</span><span className="font-mono">{Math.round(character.pose[store.joint as JointId][axis])}°</span></span>
              <input className="w-full accent-primary" type="range" min={-180} max={180} step={2} aria-label={`${JOINT_LABEL[store.joint!]} ${axis} rotation`}
                value={Math.min(180,Math.max(-180,character.pose[store.joint as JointId][axis]))}
                onPointerDown={() => store.begin()} onPointerUp={() => store.end()} onPointerCancel={() => store.end()}
                onChange={event => store.setJointEuler(character.id,store.joint!,{...character.pose[store.joint as JointId],[axis]:Number(event.target.value)},false)} />
            </label>
          ))}
          <p className="text-xs text-muted">Use Undo to restore the previous position. Switch to Explore to rotate the workspace without moving the person.</p>
        </div>
      ) : null}
      <div className="flex gap-2">
        <button className="btn" type="button" onClick={() => store.snapSelected()}>
          Snap to ground
        </button>
        <button className="btn" type="button" onClick={() => store.duplicateSelection()}>
          <Copy className="size-4" />
        </button>
        <button className="btn" type="button" onClick={() => store.deleteSelection()}>
          <Trash2 className="size-4" />
        </button>
      </div>
    </section>
  );
}

function PropPanel({ prop }: { prop: ReturnType<typeof usePlanner.getState>["project"]["props"][number] }) {
  const store = usePlanner();
  const patch = (partial: Partial<typeof prop>) => store.patchProp(prop.id, partial, false);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input className="field" value={prop.name} aria-label="Object name" onChange={(event) => store.patchProp(prop.id, { name: event.target.value }, true)} />
        <input className="field w-14" type="color" aria-label="Object color" value={prop.color} onChange={(event) => store.patchProp(prop.id, { color: event.target.value }, true)} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberBox key={axis} label={`Pos ${axis.toUpperCase()}`} step={0.05} value={prop.position[axis]} onChange={(value) => patch({ position: { ...prop.position, [axis]: value } })} />
        ))}
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberBox key={`r${axis}`} label={`Rot ${axis.toUpperCase()}`} step={1} value={prop.rotation[axis]} onChange={(value) => patch({ rotation: { ...prop.rotation, [axis]: value } })} />
        ))}
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberBox key={`s${axis}`} label={`Scale ${axis.toUpperCase()}`} step={0.05} value={prop.scale[axis]} onChange={(value) => patch({ scale: { ...prop.scale, [axis]: value } })} />
        ))}
      </div>
      <div className="flex gap-2">
        <button className="btn" type="button" onClick={() => store.duplicateSelection()}>
          Duplicate
        </button>
        <button className="btn" type="button" onClick={() => store.deleteSelection()}>
          Delete
        </button>
      </div>
    </section>
  );
}

function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return <span className="relative inline-flex shrink-0 align-middle">
    <button type="button" className="btn !min-h-7 !min-w-7 !rounded-full !p-1" aria-expanded={open} aria-label="What does this do?" title={text}
      onClick={() => setOpen(value => !value)}><CircleHelp className="size-4" /></button>
    {open ? <span role="tooltip" className="absolute right-0 top-9 z-50 w-64 max-w-[80vw] rounded-lg border border-accent bg-surface p-3 text-left text-xs leading-relaxed text-fg shadow-2xl">
      {text}
      <button type="button" className="mt-2 block text-accent underline" onClick={() => setOpen(false)}>Close explanation</button>
    </span> : null}
  </span>;
}

function CameraPanel() {
  const store = usePlanner();
  const camera = store.project.camera;
  const [advanced, setAdvanced] = useState(false);
  const [step, setStep] = useState(0.15);
  const [lastAction, setLastAction] = useState<ShotAction | null>(null);
  const patch = (partial: Partial<typeof camera>) => store.patchCamera(partial, true);
  const focusCharacter = store.project.characters.find((character) => store.selection?.type === "character" && character.id === store.selection.id);
  const perform = (action: ShotAction) => {
    store.patchCamera(adjustShot(store.project.camera, action, step), true);
    setLastAction(action);
  };
  const control = (action: ShotAction, label: string) => (
    <button key={action} className="btn flex-1 min-w-0 text-xs" type="button"
      data-on={lastAction === action} aria-pressed={lastAction === action}
      aria-label={label} onClick={() => perform(action)}>{label}</button>
  );
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Shot camera</h2>
        <HelpTip text="These controls change the actual video shot, not your editor view. Aim turns the lens; Move repositions the camera; Lens zoom changes magnification." />
      </div>
      <p className="text-xs text-muted">Look through the Shot preview. Every direction below follows what the camera sees, not X/Y/Z axes.</p>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(CAMERA_PRESET_LABEL) as CameraPresetId[]).map((preset) => (
          <button key={preset} className="btn !min-h-9 text-xs" type="button" title={`Frame: ${CAMERA_PRESET_LABEL[preset]}`} onClick={() => {
            const focus = focusCharacter ? (preset === "close" ? headFocus(focusCharacter) : groupFocus({ ...store.project, props: [], characters: [focusCharacter] })) : groupFocus(store.project);
            const facing = focusCharacter ? classifyPose(focusCharacter).forward : { x: 0, y: 0, z: 1 };
            store.patchCamera(cameraPreset(preset, focus, facing), true);
          }}>{CAMERA_PRESET_LABEL[preset]}</button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-muted" htmlFor="shot-adjustment-step">Adjustment size</label>
        <select id="shot-adjustment-step" className="field !w-auto" value={step} onChange={e => setStep(Number(e.target.value))}>
          <option value={0.05}>Fine</option><option value={0.15}>Normal</option><option value={0.4}>Large</option>
        </select>
      </div>
      <div className="rounded-xl border border-border bg-bg p-3">
        <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold">Aim</span><HelpTip text="Turn the shot camera left, right, up or down without moving its location." /></div>
        <div className="flex flex-col items-center gap-1">
          <div className="w-1/3">{control("aim-up","Look up")}</div>
          <div className="flex w-full gap-1">{control("aim-left","Look left")}{control("aim-right","Look right")}</div>
          <div className="w-1/3">{control("aim-down","Look down")}</div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-bg p-3">
        <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold">Position</span><HelpTip text="Move the camera body. Slide and raise move it with its aim intact; Closer and Further move towards or away from the subject." /></div>
        <div className="grid grid-cols-2 gap-1">
          {control("closer","Closer")}{control("further","Further")}
          {control("slide-left","Slide left")}{control("slide-right","Slide right")}
          {control("rise","Move up")}{control("lower","Move down")}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-bg p-3">
        <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold">Lens zoom</span><HelpTip text="Magnify the picture without physically moving the shot camera. This is different from Closer and Further." /></div>
        <div className="flex gap-2">{control("zoom-out","Zoom out")}{control("zoom-in","Zoom in")}</div>
        <p className="mt-2 text-xs text-muted">{formatFocal(camera.fov)} equivalent · {camera.aspect}</p>
      </div>
      <details className="rounded-xl border border-border p-3" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-semibold">Advanced camera settings</summary>
        <p className="my-2 text-xs text-muted">For precise numerical work. The controls above are sufficient for normal use.</p>
        <div className="mb-2 flex flex-wrap gap-2">
          {ASPECTS.map(aspect => <button key={aspect} className="btn" data-on={camera.aspect===aspect} type="button" onClick={() => patch({aspect:aspect as AspectId})}>{aspect}</button>)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map(axis => <NumberBox key={axis} label={`Cam ${axis.toUpperCase()}`} step={0.05} value={camera.position[axis]} onChange={value => patch({position:{...camera.position,[axis]:value}})} />)}
          {(["x", "y", "z"] as const).map(axis => <NumberBox key={`t${axis}`} label={`Target ${axis.toUpperCase()}`} step={0.05} value={camera.target[axis]} onChange={value => patch({target:{...camera.target,[axis]:value}})} />)}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NumberBox label="FOV" step={1} value={camera.fov} onChange={fov => patch({fov})} />
          <NumberBox label="Roll" step={1} value={camera.roll} onChange={roll => patch({roll})} />
        </div>
      </details>
      <label className="flex flex-col gap-1 text-sm">
        Shot length
        <NumberBox label="Seconds" step={0.5} value={store.project.duration} onChange={duration => store.commit(draft => void(draft.duration = Math.min(60, Math.max(1, duration))))} />
      </label>
    </section>
  );
}

function Timeline({
  clipId,
  onSelectClip,
  issues,
}: {
  clipId: string | null;
  onSelectClip: (id: string | null) => void;
  issues: string[];
}) {
  const store = usePlanner();
  const { project, time, playing } = store;
  const clip = project.motions.find((item) => item.id === clipId) ?? project.motions[0];
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" type="button" onClick={() => store.setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <span className="font-mono text-sm">
          {time.toFixed(1)}s / {project.duration.toFixed(1)}s
        </span>
        <input
          className="min-w-40 flex-1"
          type="range"
          min={0}
          max={project.duration}
          step={0.1}
          value={time}
          aria-label="Playhead"
          onChange={(event) => store.setTime(Number(event.target.value))}
        />
        <details className="relative group rounded-xl border border-border bg-surface-2 p-1">
          <summary className="btn list-none font-semibold">+ Add camera movement <ChevronDown className="size-4" /></summary>
          <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto p-2 sm:grid-cols-3">
            {MOTION_KINDS.map((kind) => <button key={kind} type="button" title={MOTION_EXPLAIN[kind]} className="btn h-auto min-h-20 flex-col items-start text-left" onClick={(e) => { store.addClip(kind); (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; }}><span className="font-semibold">{MOTION_LABEL[kind]}</span><span className="text-xs text-muted">{MOTION_EXPLAIN[kind]}</span></button>)}
          </div>
        </details>
      </div>
      <div className="relative h-16 rounded-lg border border-border bg-bg">
        {project.motions.map((item, index) => (
          <button
            key={item.id}
            className="absolute top-2 h-12 rounded-md border border-border bg-surface-2 px-2 text-left text-xs"
            style={{
              left: `${(item.start / project.duration) * 100}%`,
              width: `${Math.max(4, (item.duration / project.duration) * 100)}%`,
              top: 8 + (index % 2) * 4,
            }}
            data-on={clip?.id === item.id}
            type="button"
            onClick={() => onSelectClip(item.id)}
          >
            {MOTION_LABEL[item.kind]}
          </button>
        ))}
        <div className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: `${(time / project.duration) * 100}%` }} />
      </div>
      {clip ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-sm text-muted"><strong className="text-fg">{MOTION_LABEL[clip.kind]}:</strong> {MOTION_EXPLAIN[clip.kind]}</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Move
            <select className="field" value={clip.kind} onChange={(event) => store.updateClip(clip.id, { kind: event.target.value as MotionKind })}>
              {MOTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {MOTION_LABEL[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Direction
            <select
              className="field"
              value={clip.direction}
              onChange={(event) => store.updateClip(clip.id, { direction: event.target.value as typeof clip.direction })}
            >
              {directionsFor(clip.kind).map((direction) => (
                <option key={direction} value={direction}>
                  {direction}
                </option>
              ))}
            </select>
          </label>
          <NumberBox label={`Amount ${amountUnit(clip.kind)}`} step={clip.kind === "dolly" ? 0.1 : 1} value={clip.amount} onChange={(amount) => store.updateClip(clip.id, { amount }, false)} />
          <NumberBox label="Start" step={0.1} value={clip.start} onChange={(start) => store.updateClip(clip.id, { start }, false)} />
          <NumberBox label="Duration" step={0.1} value={clip.duration} onChange={(duration) => store.updateClip(clip.id, { duration }, false)} />
          <button className="btn" type="button" onClick={() => store.deleteClip(clip.id)}>
            Remove movement
          </button>
          </div>
          {clip.kind === "path" ? (
            <div className="rounded-xl border border-border bg-bg p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Camera route points</h3>
                  <HelpTip text="Tap a numbered point below or its orange marker in the 3D Scene. Use the large directional buttons to move that point, or drag the marker directly. Points mark where the camera travels during the shot." />
                </div>
                <button className="btn" type="button" onClick={() => {
                  const points=insertPathWaypoint(clip.waypoints ?? []);
                  const previous=new Set((clip.waypoints??[]).map(p=>p.t));
                  const index=Math.max(0,points.findIndex(p=>!previous.has(p.t)));
                  store.updateClip(clip.id,{waypoints:points});
                  store.setActiveWaypoint({clipId:clip.id,index});
                  store.setControlMode("path");
                  store.setView("split");
                }}>+ Add route point</button>
              </div>
              <p className="my-2 text-xs text-muted">Select any point to edit it. Start is fixed so the camera never jumps. The end can be moved freely. Use Split view to see the route and the shot together.</p>
              <div className="flex flex-wrap gap-2">
                {(clip.waypoints??[]).map((point,index) =>
                  <button type="button" key={index} className="btn text-xs"
                    data-on={store.activeWaypoint?.clipId===clip.id&&store.activeWaypoint.index===index}
                    onClick={()=>{store.setActiveWaypoint({clipId:clip.id,index});store.setControlMode("path");store.setTime(clip.start+point.t*clip.duration);}}>
                    Point {index+1} · {Math.round(point.t*100)}%
                  </button>
                )}
              </div>
              {(() => {
                const index=store.activeWaypoint?.clipId===clip.id ? store.activeWaypoint.index : 1;
                const points=clip.waypoints??[];
                const point=points[index];
                if(!point) return <p className="text-xs text-muted">Choose a route point above.</p>;
                const change=(direction:"left"|"right"|"up"|"down"|"forward"|"backward")=>{
                  if(index===0){store.setStatus("The first point stays at the starting camera position");return;}
                  const next=points.map((p,i)=>i===index?{...p,offset:adjustWaypoint(p.offset,store.project.camera,direction,0.2)}:p);
                  store.updateClip(clip.id,{waypoints:next});
                };
                return <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <strong className="text-sm">Editing point {index+1}</strong>
                    <span className="text-xs text-muted">{index===0?"Fixed starting point":"Move it in the shot"}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(["left","right","up","down","forward","backward"] as const).map(direction=>
                      <button key={direction} type="button" className="btn text-xs" disabled={index===0}
                        onClick={()=>change(direction)}>{direction==="forward"?"Move toward subject":direction==="backward"?"Move away":`Move ${direction}`}</button>
                    )}
                  </div>
                  {index>0&&index<points.length-1?<label className="mt-3 block text-xs text-muted">When should the camera reach this point?
                    <input aria-label="Waypoint timing" className="w-full" type="range" min={points[index-1]!.t+0.01} max={points[index+1]!.t-0.01} step={0.01} value={point.t}
                      onChange={e=>store.updateClip(clip.id,{waypoints:points.map((p,i)=>i===index?{...p,t:Number(e.target.value)}:p)},true)} />
                    <span>{Math.round(point.t*100)}% of this movement</span>
                  </label>:null}
                  {points.length>2&&index>0&&index<points.length-1?
                    <button className="btn mt-2" type="button" onClick={()=>{store.updateClip(clip.id,{waypoints:points.filter((_,i)=>i!==index)});store.setActiveWaypoint({clipId:clip.id,index:Math.max(0,index-1)});}}>Remove selected point</button>:null}
                </div>;
              })()}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted">Advanced: exact coordinates and timings</summary>
                <p className="my-2 text-xs text-muted">Values are offsets from the original camera, in metres. Use only for technical adjustments.</p>
                {(clip.waypoints??[]).map((point,index)=>
                  <div key={index} className="my-2 grid grid-cols-4 gap-2 rounded-lg bg-surface p-2">
                    <NumberBox label="Progress %" value={point.t*100} step={5} onChange={v=>store.updateClip(clip.id,{waypoints:clip.waypoints!.map((p,i)=>i===index?{...p,t:Math.max(0,Math.min(100,v))/100}:p)},true)} />
                    {(["x","y","z"] as const).map(axis=><NumberBox key={axis} label={`${axis.toUpperCase()} m`} value={point.offset[axis]} step={0.1} onChange={v=>store.updateClip(clip.id,{waypoints:clip.waypoints!.map((p,i)=>i===index?{...p,offset:{...p.offset,[axis]:v}}:p)},true)} />)}
                  </div>
                )}
              </details>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">No moves yet. The camera holds still for the whole shot. Overlaps are allowed, so a pan can happen during a zoom.</p>
      )}
      {issues.map((issue) => (
        <p key={issue} className="text-sm text-primary">
          {issue}
        </p>
      ))}
    </div>
  );
}
