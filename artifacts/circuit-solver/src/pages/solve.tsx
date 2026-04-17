import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Play, RotateCcw, Trash2, CheckCircle, Upload, Send, MessageSquare,
  ChevronDown, AlertCircle, ImageIcon, Zap, FileText, BarChart2, ArrowLeft,
  MoreHorizontal, Settings2
} from "lucide-react";
import { useSolveCircuit, useValidateCircuit, useAnalyzeCircuit, useExtractProblem, useChatWithAI } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

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

// ─── SVG Element Rendering ────────────────────────────────────────────────────
function renderEl(el: CanvasEl | { id: string; start: Pt; end: Pt; type: string }, preview = false) {
  const { start, end, type } = el;
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
  const c = "#1e40af", w = 2.5;
  const T = `translate(${mx},${my}) rotate(${angle})`;
  const h = len / 2;

  let body = null;
  if (type === "wire") {
    body = <line x1={-h} y1={0} x2={h} y2={0} stroke={c} strokeWidth={w} />;
  } else if (type === "resistor") {
    const zw = Math.min(28, len * 0.5);
    body = <path d={`M${-h} 0 L${-zw/2} 0 L${-zw/2+5} -8 L${-zw/2+13} 8 L${-zw/2+21} -8 L${zw/2} 0 L${h} 0`}
      fill="none" stroke={c} strokeWidth={w} strokeLinejoin="round" />;
  } else if (type === "capacitor") {
    const g = 7, ph = 14;
    body = <g>
      <line x1={-h} y1={0} x2={-g/2} y2={0} stroke={c} strokeWidth={w} />
      <line x1={g/2} y1={0} x2={h} y2={0} stroke={c} strokeWidth={w} />
      <line x1={-g/2} y1={-ph} x2={-g/2} y2={ph} stroke={c} strokeWidth={w+1} />
      <line x1={g/2} y1={-ph} x2={g/2} y2={ph} stroke={c} strokeWidth={w+1} />
    </g>;
  } else if (type === "inductor") {
    const iw = Math.min(32, len * 0.5);
    body = <g>
      <line x1={-h} y1={0} x2={-iw/2} y2={0} stroke={c} strokeWidth={w} />
      <path d={`M${-iw/2} 0 Q${-iw/2+6} -14 ${-iw/2+12} 0 T${-iw/2+24} 0 T${iw/2} 0`} fill="none" stroke={c} strokeWidth={w} />
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
    // Controlled sources — diamond
    const s = 14;
    body = <g>
      <line x1={-h} y1={0} x2={-s} y2={0} stroke={c} strokeWidth={w} />
      <line x1={s} y1={0} x2={h} y2={0} stroke={c} strokeWidth={w} />
      <polygon points={`0,${-s} ${s},0 0,${s} ${-s},0`} fill="white" stroke={c} strokeWidth={w} />
      <text x={0} y={4} fontSize="8" textAnchor="middle" fill={c}>{String(type).toUpperCase()}</text>
    </g>;
  }

  const label = (el as CanvasEl).label;
  const val = (el as CanvasEl).value;
  const unit = (el as CanvasEl).unit ?? "";

  return (
    <g key={el.id} opacity={preview ? 0.45 : 1}>
      <g transform={T}>{body}</g>
      {!preview && <circle cx={start.x} cy={start.y} r={3} fill={c} />}
      {!preview && type !== "ground" && <circle cx={end.x} cy={end.y} r={3} fill={c} />}
      {!preview && label && (
        <text x={mx} y={my - 14} textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="bold">
          {label}{val !== undefined ? ` ${val}${unit}` : ""}
        </text>
      )}
    </g>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
type Tab = "upload" | "canvas" | "results" | "chat";

export default function Solve() {
  const { toast } = useToast();

  // ── Tab state
  const [tab, setTab] = useState<Tab>("canvas");

  // ── Upload state
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [problemExtracted, setProblemExtracted] = useState<{
    isCircuitRelated: boolean; confidence: number;
    problemText?: string; targetVariables?: string[]; constraints?: string[];
  } | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // ── Canvas state
  const [elements, setElements] = useState<CanvasEl[]>([]);
  const [selectedTool, setSelectedTool] = useState<ElementType | null>(null);
  const [drawingStart, setDrawingStart] = useState<Pt | null>(null);
  const [previewEnd, setPreviewEnd] = useState<Pt | null>(null);
  const [showMoreTools, setShowMoreTools] = useState(false);

  // ── Prop dialog
  const [propOpen, setPropOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editProps, setEditProps] = useState<Partial<CanvasEl>>({});

  // ── Analysis settings
  const [analysisType, setAnalysisType] = useState<"dc" | "ac">("dc");
  const [acFreq, setAcFreq] = useState(50);

  // ── Solution state
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

  // ── Chat state
  const [chatMsgs, setChatMsgs] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── SVG refs for coordinate conversion
  const svgRef = useRef<SVGSVGElement>(null);

  // ── API hooks
  const extractProblem = useExtractProblem();
  const validateCircuit = useValidateCircuit();
  const solveCircuit = useSolveCircuit();
  const analyzeCircuit = useAnalyzeCircuit();
  const chatWithAI = useChatWithAI();

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

  const buildCircuitInput = () => ({
    nodes: Array.from(new Set(elements.flatMap((e) => [
      `${e.start.x},${e.start.y}`,
      e.type === "ground" ? "0" : `${e.end.x},${e.end.y}`,
    ]))).map((id) => ({ id })),
    elements: elements.map((e) => ({
      id: e.id,
      type: e.type,
      nodeFrom: `${e.start.x},${e.start.y}`,
      nodeTo: e.type === "ground" ? "0" : `${e.end.x},${e.end.y}`,
      value: e.value,
      unit: e.unit,
      label: e.label,
      controlBranchId: e.controlBranchId,
      gain: e.gain,
    })),
    analysisType,
    frequency: acFreq,
  });

  // ── Canvas interaction (unified mouse + touch)
  const handlePoint = (clientX: number, clientY: number) => {
    if (!selectedTool) return;
    const pt = svgPt(clientX, clientY);

    if (selectedTool === "ground") {
      setElements((prev) => [...prev, {
        id: Math.random().toString(36).slice(2), type: "ground",
        start: pt, end: { x: pt.x, y: pt.y + GRID }, label: "GND",
      }]);
      return;
    }

    if (!drawingStart) {
      setDrawingStart(pt);
      setPreviewEnd(pt);
    } else {
      if (drawingStart.x === pt.x && drawingStart.y === pt.y) {
        setDrawingStart(null); setPreviewEnd(null); return;
      }
      const newEl: CanvasEl = {
        id: Math.random().toString(36).slice(2),
        type: selectedTool, start: drawingStart, end: pt,
        value: selectedTool === "resistor" ? 1 : 1,
        unit: DEFAULT_UNIT[selectedTool] ?? "",
        label: `${selectedTool[0].toUpperCase()}${elements.length + 1}`,
      };
      setElements((prev) => [...prev, newEl]);
      setDrawingStart(null); setPreviewEnd(null);
      if (selectedTool !== "wire") {
        setEditId(newEl.id);
        setEditProps(newEl);
        setPropOpen(true);
      }
    }
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (drawingStart) setPreviewEnd(svgPt(clientX, clientY));
  };

  // Mouse events
  const onMouseClick = (e: React.MouseEvent<SVGSVGElement>) => handlePoint(e.clientX, e.clientY);
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => handleMove(e.clientX, e.clientY);

  // Touch events
  const onTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    e.preventDefault();
    const t = e.touches[0];
    handlePoint(t.clientX, t.clientY);
  };
  const onTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    e.preventDefault();
    const t = e.touches[0];
    handleMove(t.clientX, t.clientY);
  };

  // ── Actions
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64full = ev.target?.result as string;
      setImagePreview(base64full);
      try {
        const result = await extractProblem.mutateAsync({
          data: { imageBase64: base64full.split(",")[1], mimeType: file.type },
        });
        setProblemExtracted(result);
        if (!result.isCircuitRelated) setShowConfirmDialog(true);
      } catch {
        toast({ title: "提取失败", description: "无法从图片中提取题目信息。", variant: "destructive" });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleValidate = async () => {
    if (!elements.length) { toast({ title: "提示", description: "请先绘制电路", variant: "destructive" }); return; }
    try {
      const res = await validateCircuit.mutateAsync({ data: buildCircuitInput() });
      if (res.valid) toast({ title: "验证成功", description: "电路拓扑结构有效" });
      else toast({ title: "验证失败", description: res.issues.map((i) => i.message).join("；"), variant: "destructive" });
    } catch { toast({ title: "错误", description: "验证失败", variant: "destructive" }); }
  };

  const handleSolve = async () => {
    if (!elements.length) { toast({ title: "提示", description: "请先绘制电路", variant: "destructive" }); return; }
    setSolveError(null);
    try {
      const input = buildCircuitInput();
      const sol = await solveCircuit.mutateAsync({ data: input });
      setSolution(sol);
      toast({ title: "求解完成", description: "正在生成 AI 解析..." });
      setTab("results");
      const ana = await analyzeCircuit.mutateAsync({
        data: { circuit: input, solution: sol, problemText: problemExtracted?.problemText },
      });
      setAnalysis(ana);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? "无法求解此电路，请检查拓扑（接地、元件连接）。";
      setSolveError(msg);
      toast({ title: "求解失败", description: msg, variant: "destructive" });
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    const newMsgs = [...chatMsgs, { role: "user", content: chatInput }];
    setChatMsgs(newMsgs);
    setChatInput("");
    try {
      const res = await chatWithAI.mutateAsync({
        data: {
          messages: newMsgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          solution: solution ?? undefined,
          analysis: analysis ?? undefined,
        },
      });
      setChatMsgs([...newMsgs, { role: "assistant", content: res.content }]);
    } catch { toast({ title: "错误", description: "发送失败", variant: "destructive" }); }
  };

  const isLoading = solveCircuit.isPending || analyzeCircuit.isPending;

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

      {/* Top header */}
      <header className="shrink-0 flex items-center justify-between px-4 h-12 border-b border-border bg-card z-20">
        <Link href="/" className="flex items-center gap-1.5 text-primary font-bold">
          <Zap className="w-4 h-4" />
          <span className="text-sm">电路求解器</span>
        </Link>

        {/* Analysis type — compact */}
        <div className="flex items-center gap-2">
          <Select value={analysisType} onValueChange={(v) => setAnalysisType(v as "dc" | "ac")}>
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
              <Input type="number" value={acFreq} onChange={(e) => setAcFreq(Number(e.target.value))}
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
                  {!!problemExtracted.constraints?.length && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">已知条件</p>
                      <ul className="text-sm text-muted-foreground space-y-1 pl-4 list-disc">
                        {problemExtracted.constraints.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </div>
                  )}

                  <Button className="w-full h-12" onClick={() => setTab("canvas")}>
                    开始绘制电路
                    <ArrowLeft className="w-4 h-4 ml-2 rotate-180" />
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* ── CANVAS TAB ── */}
        {tab === "canvas" && (
          <div className="h-full flex flex-col">
            {/* Element toolbar — horizontally scrollable */}
            <div className="shrink-0 bg-card border-b border-border">
              <div className="flex items-center gap-1.5 px-2 py-2 overflow-x-auto no-scrollbar">
                {COMMON_TOOLS.map((t) => (
                  <button
                    key={t.type}
                    onClick={() => { setSelectedTool(t.type); setDrawingStart(null); }}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                      ${selectedTool === t.type
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-card text-foreground border-border active:bg-muted"}`}
                  >
                    {t.short}
                  </button>
                ))}
                <button
                  onClick={() => setShowMoreTools(true)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card text-muted-foreground flex items-center gap-1 active:bg-muted"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                  更多
                </button>
              </div>

              {/* Drawing hint */}
              <div className="px-3 pb-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {selectedTool
                    ? drawingStart
                      ? "点击画布设置终点"
                      : `已选：${COMMON_TOOLS.find(t => t.type === selectedTool)?.full ?? selectedTool}  —  点击起点`
                    : "选择元件后点击画布绘制"}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setElements(prev => prev.slice(0, -1))}
                    disabled={!elements.length}
                    className="h-7 px-2 text-xs rounded-md border border-border bg-card text-muted-foreground disabled:opacity-40 flex items-center gap-1 active:bg-muted">
                    <RotateCcw className="w-3 h-3" /> 撤销
                  </button>
                  <button onClick={() => { setElements([]); setDrawingStart(null); }}
                    className="h-7 px-2 text-xs rounded-md border border-border bg-card text-muted-foreground flex items-center gap-1 active:bg-muted">
                    <Trash2 className="w-3 h-3" /> 清空
                  </button>
                </div>
              </div>
            </div>

            {/* SVG Canvas */}
            <div className="flex-1 relative bg-[#f4f7fb] overflow-hidden touch-none">
              <svg
                ref={svgRef}
                className="w-full h-full"
                style={{ cursor: selectedTool ? "crosshair" : "default" }}
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

                {elements.map((el) => (
                  <g key={el.id} onClick={(e) => {
                    if (selectedTool) return; // don't open dialog while placing
                    e.stopPropagation();
                    if (el.type !== "wire" && el.type !== "ground") {
                      setEditId(el.id); setEditProps(el); setPropOpen(true);
                    }
                  }}>
                    {renderEl(el)}
                  </g>
                ))}

                {drawingStart && previewEnd && selectedTool && renderEl(
                  { id: "preview", start: drawingStart, end: previewEnd, type: selectedTool }, true
                )}
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
                  <button onClick={() => setSolveError(null)} className="shrink-0">✕</button>
                </div>
              )}
            </div>

            {/* Canvas bottom action bar */}
            <div className="shrink-0 bg-card border-t border-border px-3 py-2 flex gap-2">
              <button
                onClick={handleValidate}
                disabled={validateCircuit.isPending || !elements.length}
                className="flex-1 h-11 rounded-xl border border-primary/40 text-primary font-medium text-sm flex items-center justify-center gap-1.5 disabled:opacity-40 active:bg-primary/5">
                <CheckCircle className="w-4 h-4" />
                验证
              </button>
              <button
                onClick={handleSolve}
                disabled={isLoading || !elements.length}
                className="flex-[2] h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-1.5 shadow-md disabled:opacity-50 active:opacity-90">
                <Play className="w-4 h-4" />
                提交求解
              </button>
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
                  {/* Node voltages */}
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

                  {/* Branch currents */}
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

                  {/* AI analysis */}
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
                                <div className="mt-3 p-3 bg-card rounded-lg font-mono text-xs text-foreground border border-border overflow-x-auto">
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
                              <li key={i} className="text-sm text-foreground flex items-start gap-2">
                                <span className="text-primary mt-0.5">•</span>
                                {ins}
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
                {/* Welcome */}
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

            {/* Chat input */}
            <div className="shrink-0 p-3 bg-card border-t border-border">
              <form onSubmit={(e) => { e.preventDefault(); handleSendChat(); }}
                className="flex items-center gap-2 bg-muted/40 border border-border rounded-full pl-4 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary transition-all">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="输入问题..."
                  className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                  disabled={chatWithAI.isPending}
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || chatWithAI.isPending}
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
        ] as { id: Tab; icon: React.ReactNode; label: string }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-col items-center justify-center gap-1 py-2.5 transition-colors relative
              ${tab === t.id ? "text-primary" : "text-muted-foreground active:text-foreground"}`}
          >
            {t.id === "results" && solution && tab !== "results" && (
              <span className="absolute top-1.5 right-6 w-2 h-2 rounded-full bg-green-500 ring-1 ring-background" />
            )}
            {t.icon}
            <span className="text-[10px] font-medium">{t.label}</span>
            {tab === t.id && (
              <span className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-primary rounded-full" />
            )}
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
              {MORE_TOOLS.map((t) => (
                <button
                  key={t.type}
                  onClick={() => { setSelectedTool(t.type); setShowMoreTools(false); setTab("canvas"); }}
                  className={`h-12 rounded-xl border text-sm font-medium transition-colors
                    ${selectedTool === t.type
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-foreground bg-card active:bg-muted"}`}
                >
                  {t.label}
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
                onChange={(e) => setEditProps({ ...editProps, label: e.target.value })} />
            </div>
            {editProps.type !== "wire" && editProps.type !== "ground" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">数值</Label>
                <div className="flex gap-2">
                  <Input type="number" step="any" className="flex-1 h-11 font-mono"
                    value={editProps.value ?? ""} onChange={(e) => setEditProps({ ...editProps, value: Number(e.target.value) })} />
                  <Input className="w-14 h-11 text-center font-mono bg-muted"
                    value={editProps.unit ?? ""} onChange={(e) => setEditProps({ ...editProps, unit: e.target.value })} />
                </div>
              </div>
            )}
            {["vcvs", "vccs", "ccvs", "cccs"].includes(editProps.type ?? "") && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">控制支路 ID</Label>
                  <Input className="h-11 font-mono" placeholder="如: R1" value={editProps.controlBranchId ?? ""}
                    onChange={(e) => setEditProps({ ...editProps, controlBranchId: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">增益</Label>
                  <Input type="number" step="any" className="h-11 font-mono" value={editProps.gain ?? ""}
                    onChange={(e) => setEditProps({ ...editProps, gain: Number(e.target.value) })} />
                </div>
              </>
            )}
          </div>
          <DialogFooter className="gap-2 flex-row justify-end">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setPropOpen(false)}>取消</Button>
            <Button className="flex-1 h-11" onClick={() => {
              setElements((prev) => prev.map((e) => e.id === editId ? { ...e, ...editProps } as CanvasEl : e));
              setPropOpen(false);
            }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
