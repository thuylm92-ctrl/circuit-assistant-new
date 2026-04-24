import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Play, RotateCcw, Trash2, Upload, Send, MessageSquare,
  AlertCircle, ImageIcon, Zap, BarChart2, MoreHorizontal, Settings2,
  CheckCircle2, X, MousePointer2,
} from "lucide-react";
import {
  useSolveCircuit, useAnalyzeCircuit,
  useExtractProblem, useChatWithAI,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

// ─── Types ────────────────────────────────────────────────────────────────────
type ElementType =
  | "wire" | "resistor" | "capacitor" | "inductor"
  | "voltage_source" | "current_source" | "ground"
  | "vcvs" | "vccs" | "ccvs" | "cccs";

interface Pt { x: number; y: number }
interface CanvasEl {
  id: string; type: ElementType;
  start: Pt; end: Pt;
  value?: number; unit?: string; label?: string;
  controlBranchId?: string; gain?: number;
  unknown?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const GRID = 24;

const COMMON_TOOLS: { type: ElementType; short: string; full: string }[] = [
  { type: "wire",           short: "导线",  full: "导线" },
  { type: "resistor",       short: "电阻",  full: "电阻 R" },
  { type: "capacitor",      short: "电容",  full: "电容 C" },
  { type: "inductor",       short: "电感",  full: "电感 L" },
  { type: "voltage_source", short: "电压源", full: "直流电压源" },
  { type: "current_source", short: "电流源", full: "直流电流源" },
  { type: "ground",         short: "接地",  full: "接地 GND" },
];
const MORE_TOOLS: { type: ElementType; label: string }[] = [
  { type: "vcvs", label: "压控电压源 VCVS" },
  { type: "vccs", label: "压控电流源 VCCS" },
  { type: "ccvs", label: "流控电压源 CCVS" },
  { type: "cccs", label: "流控电流源 CCCS" },
];
const DEFAULT_UNIT: Record<string, string> = {
  resistor: "Ω", capacitor: "F", inductor: "H",
  voltage_source: "V", current_source: "A",
  vcvs: "V/V", vccs: "A/V", ccvs: "V/A", cccs: "A/A",
};
const TYPE_LABEL: Record<string, string> = {
  wire: "导线", resistor: "电阻", capacitor: "电容", inductor: "电感",
  voltage_source: "电压源", current_source: "电流源", ground: "接地",
  vcvs: "压控电压源", vccs: "压控电流源", ccvs: "流控电压源", cccs: "流控电流源",
};

// Demo resistor positions for the tour animation
const DEMO_START: Pt = { x: 96, y: 144 };
const DEMO_END: Pt   = { x: 240, y: 144 };

// ─── Tool icons (mini circuit-element schematics for the toolbar) ──────────
function ToolIcon({ type, className }: { type: ElementType; className?: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (type) {
    case "wire":
      return (
        <svg viewBox="0 0 28 16" className={className}>
          <line x1={2} y1={8} x2={26} y2={8} {...common} />
        </svg>
      );
    case "resistor":
      return (
        <svg viewBox="0 0 28 16" className={className}>
          <path d="M2 8 H7 L9 3 L11 13 L13 3 L15 13 L17 3 L19 13 L21 8 H26" {...common} />
        </svg>
      );
    case "capacitor":
      return (
        <svg viewBox="0 0 28 16" className={className}>
          <line x1={2} y1={8} x2={12} y2={8} {...common} />
          <line x1={12} y1={2} x2={12} y2={14} {...common} />
          <line x1={16} y1={2} x2={16} y2={14} {...common} />
          <line x1={16} y1={8} x2={26} y2={8} {...common} />
        </svg>
      );
    case "inductor":
      return (
        <svg viewBox="0 0 28 16" className={className}>
          <line x1={2} y1={8} x2={5} y2={8} {...common} />
          <path d="M5 8 A2.5 2.5 0 0 1 10 8 A2.5 2.5 0 0 1 15 8 A2.5 2.5 0 0 1 20 8 A2.5 2.5 0 0 1 25 8" {...common} />
          <line x1={25} y1={8} x2={26} y2={8} {...common} />
        </svg>
      );
    case "voltage_source":
      return (
        <svg viewBox="0 0 28 16" className={className}>
          <line x1={2} y1={8} x2={8} y2={8} {...common} />
          <circle cx={14} cy={8} r={5.5} {...common} />
          <line x1={11} y1={8} x2={13} y2={8} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          <line x1={12} y1={7} x2={12} y2={9} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          <line x1={15} y1={8} x2={17} y2={8} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          <line x1={20} y1={8} x2={26} y2={8} {...common} />
        </svg>
      );
    case "current_source":
      return (
        <svg viewBox="0 0 28 16" className={className}>
          <line x1={2} y1={8} x2={8} y2={8} {...common} />
          <circle cx={14} cy={8} r={5.5} {...common} />
          <line x1={10.5} y1={8} x2={17} y2={8} {...common} />
          <polyline points="15,5.5 17.5,8 15,10.5" {...common} />
          <line x1={20} y1={8} x2={26} y2={8} {...common} />
        </svg>
      );
    case "ground":
      return (
        <svg viewBox="0 0 28 16" className={className}>
          <line x1={14} y1={1} x2={14} y2={7} {...common} />
          <line x1={7} y1={7} x2={21} y2={7} {...common} />
          <line x1={9.5} y1={10.5} x2={18.5} y2={10.5} {...common} />
          <line x1={12} y1={14} x2={16} y2={14} {...common} />
        </svg>
      );
    // Controlled sources — diamond shape
    case "vcvs":
    case "ccvs":
      return (
        <svg viewBox="0 0 28 16" className={className}>
          <line x1={2} y1={8} x2={8} y2={8} {...common} />
          <polygon points="14,2.5 19.5,8 14,13.5 8.5,8" {...common} />
          <line x1={11.5} y1={8} x2={13} y2={8} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          <line x1={12.25} y1={7.25} x2={12.25} y2={8.75} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          <line x1={15} y1={8} x2={16.5} y2={8} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          <line x1={20} y1={8} x2={26} y2={8} {...common} />
        </svg>
      );
    case "vccs":
    case "cccs":
      return (
        <svg viewBox="0 0 28 16" className={className}>
          <line x1={2} y1={8} x2={8} y2={8} {...common} />
          <polygon points="14,2.5 19.5,8 14,13.5 8.5,8" {...common} />
          <line x1={11} y1={8} x2={16} y2={8} {...common} />
          <polyline points="14.5,5.8 16.5,8 14.5,10.2" {...common} />
          <line x1={20} y1={8} x2={26} y2={8} {...common} />
        </svg>
      );
    default:
      return null;
  }
}

// ─── Tour ────────────────────────────────────────────────────────────────────
type TourStep = "highlight-tool" | "canvas-demo" | "success" | null;

function useTour(ready: boolean, forceStep?: string | null) {
  const [step, setStep] = useState<TourStep>(null);
  const [demoPhase, setDemoPhase] = useState<0 | 1>(0);

  useEffect(() => {
    if (!ready) return;
    if (forceStep === "highlight") { setStep("highlight-tool"); return; }
    if (forceStep === "demo")      { setStep("canvas-demo");    return; }
    if (forceStep === "success")   { setStep("success");        return; }
    const done = localStorage.getItem("tour_done") === "true";
    const remaining = parseInt(localStorage.getItem("tour_remaining") ?? "3", 10);
    if (!done && remaining > 0) {
      localStorage.setItem("tour_remaining", String(remaining - 1));
      setStep("highlight-tool");
    }
  }, [ready, forceStep]);

  const dismiss = () => {
    localStorage.setItem("tour_done", "true");
    setStep(null);
  };

  return { step, setStep, demoPhase, setDemoPhase, dismiss };
}

// ─── SVG Element Rendering ─────────────────────────────────────────────────
function renderEl(
  el: CanvasEl | { id: string; start: Pt; end: Pt; type: string; label?: string; value?: number; unit?: string },
  preview = false,
) {
  const { start, end, type } = el;
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
  const c = "#1e40af", w = 2.5, h = len / 2;
  const T = `translate(${mx},${my}) rotate(${angle})`;

  let body = null;
  if (type === "wire") {
    body = <line x1={-h} y1={0} x2={h} y2={0} stroke={c} strokeWidth={w} />;
  } else if (type === "resistor") {
    const zw = Math.min(28, len * 0.5);
    body = (
      <path
        d={`M${-h} 0 L${-zw/2} 0 L${-zw/2+5} -8 L${-zw/2+13} 8 L${-zw/2+21} -8 L${zw/2} 0 L${h} 0`}
        fill="none" stroke={c} strokeWidth={w} strokeLinejoin="round"
      />
    );
  } else if (type === "capacitor") {
    const g = 7, ph = 14;
    body = <g>
      <line x1={-h} y1={0} x2={-g/2} y2={0} stroke={c} strokeWidth={w} />
      <line x1={g/2} y1={0} x2={h} y2={0} stroke={c} strokeWidth={w} />
      <line x1={-g/2} y1={-ph} x2={-g/2} y2={ph} stroke={c} strokeWidth={w + 1} />
      <line x1={g/2} y1={-ph} x2={g/2} y2={ph} stroke={c} strokeWidth={w + 1} />
    </g>;
  } else if (type === "inductor") {
    const iw = Math.min(32, len * 0.5);
    body = <g>
      <line x1={-h} y1={0} x2={-iw/2} y2={0} stroke={c} strokeWidth={w} />
      <path d={`M${-iw/2} 0 Q${-iw/2+6} -14 ${-iw/2+12} 0 T${-iw/2+24} 0 T${iw/2} 0`}
        fill="none" stroke={c} strokeWidth={w} />
      <line x1={iw/2} y1={0} x2={h} y2={0} stroke={c} strokeWidth={w} />
    </g>;
  } else if (type === "voltage_source" || type === "current_source") {
    const r = 13;
    body = <g>
      <line x1={-h} y1={0} x2={-r} y2={0} stroke={c} strokeWidth={w} />
      <line x1={r} y1={0} x2={h} y2={0} stroke={c} strokeWidth={w} />
      <circle cx={0} cy={0} r={r} fill="white" stroke={c} strokeWidth={w} />
      {type === "voltage_source" ? (
        <g transform="rotate(-90)">
          <text x={0} y={-4} fontSize="10" textAnchor="middle" fill={c} fontWeight="bold">+</text>
          <text x={0} y={10} fontSize="12" textAnchor="middle" fill={c}>−</text>
        </g>
      ) : (
        <g>
          <line x1={-7} y1={0} x2={7} y2={0} stroke={c} strokeWidth={w} />
          <polygon points="7,0 2,-4 2,4" fill={c} />
        </g>
      )}
    </g>;
  } else if (type === "ground") {
    return (
      <g key={el.id} opacity={preview ? 0.5 : 1}>
        <line x1={start.x} y1={start.y} x2={start.x} y2={start.y + 10} stroke={c} strokeWidth={w} />
        <line x1={start.x - 12} y1={start.y + 10} x2={start.x + 12} y2={start.y + 10} stroke={c} strokeWidth={w} />
        <line x1={start.x - 7} y1={start.y + 15} x2={start.x + 7} y2={start.y + 15} stroke={c} strokeWidth={w} />
        <line x1={start.x - 2} y1={start.y + 20} x2={start.x + 2} y2={start.y + 20} stroke={c} strokeWidth={w} />
      </g>
    );
  } else {
    const s = 14;
    body = <g>
      <line x1={-h} y1={0} x2={-s} y2={0} stroke={c} strokeWidth={w} />
      <line x1={s} y1={0} x2={h} y2={0} stroke={c} strokeWidth={w} />
      <polygon points={`0,${-s} ${s},0 0,${s} ${-s},0`} fill="white" stroke={c} strokeWidth={w} />
      <text x={0} y={4} fontSize="8" textAnchor="middle" fill={c}>{String(type).toUpperCase()}</text>
    </g>;
  }

  const label = (el as CanvasEl).label;
  const val   = (el as CanvasEl).value;
  const unit  = (el as CanvasEl).unit ?? "";
  const isUnknown = (el as CanvasEl).unknown === true;

  return (
    <g key={el.id} opacity={preview ? 0.45 : 1}>
      <g transform={T}>{body}</g>
      {!preview && <circle cx={start.x} cy={start.y} r={3} fill={c} />}
      {!preview && type !== "ground" && <circle cx={end.x} cy={end.y} r={3} fill={c} />}
      {!preview && label && (
        <text x={mx} y={my - 14} textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="bold">
          {label}{isUnknown ? " = ?" : (val !== undefined ? ` ${val}${unit}` : "")}
        </text>
      )}
    </g>
  );
}

// ─── Tour Canvas Overlay (SVG elements) ──────────────────────────────────────
function TourCanvasOverlay({ step, demoPhase }: { step: TourStep; demoPhase: 0 | 1 }) {
  if (step !== "canvas-demo") return null;

  return (
    <>
      {/* Dimming overlay */}
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.28)" style={{ pointerEvents: "none" }} />

      {/* Phase 0: start point */}
      {demoPhase === 0 && (
        <g style={{ pointerEvents: "none" }}>
          <circle cx={DEMO_START.x} cy={DEMO_START.y} r={22} fill="rgba(30,64,175,0.25)" className="tour-ripple" />
          <circle cx={DEMO_START.x} cy={DEMO_START.y} r={13} fill="rgba(30,64,175,0.4)" className="tour-ping" />
          <circle cx={DEMO_START.x} cy={DEMO_START.y} r={6}  fill="#1e40af" />
          {/* Finger tap icon */}
          <text x={DEMO_START.x} y={DEMO_START.y - 30} textAnchor="middle" fontSize="20">👆</text>
          {/* Label bubble */}
          <rect x={DEMO_START.x - 44} y={DEMO_START.y + 14} width={88} height={24} rx={6} fill="white" opacity={0.96} />
          <text x={DEMO_START.x} y={DEMO_START.y + 30} textAnchor="middle" fontSize="12" fill="#1e40af" fontWeight="bold">
            第一步：点击起点
          </text>
        </g>
      )}

      {/* Phase 1: end point + preview resistor */}
      {demoPhase === 1 && (
        <g style={{ pointerEvents: "none" }}>
          {/* Start dot (dimmed) */}
          <circle cx={DEMO_START.x} cy={DEMO_START.y} r={5} fill="rgba(30,64,175,0.5)" />
          {/* Preview resistor */}
          {renderEl({ id: "tour-preview", start: DEMO_START, end: DEMO_END, type: "resistor" }, false)}
          {/* End point animation */}
          <circle cx={DEMO_END.x} cy={DEMO_END.y} r={22} fill="rgba(30,64,175,0.25)" className="tour-ripple" />
          <circle cx={DEMO_END.x} cy={DEMO_END.y} r={13} fill="rgba(30,64,175,0.4)" className="tour-ping" />
          <circle cx={DEMO_END.x} cy={DEMO_END.y} r={6}  fill="#1e40af" />
          {/* Finger tap icon */}
          <text x={DEMO_END.x} y={DEMO_END.y - 30} textAnchor="middle" fontSize="20">👆</text>
          {/* Label bubble */}
          <rect x={DEMO_END.x - 44} y={DEMO_END.y + 14} width={88} height={24} rx={6} fill="white" opacity={0.96} />
          <text x={DEMO_END.x} y={DEMO_END.y + 30} textAnchor="middle" fontSize="12" fill="#1e40af" fontWeight="bold">
            第二步：点击终点
          </text>
        </g>
      )}
    </>
  );
}

// ─── Tour Step Tooltip ────────────────────────────────────────────────────────
function TourTooltip({
  step, onSkip, onDismiss,
}: { step: TourStep; onSkip: () => void; onDismiss: () => void }) {
  if (!step) return null;

  return (
    <div className="absolute left-3 right-3 z-40 animate-in slide-in-from-top-2"
      style={{ top: "8px" }}>
      {step === "highlight-tool" && (
        <div className="bg-card border-2 border-primary rounded-2xl shadow-xl p-3.5 flex items-start gap-3">
          {/* Arrow decoration */}
          <div className="absolute -top-2.5 left-8 w-4 h-4 bg-card border-l-2 border-t-2 border-primary rotate-45" />
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-primary text-sm font-bold">1</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground">点击"电阻"元件</p>
            <p className="text-xs text-muted-foreground mt-0.5">从工具栏中选择高亮的电阻，我来演示如何在画布上放置它。</p>
          </div>
          <button onClick={onSkip} className="shrink-0 text-muted-foreground hover:text-foreground p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {step === "canvas-demo" && (
        <div className="bg-card border-2 border-primary/50 rounded-2xl shadow-xl p-3.5 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-primary text-sm font-bold">2</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground">在画布上点击两次</p>
            <p className="text-xs text-muted-foreground mt-0.5">先点击起点，再点击终点，一个元件就放置完成了。</p>
          </div>
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0 mt-1" />
        </div>
      )}

      {step === "success" && (
        <div className="bg-card border-2 border-green-500/50 rounded-2xl shadow-xl p-3.5 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground">电阻放置成功！</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              放置元件后会自动切回"选择"模式：点击画布上的任意元件即可<span className="text-foreground font-medium">修改参数或删除</span>。继续添加电压源、接地等元件，完成后点击"提交求解"获得答案。
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="shrink-0 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded-lg active:opacity-80 whitespace-nowrap">
            我知道了
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Reference-node inference (used when no GND element is placed) ──────────
// Returns the node-id string ("x,y") that should be treated as ground (0V), or
// `null` when there isn't enough topology to infer one. Also returns a short
// human-friendly reason describing why that node was chosen, for the status bar.
function inferReferenceNode(els: CanvasEl[]): { nodeId: string; reason: string } | null {
  const nonMeta = els.filter((e) => e.type !== "ground");
  if (nonMeta.length === 0) return null;
  const nid = (p: Pt) => `${p.x},${p.y}`;

  // Priority 1: pick a DC voltage source's negative terminal (= nodeTo by the
  // SVG convention used in renderEl: "+" rotates to nodeFrom side).
  const vsrcs = nonMeta.filter((e) => e.type === "voltage_source");
  if (vsrcs.length > 0) {
    // Multiple sources → prefer the one whose negative terminal is visually lowest.
    const best = vsrcs.slice().sort((a, b) => b.end.y - a.end.y)[0];
    return {
      nodeId: nid(best.end),
      reason: `已自动将 ${best.label ?? best.id} 的负极设为参考点`,
    };
  }

  // Priority 2: union-find connected groups across all wires/elements; pick the
  // group with the most members (≈ longest bus), then the node with greatest y.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur)!;
      parent.set(cur, parent.get(p)!);
      cur = parent.get(cur)!;
    }
    return cur;
  };
  const ensure = (id: string) => { if (!parent.has(id)) parent.set(id, id); };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const ptOf = new Map<string, Pt>();
  for (const el of nonMeta) {
    const a = nid(el.start), b = nid(el.end);
    ensure(a); ensure(b);
    ptOf.set(a, el.start); ptOf.set(b, el.end);
    union(a, b);
  }
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(id);
  }
  let bestGroup: string[] | null = null;
  for (const g of groups.values()) {
    if (!bestGroup || g.length > bestGroup.length) bestGroup = g;
  }
  if (bestGroup && bestGroup.length > 0) {
    const sorted = bestGroup.slice().sort((a, b) => (ptOf.get(b)!.y - ptOf.get(a)!.y));
    return {
      nodeId: sorted[0],
      reason: "已自动将画布最下方的连通节点设为参考点",
    };
  }

  // Priority 3 (degenerate fallback): any node we've seen.
  const first = nid(nonMeta[0].start);
  return { nodeId: first, reason: "已自动选择默认参考点" };
}

// Default placeholder values used when an element is marked "待定" (unknown):
// MNA still needs a finite number to factor the matrix, so we substitute a
// safe non-zero default keyed by element type.
function placeholderForUnknown(type: ElementType): { value: number; unit: string } {
  switch (type) {
    case "resistor":       return { value: 1,       unit: "Ω" };
    case "capacitor":      return { value: 1e-6,    unit: "F" };
    case "inductor":       return { value: 1e-3,    unit: "H" };
    case "voltage_source": return { value: 1,       unit: "V" };
    case "current_source": return { value: 1,       unit: "A" };
    case "vcvs":           return { value: 1,       unit: "V/V" };
    case "vccs":           return { value: 1,       unit: "A/V" };
    case "ccvs":           return { value: 1,       unit: "V/A" };
    case "cccs":           return { value: 1,       unit: "A/A" };
    default:               return { value: 1,       unit: "" };
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────
type Tab = "upload" | "canvas" | "results" | "chat";

export default function Solve() {
  const { toast } = useToast();

  // ── Tab
  const [tab, setTab] = useState<Tab>("canvas");

  // ── Demo mode: ?tour=1 in URL skips the gate and force-replays the tour
  //    Optional ?step=highlight|demo|success jumps directly to a phase
  const urlParams = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const isDemoMode = urlParams.get("tour") === "1";
  const demoStartStep = urlParams.get("step");

  useEffect(() => {
    if (isDemoMode) {
      localStorage.removeItem("tour_done");
      localStorage.setItem("tour_remaining", "1");
    }
  }, [isDemoMode]);

  // ── Upload gate (shown first before canvas; skipped in demo mode)
  const [showUploadGate, setShowUploadGate] = useState(!isDemoMode);

  // ── Upload
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [problemExtracted, setProblemExtracted] = useState<{
    isCircuitRelated: boolean; confidence: number;
    problemText?: string; targetVariables?: string[]; constraints?: string[];
  } | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // ── Canvas
  const [elements, setElements] = useState<CanvasEl[]>([]);
  const [history, setHistory] = useState<CanvasEl[][]>([]);
  const [selectedTool, setSelectedTool] = useState<ElementType | null>(null);
  const [drawingStart, setDrawingStart] = useState<Pt | null>(null);
  const [previewEnd, setPreviewEnd] = useState<Pt | null>(null);
  const [showMoreTools, setShowMoreTools] = useState(false);

  // Track the latest elements via a ref so deferred callers (e.g. the toast
  // "undo" action that fires seconds after a deletion) always snapshot the
  // current canvas, not a stale closure value.
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  // commitElements: snapshot current state into history then mutate.
  // Used for every user-initiated mutation so undo can restore it
  // (placement, edits, deletion, clear). Tour-driven changes bypass this.
  // If the updater returns the same reference (no-op), we skip the snapshot
  // so the undo stack never grows from no-ops.
  const commitElements = useCallback((updater: (prev: CanvasEl[]) => CanvasEl[]) => {
    const prev = elementsRef.current;
    const next = updater(prev);
    if (next === prev) return;
    setHistory(h => [...h, prev].slice(-50));
    setElements(next);
  }, []);
  const undo = () => {
    setHistory(h => {
      if (!h.length) return h;
      setElements(h[h.length - 1]);
      return h.slice(0, -1);
    });
  };

  // ── Prop dialog
  const [propOpen, setPropOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editProps, setEditProps] = useState<Partial<CanvasEl>>({});
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // ── Analysis settings
  const [analysisType, setAnalysisType] = useState<"dc" | "ac">("dc");
  const [acFreq, setAcFreq] = useState(50);

  // ── Solution
  const [solution, setSolution] = useState<{
    nodeVoltages: { nodeId: string; voltage: number; voltageImag?: number; unit: string }[];
    branchCurrents: { elementId: string; current: number; currentImag?: number; unit: string }[];
    analysisType: string;
  } | null>(null);
  const [analysis, setAnalysis] = useState<{
    steps: { stepNumber: number; title: string; explanation: string; formula?: string }[];
    summary: string; keyInsights: string[];
  } | null>(null);
  const [solveError, setSolveError] = useState<string | null>(null);
  // Labels of elements that were marked "待定" in the most recent solve — used
  // to show a hint on the results page so students know the AI is reasoning
  // symbolically over those parameters.
  const [unknownInLastSolve, setUnknownInLastSolve] = useState<string[]>([]);

  // ── Chat
  const [chatMsgs, setChatMsgs] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── SVG ref
  const svgRef = useRef<SVGSVGElement>(null);

  // ── API hooks
  const extractProblem  = useExtractProblem();
  const solveCircuit    = useSolveCircuit();
  const analyzeCircuit  = useAnalyzeCircuit();
  const chatWithAI      = useChatWithAI();

  // ── Tour (only starts after upload gate is dismissed)
  const { step: tourStep, setStep: setTourStep, demoPhase, setDemoPhase, dismiss: dismissTour } = useTour(!showUploadGate, demoStartStep);

  // Auto-switch to canvas tab when tour starts
  useEffect(() => {
    if (tourStep === "highlight-tool") setTab("canvas");
  }, [tourStep]);

  // Advance tour when user selects resistor
  useEffect(() => {
    if (tourStep === "highlight-tool" && selectedTool === "resistor") {
      setTourStep("canvas-demo");
      setDemoPhase(0);
    }
  }, [selectedTool, tourStep]);

  // Canvas demo sequence
  useEffect(() => {
    if (tourStep !== "canvas-demo") return;
    if (demoPhase === 0) {
      const t = setTimeout(() => setDemoPhase(1), 3200);
      return () => clearTimeout(t);
    }
    if (demoPhase === 1) {
      const t = setTimeout(() => {
        setElements(prev => [...prev, {
          id: "demo-r1", type: "resistor" as ElementType,
          start: DEMO_START, end: DEMO_END,
          value: 10, unit: "Ω", label: "R1",
        }]);
        setSelectedTool(null);
        setDrawingStart(null);
        setPreviewEnd(null);
        setTourStep("success");
      }, 3200);
      return () => clearTimeout(t);
    }
  }, [demoPhase, tourStep]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs]);

  // ── Helpers
  const snap = (v: number) => Math.round(v / GRID) * GRID;
  const svgPt = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: snap(clientX - rect.left), y: snap(clientY - rect.top) };
  }, []);

  // Builds the payload sent to /api/circuit/solve and /api/ai/analyze.
  // Returns the input plus metadata describing how unknown ("待定") values were
  // substituted and whether a reference node had to be inferred — both pieces
  // are surfaced in the UI but never leak into the server request itself.
  const buildCircuitInput = () => {
    const hasGround = elements.some((e) => e.type === "ground");
    const inferred = hasGround ? null : inferReferenceNode(elements);
    const refNode = inferred?.nodeId ?? null;

    const remap = (id: string) => (refNode !== null && id === refNode ? "0" : id);

    const rawNodeIds = elements.flatMap((e) => [
      `${e.start.x},${e.start.y}`,
      e.type === "ground" ? "0" : `${e.end.x},${e.end.y}`,
    ]);
    const nodes = Array.from(new Set(rawNodeIds.map(remap))).map((id) => ({ id }));

    const unknownLabels: string[] = [];
    const outElements = elements.map((e) => {
      const from = remap(`${e.start.x},${e.start.y}`);
      const to = e.type === "ground" ? "0" : remap(`${e.end.x},${e.end.y}`);
      let value = e.value;
      let unit = e.unit;
      if (e.unknown && e.type !== "wire" && e.type !== "ground") {
        const ph = placeholderForUnknown(e.type);
        value = ph.value;
        unit = unit ?? ph.unit;
        unknownLabels.push(e.label ?? e.id);
      }
      return {
        id: e.id, type: e.type,
        nodeFrom: from,
        nodeTo: to,
        value, unit, label: e.label,
        controlBranchId: e.controlBranchId, gain: e.gain,
      };
    });

    return {
      input: {
        nodes,
        elements: outElements,
        analysisType,
        frequency: acFreq,
      },
      autoReference: inferred,
      unknownLabels,
    };
  };

  // ── Live circuit validation status (mirrors server-side validateCircuit but
  //    runs locally on every elements change so the user gets instant feedback).
  const circuitStatus = useMemo<{ ok: boolean; message: string; empty: boolean }>(() => {
    if (!elements.length) {
      return { ok: false, empty: true, message: "请放置元件以开始绘制电路" };
    }

    // Per-element value sanity (mirrors server validateCircuit value checks).
    // Elements marked "待定" (unknown) are skipped here — they're substituted
    // with a safe placeholder by buildCircuitInput before being sent to MNA.
    for (const el of elements) {
      if (el.type === "wire" || el.type === "ground") continue;
      if (el.unknown) continue;
      if (el.value === undefined || el.value === null || Number.isNaN(el.value)) {
        return { ok: false, empty: false, message: `元件 ${el.label ?? el.id} 缺少有效数值（可勾选"待定"由 AI 求解）` };
      }
      if (el.type === "resistor" && el.value <= 0) {
        return { ok: false, empty: false, message: `电阻 ${el.label ?? el.id} 的值必须大于 0` };
      }
      if ((el.type === "capacitor" || el.type === "inductor") && el.value < 0) {
        return { ok: false, empty: false, message: `${el.type === "capacitor" ? "电容" : "电感"} ${el.label ?? el.id} 的值不能为负` };
      }
      if (
        (el.type === "vcvs" || el.type === "vccs" || el.type === "ccvs" || el.type === "cccs") &&
        !el.controlBranchId
      ) {
        return { ok: false, empty: false, message: `受控源 ${el.label ?? el.id} 缺少控制支路` };
      }
    }

    // Reference node: prefer an explicit GND element; otherwise auto-infer.
    const hasGround = elements.some((e) => e.type === "ground");
    const inferred = hasGround ? null : inferReferenceNode(elements);
    if (!hasGround && !inferred) {
      return { ok: false, empty: false, message: "无法自动选择参考点，请放置一个接地元件" };
    }
    const refNodeId = hasGround ? "0" : inferred!.nodeId;

    // Build node ids the same way buildCircuitInput does, then run union-find
    // across non-ground elements (wires and components alike merge their two
    // endpoints' connectivity). Ground elements anchor their start point to "0".
    const nodeId = (p: Pt) => `${p.x},${p.y}`;
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let cur = x;
      while (parent.get(cur) !== cur) {
        const p = parent.get(cur)!;
        parent.set(cur, parent.get(p)!);
        cur = parent.get(cur)!;
      }
      return cur;
    };
    const union = (a: string, b: string) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const ensure = (id: string) => { if (!parent.has(id)) parent.set(id, id); };

    ensure(refNodeId);
    for (const el of elements) {
      if (el.type === "ground") {
        const a = nodeId(el.start);
        ensure(a);
        union(a, refNodeId);
        continue;
      }
      const a = nodeId(el.start), b = nodeId(el.end);
      ensure(a); ensure(b);
      union(a, b); // every two-terminal element makes its endpoints electrically reachable
    }

    // Every component endpoint must be in the same connected set as the
    // reference node; otherwise the user has a floating sub-network.
    const refRoot = find(refNodeId);
    for (const el of elements) {
      if (el.type === "ground") continue;
      const a = nodeId(el.start), b = nodeId(el.end);
      if (find(a) !== refRoot || find(b) !== refRoot) {
        return {
          ok: false, empty: false,
          message: `元件 ${el.label ?? el.id} 未与参考节点连通，请用导线连接`,
        };
      }
    }

    // At least one non-trivial element must exist (just a wire + ground isn't a circuit)
    const hasComponent = elements.some(
      (e) => e.type !== "wire" && e.type !== "ground",
    );
    if (!hasComponent) {
      return { ok: false, empty: false, message: "电路中需要至少一个元件（电阻、电源等）" };
    }

    const unknownCount = elements.filter((e) => e.unknown).length;
    const parts: string[] = ["电路结构有效，可以提交求解"];
    if (!hasGround && inferred) parts.push(inferred.reason);
    if (unknownCount > 0) parts.push(`${unknownCount} 个待定参数将由 AI 推导`);
    return { ok: true, empty: false, message: parts.join("；") };
  }, [elements]);

  // ── Canvas interaction
  const handlePoint = (clientX: number, clientY: number) => {
    if (!selectedTool || tourStep === "canvas-demo") return;
    const pt = svgPt(clientX, clientY);

    if (selectedTool === "ground") {
      commitElements(prev => [...prev, {
        id: Math.random().toString(36).slice(2), type: "ground",
        start: pt, end: { x: pt.x, y: pt.y + GRID }, label: "GND",
      }]);
      // Auto-return to select mode after placing ground (one-click element)
      setSelectedTool(null);
      return;
    }
    if (!drawingStart) {
      setDrawingStart(pt); setPreviewEnd(pt);
    } else {
      if (drawingStart.x === pt.x && drawingStart.y === pt.y) {
        setDrawingStart(null); setPreviewEnd(null); return;
      }
      const placedTool = selectedTool;
      const newEl: CanvasEl = {
        id: Math.random().toString(36).slice(2),
        type: placedTool, start: drawingStart, end: pt,
        value: 1, unit: DEFAULT_UNIT[placedTool] ?? "",
        label: `${placedTool[0].toUpperCase()}${elements.length + 1}`,
      };
      commitElements(prev => [...prev, newEl]);
      setDrawingStart(null); setPreviewEnd(null);
      if (placedTool !== "wire") {
        // Auto-return to select mode for non-wire elements so the next
        // canvas click edits an element instead of starting a new placement.
        // (Wires are commonly drawn in sequence, so keep wire tool active.)
        setSelectedTool(null);
        setEditId(newEl.id); setEditProps(newEl); setPropOpen(true);
      }
    }
  };

  const onMouseClick = (e: React.MouseEvent<SVGSVGElement>) => handlePoint(e.clientX, e.clientY);
  const onMouseMove  = (e: React.MouseEvent<SVGSVGElement>) => {
    if (drawingStart) setPreviewEnd(svgPt(e.clientX, e.clientY));
  };
  const onTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    e.preventDefault(); const t = e.touches[0]; handlePoint(t.clientX, t.clientY);
  };
  const onTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (drawingStart) setPreviewEnd(svgPt(e.touches[0].clientX, e.touches[0].clientY));
  };

  // ── Actions
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;

    // Compress the image client-side to keep the payload reasonable for the AI
    // (max 1600px on the long side, JPEG quality 0.85 — keeps text readable).
    const compressImage = (file: File): Promise<{ dataUrl: string; mimeType: string }> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("read failed"));
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error("decode failed"));
          img.onload = () => {
            const MAX = 1600;
            let { width, height } = img;
            if (width > MAX || height > MAX) {
              const scale = MAX / Math.max(width, height);
              width = Math.round(width * scale);
              height = Math.round(height * scale);
            }
            const canvas = document.createElement("canvas");
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) { reject(new Error("no ctx")); return; }
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
            resolve({ dataUrl, mimeType: "image/jpeg" });
          };
          img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
      });
    };

    try {
      const { dataUrl, mimeType } = await compressImage(file);
      setImagePreview(dataUrl);
      try {
        const result = await extractProblem.mutateAsync({
          data: { imageBase64: dataUrl.split(",")[1], mimeType },
        });
        setProblemExtracted(result);
        if (!result.isCircuitRelated) setShowConfirmDialog(true);
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? "无法从图片中提取题目信息，请尝试更清晰的图片。";
        toast({ title: "提取失败", description: msg, variant: "destructive" });
      }
    } catch {
      toast({ title: "图片处理失败", description: "无法读取该图片，请换一张试试。", variant: "destructive" });
    }
  };

  const handleSolve = async () => {
    if (!elements.length) { toast({ title: "提示", description: "请先绘制电路", variant: "destructive" }); return; }
    setSolveError(null);
    // Clear stale analysis/hint from any previous solve up-front so the results
    // tab never displays the prior solution's "待定" labels alongside this run's
    // numbers (matches what the user just clicked solve for).
    setAnalysis(null);
    const { input, unknownLabels } = buildCircuitInput();
    setUnknownInLastSolve(unknownLabels);
    try {
      const sol = await solveCircuit.mutateAsync({ data: input });
      setSolution(sol);
      toast({ title: "求解完成", description: "正在生成 AI 解析..." });
      setTab("results");
      const ana = await analyzeCircuit.mutateAsync({
        data: {
          circuit: input,
          solution: sol,
          problemText: problemExtracted?.problemText,
          ...(unknownLabels.length > 0 ? { unknownElements: unknownLabels } : {}),
        },
      });
      setAnalysis(ana);
    } catch (err: unknown) {
      // Make sure no half-finished analysis bleeds into the results pane.
      setAnalysis(null);
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? "无法求解此电路，请检查拓扑（接地、元件连接）。";
      setSolveError(msg);
      toast({ title: "求解失败", description: msg, variant: "destructive" });
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    const newMsgs = [...chatMsgs, { role: "user", content: chatInput }];
    setChatMsgs(newMsgs); setChatInput("");
    try {
      const res = await chatWithAI.mutateAsync({
        data: {
          messages: newMsgs.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
          solution: solution ?? undefined, analysis: analysis ?? undefined,
        },
      });
      setChatMsgs([...newMsgs, { role: "assistant", content: res.content }]);
    } catch { toast({ title: "错误", description: "发送失败", variant: "destructive" }); }
  };

  const isLoading = solveCircuit.isPending || analyzeCircuit.isPending;
  const isTourDemo = tourStep === "canvas-demo";

  // Dismiss gate and proceed to canvas
  const enterCanvas = () => {
    setShowUploadGate(false);
    setTab("canvas");
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

      {/* ── UPLOAD GATE ─────────────────────────────────────────────────── */}
      {showUploadGate && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
          {/* Gate header */}
          <header className="shrink-0 flex items-center px-4 h-12 border-b border-border bg-card">
            <div className="flex items-center gap-2 text-primary font-bold">
              <Zap className="w-4 h-4" />
              <span className="text-sm">电路解题助手</span>
            </div>
          </header>

          <ScrollArea className="flex-1">
            <div className="px-4 py-6 space-y-5 max-w-lg mx-auto">
              {/* Title */}
              <div className="space-y-1">
                <h1 className="text-xl font-bold">上传题目图片</h1>
                <p className="text-sm text-muted-foreground">
                  AI 将自动识别题目内容，提取已知量和求解目标，帮助您更准确地绘制电路。
                </p>
              </div>

              {/* Upload area */}
              <label
                htmlFor="gate-img-input"
                className="block border-2 border-dashed border-border hover:border-primary/50 active:border-primary rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-muted/20 transition-colors"
              >
                <input
                  type="file"
                  id="gate-img-input"
                  className="sr-only"
                  accept="image/*"
                  onChange={handleImageUpload}
                />
                {!imagePreview ? (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                      <Upload className="w-8 h-8 text-primary" />
                    </div>
                    <p className="font-semibold text-base">点击选择题目图片</p>
                    <p className="text-xs text-muted-foreground mt-1.5">支持 JPG、PNG 格式</p>
                  </>
                ) : (
                  <div className="relative w-full">
                    <img
                      src={imagePreview}
                      alt="题目图片"
                      className="max-w-full max-h-64 object-contain rounded-xl mx-auto"
                    />
                    {extractProblem.isPending && (
                      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 rounded-xl">
                        <div className="w-8 h-8 border-[3px] border-primary border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm text-primary font-semibold">AI 识别中...</span>
                      </div>
                    )}
                    {!extractProblem.isPending && (
                      <div className="mt-3 text-xs text-muted-foreground">点击重新选择图片</div>
                    )}
                  </div>
                )}
              </label>

              {/* Extracted content */}
              {problemExtracted && !extractProblem.isPending && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="rounded-xl border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30 p-4 flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-sm text-green-800 dark:text-green-300">识别成功</p>
                      <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                        {problemExtracted.isCircuitRelated ? "已检测到电路题目" : "未确认为电路题，仍可继续"}
                      </p>
                    </div>
                  </div>

                  {problemExtracted.problemText && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">提取的题目文字</p>
                      <div className="text-sm bg-muted/40 border border-border rounded-xl p-3 leading-relaxed whitespace-pre-wrap">
                        {problemExtracted.problemText}
                      </div>
                    </div>
                  )}

                  {!!problemExtracted.targetVariables?.length && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">求解目标</p>
                      <div className="flex flex-wrap gap-2">
                        {problemExtracted.targetVariables.map((v, i) => (
                          <Badge key={i} className="bg-primary/10 text-primary border-primary/20">{v}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* CTA button */}
              <button
                onClick={enterCanvas}
                disabled={extractProblem.isPending}
                className="w-full h-14 rounded-xl bg-primary text-primary-foreground font-semibold text-base flex items-center justify-center gap-2 shadow-lg disabled:opacity-60 active:opacity-90 transition-opacity"
              >
                {problemExtracted ? "开始绘制电路" : "上传后开始绘制"}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>

              {/* Skip */}
              <button
                onClick={enterCanvas}
                className="w-full text-center text-sm text-muted-foreground py-2 active:text-foreground transition-colors"
              >
                跳过，直接绘制电路
              </button>
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Top header */}
      <header className="shrink-0 flex items-center justify-between px-4 h-12 border-b border-border bg-card z-20">
        <Link href="/" className="flex items-center gap-1.5 text-primary font-bold">
          <Zap className="w-4 h-4" />
          <span className="text-sm">电路解题助手</span>
        </Link>
        <div className="flex items-center gap-2">
          <Select value={analysisType} onValueChange={v => setAnalysisType(v as "dc" | "ac")}>
            <SelectTrigger className="h-8 w-24 text-xs border-primary/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dc" className="text-xs">直流 DC</SelectItem>
              <SelectItem value="ac" className="text-xs">交流 AC</SelectItem>
            </SelectContent>
          </Select>
          {analysisType === "ac" && (
            <div className="flex items-center gap-1">
              <Input type="number" value={acFreq} onChange={e => setAcFreq(Number(e.target.value))}
                className="h-8 w-16 text-xs px-2" />
              <span className="text-xs text-muted-foreground">Hz</span>
            </div>
          )}
        </div>
      </header>

      {/* ── TAB CONTENT ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden relative">

        {/* ── UPLOAD TAB ── */}
        {tab === "upload" && (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-5 pb-24">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-primary" />
                上传题目图片
              </h2>
              <label htmlFor="img-input" className="block border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-muted/20 transition-colors active:bg-muted/40">
                <input type="file" id="img-input" className="sr-only" accept="image/*" onChange={handleImageUpload} />
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <Upload className="w-6 h-6 text-primary" />
                </div>
                <p className="font-medium text-sm">点击选择图片</p>
                <p className="text-xs text-muted-foreground mt-1">支持 JPG、PNG</p>
              </label>
              {imagePreview && (
                <div className="rounded-xl overflow-hidden border border-border relative bg-muted flex items-center justify-center min-h-[180px]">
                  <img src={imagePreview} alt="题目图片" className="max-w-full max-h-72 object-contain" />
                  {extractProblem.isPending && (
                    <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center gap-2">
                      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-primary font-medium">AI 识别中...</span>
                    </div>
                  )}
                </div>
              )}
              {problemExtracted && (
                <div className="space-y-4 animate-in fade-in">
                  {problemExtracted.problemText && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">题目文本</p>
                      <div className="text-sm bg-muted/30 p-3 rounded-xl border border-border leading-relaxed whitespace-pre-wrap">
                        {problemExtracted.problemText}
                      </div>
                    </div>
                  )}
                  {!!problemExtracted.targetVariables?.length && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">求解目标</p>
                      <div className="flex flex-wrap gap-2">
                        {problemExtracted.targetVariables.map((v, i) => (
                          <Badge key={i} className="bg-primary/10 text-primary border-primary/20 text-xs">{v}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <Button className="w-full h-12" onClick={() => setTab("canvas")}>
                    开始绘制电路
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* ── CANVAS TAB ── */}
        {tab === "canvas" && (
          <div className="h-full flex flex-col">
            {/* Element toolbar */}
            <div className="shrink-0 bg-card border-b border-border">
              <div className="flex items-center gap-1.5 px-2 py-2 overflow-x-auto no-scrollbar">
                {/* Select / pointer tool — exits placement mode so canvas clicks
                    edit existing elements instead of starting a new placement. */}
                <button
                  onClick={() => { setSelectedTool(null); setDrawingStart(null); setPreviewEnd(null); }}
                  className={[
                    "shrink-0 pl-2 pr-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5",
                    selectedTool === null
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-card text-foreground border-border active:bg-muted",
                  ].join(" ")}
                  data-testid="tool-select"
                >
                  <MousePointer2 className="w-4 h-4 shrink-0" />
                  <span>选择</span>
                </button>
                {COMMON_TOOLS.map(t => {
                  const isHighlighted = tourStep === "highlight-tool" && t.type === "resistor";
                  return (
                    <button
                      key={t.type}
                      onClick={() => { setSelectedTool(t.type); setDrawingStart(null); }}
                      className={[
                        "shrink-0 pl-2 pr-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5",
                        selectedTool === t.type
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : isHighlighted
                            ? "bg-primary/20 text-primary border-primary tour-btn-glow"
                            : "bg-card text-foreground border-border active:bg-muted",
                      ].join(" ")}
                    >
                      <ToolIcon type={t.type} className="w-7 h-4 shrink-0" />
                      <span>{t.short}</span>
                    </button>
                  );
                })}
                <button
                  onClick={() => setShowMoreTools(true)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card text-muted-foreground flex items-center gap-1 active:bg-muted">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                  更多
                </button>
              </div>

              {/* Drawing hint + undo/clear */}
              <div className="px-3 pb-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground truncate pr-2">
                  {selectedTool
                    ? drawingStart ? "点击画布设置终点"
                      : `已选：${COMMON_TOOLS.find(t => t.type === selectedTool)?.full ?? selectedTool}  —  点击起点`
                    : tourStep === "highlight-tool"
                      ? "点击上方高亮的电阻元件开始引导"
                      : elements.length > 0
                        ? "选择模式：点击已放置的元件可修改/删除"
                        : "从工具栏选择一个元件后点击画布绘制"}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={undo}
                    disabled={!history.length || isTourDemo}
                    className="h-7 px-2 text-xs rounded-md border border-border bg-card text-muted-foreground disabled:opacity-40 flex items-center gap-1 active:bg-muted">
                    <RotateCcw className="w-3 h-3" /> 撤销
                  </button>
                  <button onClick={() => {
                    if (!elements.length) return;
                    commitElements(() => []);
                    setDrawingStart(null);
                  }}
                    disabled={isTourDemo}
                    className="h-7 px-2 text-xs rounded-md border border-border bg-card text-muted-foreground flex items-center gap-1 active:bg-muted disabled:opacity-40">
                    <Trash2 className="w-3 h-3" /> 清空
                  </button>
                </div>
              </div>
            </div>

            {/* SVG canvas */}
            <div className="flex-1 relative bg-[#f4f7fb] overflow-hidden touch-none">

              {/* Tour tooltip overlaid at top of canvas area */}
              <TourTooltip
                step={tourStep}
                onSkip={dismissTour}
                onDismiss={dismissTour}
              />

              <svg
                ref={svgRef}
                className="w-full h-full"
                style={{
                  cursor: isTourDemo ? "default" : selectedTool ? "crosshair" : "default",
                  pointerEvents: isTourDemo ? "none" : undefined,
                }}
                onClick={onMouseClick}
                onMouseMove={onMouseMove}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
              >
                <defs>
                  <pattern id="g" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                    <path d={`M${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="rgba(30,64,175,0.05)" strokeWidth="1" />
                    <circle cx={GRID} cy={GRID} r="1.2" fill="rgba(30,64,175,0.18)" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#g)" />

                {elements.map(el => (
                  <g key={el.id} onClick={e => {
                    if (selectedTool || tourStep) return;
                    e.stopPropagation();
                    if (el.type !== "wire" && el.type !== "ground") {
                      setEditId(el.id); setEditProps(el); setPropOpen(true);
                    }
                  }}>
                    {renderEl(el)}
                  </g>
                ))}

                {drawingStart && previewEnd && selectedTool &&
                  renderEl({ id: "preview", start: drawingStart, end: previewEnd, type: selectedTool }, true)}

                {/* Tour canvas overlay */}
                <TourCanvasOverlay step={tourStep} demoPhase={demoPhase} />
              </svg>

              {/* Loading overlay */}
              {isLoading && (
                <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex flex-col items-center justify-center z-30">
                  <div className="bg-card rounded-2xl p-6 shadow-xl border border-border flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-[3px] border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-semibold">AI 正在分析...</p>
                    <p className="text-xs text-muted-foreground">计算节点电压与支路电流</p>
                  </div>
                </div>
              )}

              {/* Solve error */}
              {solveError && (
                <div className="absolute top-3 left-3 right-3 z-20 bg-destructive/10 border border-destructive/30 text-destructive rounded-xl p-3 flex items-start gap-2 text-xs shadow">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="flex-1">{solveError}</p>
                  <button onClick={() => setSolveError(null)}>✕</button>
                </div>
              )}
            </div>

            {/* Bottom action bar — live validation status + solve button */}
            <div className="shrink-0 bg-card border-t border-border">
              {/* Live validation status (auto-checks on every elements change) */}
              <div
                data-testid="circuit-status"
                className={[
                  "px-3 py-2 flex items-center gap-2 text-xs font-medium border-b",
                  circuitStatus.empty
                    ? "bg-muted/40 text-muted-foreground border-border"
                    : circuitStatus.ok
                      ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
                      : "bg-destructive/10 text-destructive border-destructive/30",
                ].join(" ")}
              >
                {circuitStatus.empty ? (
                  <ImageIcon className="w-4 h-4 shrink-0" />
                ) : circuitStatus.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span className="flex-1 truncate">{circuitStatus.message}</span>
              </div>

              <div className="px-3 py-2">
                <button
                  onClick={handleSolve}
                  disabled={isLoading || !elements.length || !!tourStep}
                  className={[
                    "w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-1.5 shadow-md disabled:opacity-50 active:opacity-90 transition-all",
                    tourStep === "success"
                      ? "bg-primary text-primary-foreground animate-pulse ring-4 ring-primary/30"
                      : "bg-primary text-primary-foreground",
                  ].join(" ")}>
                  <Play className="w-4 h-4" />
                  提交求解
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── RESULTS TAB ── */}
        {tab === "results" && (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-5 pb-28">
              {!solution && !solveError && (
                <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                  <BarChart2 className="w-10 h-10 text-muted-foreground/40" />
                  <p className="text-muted-foreground text-sm">绘制电路并点击"提交求解"后，结果将在这里显示</p>
                  <Button variant="outline" onClick={() => setTab("canvas")}>前往画布</Button>
                </div>
              )}
              {solveError && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-sm text-destructive">无法求解</p>
                    <p className="text-xs text-muted-foreground mt-1">{solveError}</p>
                  </div>
                </div>
              )}
              {solution && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">节点电压</h3>
                      <Badge variant="outline" className="text-xs font-mono">{solution.nodeVoltages.length}</Badge>
                    </div>
                    <div className="rounded-xl border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">节点</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">电压</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border bg-card">
                          {solution.nodeVoltages.map((nv, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2.5 font-mono text-xs">{nv.nodeId}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-primary font-semibold text-xs">
                                {nv.voltage.toFixed(4)}{nv.voltageImag ? ` + j${nv.voltageImag.toFixed(4)}` : ""} {nv.unit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">支路电流</h3>
                      <Badge variant="outline" className="text-xs font-mono">{solution.branchCurrents.length}</Badge>
                    </div>
                    <div className="rounded-xl border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">元件</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">电流</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border bg-card">
                          {solution.branchCurrents.map((bc, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2.5 font-mono text-xs">{bc.elementId}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-secondary font-semibold text-xs">
                                {bc.current.toFixed(4)}{bc.currentImag ? ` + j${bc.currentImag.toFixed(4)}` : ""} {bc.unit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {analyzeCircuit.isPending && (
                    <div className="rounded-xl border border-border bg-primary/5 p-4 flex items-center gap-3">
                      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
                      <p className="text-sm text-primary font-medium">AI 正在生成解析...</p>
                    </div>
                  )}
                  {analysis && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">AI 解析</h3>
                        <Badge className="text-xs">AI 生成</Badge>
                      </div>
                      {unknownInLastSolve.length > 0 && (
                        <div
                          data-testid="unknown-elements-hint"
                          className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
                        >
                          本题包含 {unknownInLastSolve.length} 个待定参数（{unknownInLastSolve.join("、")}），下方 AI 解析按符号方式给出，数值表中的数字基于占位值。
                        </div>
                      )}
                      <div className="text-sm text-muted-foreground bg-muted/30 p-4 rounded-xl border border-border leading-relaxed">
                        {analysis.summary}
                      </div>
                      <Accordion type="single" collapsible className="space-y-2">
                        {analysis.steps.map((step, idx) => (
                          <AccordionItem key={idx} value={`s-${idx}`} className="border border-border rounded-xl overflow-hidden px-4">
                            <AccordionTrigger className="text-sm hover:no-underline py-3">
                              <div className="flex items-center gap-3 text-left">
                                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">
                                  {step.stepNumber}
                                </span>
                                <span className="font-medium">{step.title}</span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="text-sm text-muted-foreground pb-4 pl-9 leading-relaxed">
                              <p>{step.explanation}</p>
                              {step.formula && (
                                <div className="mt-3 p-3 bg-card rounded-lg font-mono text-xs border border-border overflow-x-auto">
                                  {step.formula}
                                </div>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                      {analysis.keyInsights.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">关键结论</p>
                          <ul className="space-y-1.5">
                            {analysis.keyInsights.map((ins, i) => (
                              <li key={i} className="text-sm flex items-start gap-2">
                                <span className="text-primary mt-0.5">•</span>{ins}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <Button className="w-full h-12 mt-2" onClick={() => setTab("chat")}>
                        <MessageSquare className="w-4 h-4 mr-2" />
                        向 AI 助教提问
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        )}

        {/* ── CHAT TAB ── */}
        {tab === "chat" && (
          <div className="h-full flex flex-col">
            <ScrollArea className="flex-1 px-4 pt-4 pb-2">
              <div className="space-y-3 pb-2">
                <div className="flex justify-start">
                  <div className="max-w-[85%] bg-card border border-border rounded-2xl rounded-tl-sm p-3 text-sm text-foreground shadow-sm leading-relaxed">
                    您好！我是 AI 助教。有关这道电路题的任何疑问，请随时问我。
                  </div>
                </div>
                {!solution && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] bg-muted/50 border border-border rounded-2xl rounded-tl-sm p-3 text-xs text-muted-foreground">
                      提示：先在"画布"标签绘制电路并求解，我将能结合具体结果回答您的问题。
                    </div>
                  </div>
                )}
                {chatMsgs.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl p-3 text-sm shadow-sm leading-relaxed whitespace-pre-wrap
                      ${m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-card border border-border text-foreground rounded-tl-sm"}`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatWithAI.isPending && (
                  <div className="flex justify-start">
                    <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center shadow-sm">
                      <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" />
                      <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce [animation-delay:0.15s]" />
                      <span className="w-2 h-2 rounded-full bg-primary/90 animate-bounce [animation-delay:0.3s]" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            </ScrollArea>
            <div className="shrink-0 p-3 bg-card border-t border-border">
              <form onSubmit={e => { e.preventDefault(); handleSendChat(); }}
                className="flex items-center gap-2 bg-muted/40 border border-border rounded-full pl-4 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary transition-all">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                  placeholder="输入问题..." className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                  disabled={chatWithAI.isPending} />
                <button type="submit" disabled={!chatInput.trim() || chatWithAI.isPending}
                  className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-sm disabled:opacity-40 active:opacity-80">
                  <Send className="w-4 h-4 ml-0.5" />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* ── BOTTOM TAB BAR ── */}
      <nav className="shrink-0 bg-card border-t border-border grid grid-cols-4 z-30">
        {([
          { id: "upload",  icon: <ImageIcon className="w-5 h-5" />,     label: "题目" },
          { id: "canvas",  icon: <Settings2 className="w-5 h-5" />,     label: "画布" },
          { id: "results", icon: <BarChart2 className="w-5 h-5" />,     label: "结果" },
          { id: "chat",    icon: <MessageSquare className="w-5 h-5" />, label: "问答" },
        ] as { id: Tab; icon: React.ReactNode; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex flex-col items-center justify-center gap-1 py-2.5 transition-colors relative
              ${tab === t.id ? "text-primary" : "text-muted-foreground active:text-foreground"}`}>
            {t.id === "results" && solution && tab !== "results" && (
              <span className="absolute top-1.5 right-6 w-2 h-2 rounded-full bg-green-500 ring-1 ring-background" />
            )}
            {t.icon}
            <span className="text-[10px] font-medium">{t.label}</span>
            {tab === t.id && <span className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-primary rounded-full" />}
          </button>
        ))}
      </nav>

      {/* ── MORE TOOLS SHEET ── */}
      {showMoreTools && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMoreTools(false)} />
          <div className="relative bg-card rounded-t-2xl border-t border-border p-4 pb-8 space-y-3 animate-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm">受控源</h3>
              <button onClick={() => setShowMoreTools(false)} className="text-muted-foreground text-xl leading-none">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MORE_TOOLS.map(t => (
                <button key={t.type}
                  onClick={() => { setSelectedTool(t.type); setShowMoreTools(false); setTab("canvas"); }}
                  className={`h-14 px-3 rounded-xl border text-sm font-medium transition-colors flex items-center gap-2
                    ${selectedTool === t.type
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-foreground bg-card active:bg-muted"}`}>
                  <ToolIcon type={t.type} className="w-7 h-4 shrink-0" />
                  <span className="text-left leading-tight">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── PROP DIALOG ── */}
      <Dialog open={propOpen} onOpenChange={setPropOpen}>
        <DialogContent className="mx-4 rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">设置元件属性</DialogTitle>
            <DialogDescription className="text-xs">设置参数后用于电路计算</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">标签</Label>
              <Input value={editProps.label ?? ""} className="h-11 font-mono"
                onChange={e => setEditProps({ ...editProps, label: e.target.value })} />
            </div>
            {editProps.type !== "wire" && editProps.type !== "ground" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">数值</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="any"
                    className="flex-1 h-11 font-mono"
                    placeholder={editProps.unknown ? "待定" : ""}
                    disabled={!!editProps.unknown}
                    value={editProps.unknown ? "" : (editProps.value ?? "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditProps({ ...editProps, value: v === "" ? undefined : Number(v) });
                    }}
                    data-testid="input-element-value"
                  />
                  <Input className="w-14 h-11 text-center font-mono bg-muted"
                    value={editProps.unit ?? ""}
                    onChange={e => setEditProps({ ...editProps, unit: e.target.value })} />
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                  <div className="flex flex-col">
                    <Label htmlFor="prop-unknown-toggle" className="text-xs font-semibold">
                      待定（题目未给出，由 AI 求解）
                    </Label>
                    <span className="text-[10px] text-muted-foreground">
                      勾选后将以符号方式参与求解，AI 会按未知量推导
                    </span>
                  </div>
                  <Switch
                    id="prop-unknown-toggle"
                    checked={!!editProps.unknown}
                    onCheckedChange={(checked) => {
                      setEditProps((prev) => ({
                        ...prev,
                        unknown: checked,
                        ...(checked ? { value: undefined } : {}),
                      }));
                    }}
                    data-testid="switch-element-unknown"
                  />
                </div>
              </div>
            )}
            {["vcvs","vccs","ccvs","cccs"].includes(editProps.type ?? "") && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">控制支路 ID</Label>
                  <Input className="h-11 font-mono" placeholder="如: R1" value={editProps.controlBranchId ?? ""}
                    onChange={e => setEditProps({ ...editProps, controlBranchId: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">增益</Label>
                  <Input
                    type="number"
                    step="any"
                    className="h-11 font-mono"
                    value={editProps.gain ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditProps({ ...editProps, gain: v === "" ? undefined : Number(v) });
                    }}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter className="gap-2 flex-row items-center justify-between sm:justify-between">
            {(() => {
              const isTourLocked =
                (tourStep === "canvas-demo" || tourStep === "success") && editId === "demo-r1";
              const deleteBtn = (
                <Button
                  variant="destructive"
                  className="h-11 px-3"
                  disabled={isTourLocked}
                  onClick={() => setDeleteConfirmOpen(true)}
                  data-testid="button-delete-element"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  删除元件
                </Button>
              );
              return isTourLocked ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>{deleteBtn}</span>
                    </TooltipTrigger>
                    <TooltipContent>教学引导中不可删除</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : deleteBtn;
            })()}
            <div className="flex gap-2">
              <Button variant="outline" className="h-11" onClick={() => setPropOpen(false)}>取消</Button>
              <Button className="h-11" onClick={() => {
                const current = elements.find(e => e.id === editId);
                // Element no longer exists (e.g. concurrent delete) — skip
                // committing so we don't push an empty change to undo history.
                if (!current) { setPropOpen(false); return; }
                const merged = { ...current, ...editProps } as CanvasEl;
                const changed =
                  current.label !== merged.label ||
                  current.value !== merged.value ||
                  current.unit !== merged.unit ||
                  current.controlBranchId !== merged.controlBranchId ||
                  current.gain !== merged.gain ||
                  !!current.unknown !== !!merged.unknown;
                if (changed) {
                  commitElements(prev => prev.map(e => e.id === editId ? merged : e));
                }
                setPropOpen(false);
              }}>保存</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DELETE CONFIRM DIALOG ── */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent className="mx-4 rounded-2xl max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              确认删除{TYPE_LABEL[editProps.type ?? ""] ?? "元件"} {editProps.label ?? ""} 吗？
            </AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销。将从画布上移除该{TYPE_LABEL[editProps.type ?? ""] ?? "元件"}
              （已连接的导线和节点会保留）。如果误删可使用顶部"撤销"按钮恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 flex-row justify-end">
            <AlertDialogCancel className="h-11 mt-0">取消</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const removed = elements.find(e => e.id === editId);
                const removedLabel = editProps.label ?? "元件";
                if (!removed) return;
                commitElements(prev => prev.filter(e => e.id !== editId));
                setDeleteConfirmOpen(false);
                setPropOpen(false);
                setEditId(null);
                setEditProps({});
                toast({
                  title: `已删除元件 ${removedLabel}`,
                  description: "如果是误删，可以点击右侧撤销恢复。",
                  duration: 6000,
                  action: (
                    <ToastAction
                      altText="撤销删除"
                      data-testid="button-toast-undo-delete"
                      onClick={() => {
                        commitElements(prev =>
                          prev.some(e => e.id === removed.id) ? prev : [...prev, removed],
                        );
                      }}
                    >
                      撤销
                    </ToastAction>
                  ),
                });
              }}
              data-testid="button-confirm-delete-element"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── NON-CIRCUIT CONFIRM ── */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="mx-4 rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-base">
              <AlertCircle className="w-5 h-5" />
              未检测到电路
            </DialogTitle>
            <DialogDescription className="text-sm pt-1">
              上传的图片可能与电路无关，提取的信息可能不准确。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 flex-row justify-end mt-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => {
              setImagePreview(null); setProblemExtracted(null); setShowConfirmDialog(false);
            }}>重新上传</Button>
            <Button className="flex-1 h-11" onClick={() => setShowConfirmDialog(false)}>继续使用</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
