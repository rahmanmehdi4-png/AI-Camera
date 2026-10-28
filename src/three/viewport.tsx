import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { JointId } from "@/planner/skeleton";
import { usePlanner, type Selection } from "@/state/planner-store";
import { Stage, type StageHooks } from "./stage";

export type ViewportHandle = {
  capture: (kind: "pose" | "camera" | "annotated") => Promise<Blob>;
  frame: () => void;
  resetView: () => void;
  zoomView: (factor: number) => void;
};

export const Viewport = forwardRef<ViewportHandle>(function Viewport(_, ref) {
  const [renderError, setRenderError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const hooks = usePlanner();
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  useImperativeHandle(ref, () => ({
    capture: (kind) => {
      const stage = stageRef.current;
      if (!stage) return Promise.reject(new Error("The 3D view is not ready yet."));
      return stage.capture(kind);
    },
    frame: () => stageRef.current?.frame(),
    resetView: () => stageRef.current?.resetView(),
    zoomView: (factor) => stageRef.current?.zoomView(factor),
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const api: StageHooks = {
      getProject: () => hooksRef.current.project,
      getSelection: () => hooksRef.current.selection,
      getJoint: () => hooksRef.current.joint,
      getTool: () => hooksRef.current.tool,
      getControlMode: () => hooksRef.current.controlMode,
      getPathAxis: () => hooksRef.current.pathAxis,
      updateWaypoint: (clipId, index, offset) => {
        const clip = hooksRef.current.project.motions.find((m) => m.id === clipId);
        if (!clip?.waypoints) return;
        hooksRef.current.updateClip(clipId, { waypoints: clip.waypoints.map((p, i) => i === index ? { ...p, offset } : p) }, false);
      },
      getView: () => hooksRef.current.view,
      getTime: () => hooksRef.current.time,
      isPlaying: () => hooksRef.current.playing,
      setPlaying: (playing: boolean) => hooksRef.current.setPlaying(playing),
      setTime: (time) => hooksRef.current.setTime(time),
      begin: () => hooksRef.current.begin(),
      end: () => hooksRef.current.end(),
      select: (selection: Selection) => hooksRef.current.select(selection),
      setJoint: (joint: JointId | null) => hooksRef.current.setJoint(joint),
      applyDrag: (value, history) => hooksRef.current.applyDrag(value, history),
    };
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const quality = memory <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4 ? "low" : "high";
    let stage: Stage;
    try {
      stage = new Stage(canvas, api, quality);
    } catch (error) {
      setRenderError(true);
      hooksRef.current.setStatus(error instanceof Error ? error.message : "WebGL failed to start.");
      return;
    }
    stageRef.current = stage;
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  return <>
    <canvas ref={canvasRef} className="stage-canvas h-full w-full" aria-label="3D stage" />
    {renderError && <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none" role="alert">
      <div className="max-w-sm rounded-xl border border-border bg-surface p-5 text-center">
        <p className="font-semibold">3D rendering is unavailable</p>
        <p className="mt-2 text-sm text-muted">This browser could not start WebGL. Open the planner in a browser with graphics acceleration enabled. Your project controls and saved shots remain available.</p>
      </div>
    </div>}
  </>;
});
