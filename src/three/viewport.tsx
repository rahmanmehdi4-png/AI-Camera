import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent } from "react";
import type { JointId } from "@/planner/skeleton";
import { usePlanner, type Selection } from "@/state/planner-store";
import { Stage, type StageHooks } from "./stage";

export type ViewportHandle = {
  capture: (kind: "pose" | "camera" | "annotated", atTime?: number) => Promise<Blob>;
  frame: () => void;
  frameAll: () => void;
  resetView: () => void;
  zoomView: (factor: number) => void;
  focusJoint: () => void;
};

export const Viewport = forwardRef<ViewportHandle>(function Viewport(_, ref) {
  const [renderError, setRenderError] = useState(false);
  const [wide, setWide] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const hooks = usePlanner();
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  useImperativeHandle(ref, () => ({
    capture: (kind, atTime) => {
      const stage = stageRef.current;
      if (!stage) return Promise.reject(new Error("The 3D view is not ready yet."));
      return stage.capture(kind, atTime);
    },
    frame: () => stageRef.current?.frame(),
    frameAll: () => stageRef.current?.frameAll(),
    resetView: () => stageRef.current?.resetView(),
    zoomView: (factor) => stageRef.current?.zoomView(factor),
    focusJoint: () => stageRef.current?.focusJoint(),
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
      getActiveWaypoint: () => hooksRef.current.activeWaypoint,
      selectWaypoint: (clipId, index) => {
        hooksRef.current.setActiveWaypoint({clipId,index});
        hooksRef.current.setTime(hooksRef.current.project.motions.find(m=>m.id===clipId)?.start ?? 0);
      },
      updateWaypoint: (clipId, index, offset) => {
        const clip = hooksRef.current.project.motions.find((m) => m.id === clipId);
        if (!clip?.waypoints) return;
        hooksRef.current.updateClip(clipId, { waypoints: clip.waypoints.map((p, i) => i === index ? { ...p, offset } : p) }, false);
      },
      getView: () => hooksRef.current.view,
      getSplitRatio: () => hooksRef.current.splitRatio,
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if(!canvas || typeof ResizeObserver === "undefined") return;
    const resize = new ResizeObserver(() => {
      const rect=canvas.getBoundingClientRect();
      setWide(rect.width>=640 && rect.width>=rect.height);
    });
    resize.observe(canvas);
    return () => resize.disconnect();
  }, []);

  const resizeSplit = (event: PointerEvent<HTMLDivElement>) => {
    if(!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect=canvasRef.current?.getBoundingClientRect();
    if(!rect) return;
    const value=wide ? (event.clientX-rect.left)/rect.width : (event.clientY-rect.top)/rect.height;
    hooksRef.current.setSplitRatio(value);
  };
  return <>
    <canvas ref={canvasRef} className="stage-canvas h-full w-full" aria-label="3D stage" />
    {hooks.view==="split" ? <div
      role="separator" tabIndex={0} aria-label="Resize scene and shot previews"
      aria-orientation={wide?"vertical":"horizontal"} aria-valuenow={Math.round(hooks.splitRatio*100)} aria-valuemin={25} aria-valuemax={75}
      title="Drag to give more space to the Scene or Shot preview"
      className="absolute z-20 flex cursor-col-resize items-center justify-center touch-none"
      style={wide ? {left:`${hooks.splitRatio*100}%`,top:0,bottom:0,width:24,transform:"translateX(-50%)"} :
        {top:`${hooks.splitRatio*100}%`,left:0,right:0,height:24,transform:"translateY(-50%)",cursor:"row-resize"}}
      onPointerDown={e=>{e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={resizeSplit}
      onPointerUp={e=>{resizeSplit(e);e.currentTarget.releasePointerCapture(e.pointerId);}}
      onKeyDown={e=>{if(["ArrowLeft","ArrowUp"].includes(e.key)){e.preventDefault();hooks.setSplitRatio(hooks.splitRatio-0.05);}
        if(["ArrowRight","ArrowDown"].includes(e.key)){e.preventDefault();hooks.setSplitRatio(hooks.splitRatio+0.05);}}}>
      <span className={`rounded-full border border-accent bg-surface text-accent shadow-xl ${wide?"px-1 py-3":"px-3 py-1"}`} aria-hidden>⋮</span>
    </div> : null}
    {renderError && <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none" role="alert">
      <div className="max-w-sm rounded-xl border border-border bg-surface p-5 text-center">
        <p className="font-semibold">3D rendering is unavailable</p>
        <p className="mt-2 text-sm text-muted">This browser could not start WebGL. Open the planner in a browser with graphics acceleration enabled. Your project controls and saved shots remain available.</p>
      </div>
    </div>}
  </>;
});
