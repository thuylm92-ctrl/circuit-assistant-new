import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, XCircle, Zap, Clock } from "lucide-react";

function useVisitCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const stored = parseInt(localStorage.getItem("visit_count") ?? "0", 10);
    const next = stored + 1;
    localStorage.setItem("visit_count", String(next));
    localStorage.setItem("last_visit", new Date().toISOString());
    setCount(next);
  }, []);

  return count;
}

export default function Home() {
  const visitCount = useVisitCount();
  const isReturning = visitCount !== null && visitCount > 1;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 border-b border-border bg-card sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-lg">
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </div>
            电路解题助手
          </div>
          {visitCount !== null && visitCount > 1 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 rounded-full px-2.5 py-1 border border-border">
              <Clock className="w-3 h-3" />
              第 {visitCount} 次访问
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 py-6 flex flex-col gap-5 max-w-2xl mx-auto w-full">

        {/* Welcome message — changes based on visit */}
        <div className="space-y-1.5">
          {isReturning ? (
            <>
              <p className="text-xs text-primary font-medium">欢迎回来</p>
              <h1 className="text-2xl font-extrabold tracking-tight">
                继续解题吧
              </h1>
              <p className="text-sm text-muted-foreground">
                这是你第 {visitCount} 次使用电路解题助手。
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-extrabold tracking-tight">
                精确的电路分析，<span className="text-primary">专为大学生打造</span>
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                上传题目图片，绘制电路，获得精确数值与 AI 逐步解析。
              </p>
            </>
          )}
        </div>

        {/* Capabilities — always shown, but collapsible on return visits */}
        {!isReturning && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-sm font-semibold">支持</span>
                </div>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  <li>线性电路</li>
                  <li>直流 / 交流稳态</li>
                  <li>集总参数电路</li>
                  <li>运放 Op-Amp</li>
                  <li>四种受控源</li>
                </ul>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-destructive shrink-0" />
                  <span className="text-sm font-semibold">不支持</span>
                </div>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  <li>非线性元件</li>
                  <li>二极管 / 晶体管</li>
                  <li>暂态分析</li>
                  <li>分布参数电路</li>
                  <li>数字 / 逻辑电路</li>
                </ul>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="font-semibold text-sm">使用步骤</h3>
              <div className="space-y-3">
                {[
                  { n: "01", t: "上传题目图片", d: "AI 自动提取题目文字和求解目标" },
                  { n: "02", t: "绘制电路图",   d: "选择元件，点击起点和终点完成连接" },
                  { n: "03", t: "提交求解",     d: "MNA 矩阵精确计算节点电压与支路电流" },
                  { n: "04", t: "查看结果提问", d: "AI 生成解题过程，支持追问互动" },
                ].map((s) => (
                  <div key={s.n} className="flex gap-3 items-start">
                    <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                      {s.n}
                    </span>
                    <div>
                      <div className="text-sm font-medium">{s.t}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{s.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Returning user: compact reminder */}
        {isReturning && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" />线性直流 / 交流</div>
              <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" />运放与受控源</div>
              <div className="flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5 text-destructive" />非线性元件</div>
              <div className="flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5 text-destructive" />暂态 / 数字电路</div>
            </div>
          </div>
        )}

        {/* CTA */}
        <Link href="/solve">
          <button className="w-full h-14 rounded-xl bg-primary text-primary-foreground font-semibold text-base flex items-center justify-center gap-2 shadow-lg active:opacity-90 transition-opacity">
            {isReturning ? "继续解题" : "开始解题"}
            <ArrowRight className="w-5 h-5" />
          </button>
        </Link>

        {/* Demo card */}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
            <span className="ml-2 text-xs text-muted-foreground font-mono">求解示例</span>
          </div>
          <div className="p-4 bg-[#f4f7fb] dark:bg-muted/20 relative">
            <div className="absolute inset-0" style={{
              backgroundImage: "radial-gradient(circle, rgba(30,64,175,0.15) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }} />
            <svg className="w-full relative z-10" viewBox="0 0 300 110" style={{ height: 120 }}>
              <line x1="20" y1="40" x2="80" y2="40" stroke="#1e40af" strokeWidth="2" />
              <line x1="20" y1="40" x2="20" y2="80" stroke="#1e40af" strokeWidth="2" />
              <line x1="220" y1="40" x2="280" y2="40" stroke="#1e40af" strokeWidth="2" />
              <line x1="280" y1="40" x2="280" y2="80" stroke="#1e40af" strokeWidth="2" />
              <line x1="20" y1="80" x2="280" y2="80" stroke="#1e40af" strokeWidth="2" />
              <line x1="80" y1="40" x2="95" y2="40" stroke="#1e40af" strokeWidth="2" />
              <path d="M95 40 L100 30 L110 50 L120 30 L130 50 L135 40" fill="none" stroke="#1e40af" strokeWidth="2" strokeLinejoin="round"/>
              <line x1="135" y1="40" x2="150" y2="40" stroke="#1e40af" strokeWidth="2" />
              <text x="107" y="22" fontSize="10" textAnchor="middle" fill="#1e40af" fontWeight="bold">R1 10Ω</text>
              <line x1="150" y1="40" x2="165" y2="40" stroke="#1e40af" strokeWidth="2" />
              <path d="M165 40 L170 30 L180 50 L190 30 L200 50 L205 40" fill="none" stroke="#1e40af" strokeWidth="2" strokeLinejoin="round"/>
              <line x1="205" y1="40" x2="220" y2="40" stroke="#1e40af" strokeWidth="2" />
              <text x="185" y="22" fontSize="10" textAnchor="middle" fill="#1e40af" fontWeight="bold">R2 5Ω</text>
              <circle cx="20" cy="60" r="10" fill="white" stroke="#1e40af" strokeWidth="2" />
              <text x="20" y="57" fontSize="8" textAnchor="middle" fill="#1e40af">+</text>
              <text x="20" y="67" fontSize="9" textAnchor="middle" fill="#1e40af">−</text>
              <text x="36" y="63" fontSize="10" fill="#1e40af" fontWeight="bold">12V</text>
              <circle cx="150" cy="40" r="3" fill="#1e40af" />
              <circle cx="150" cy="80" r="3" fill="#1e40af" />
              <line x1="150" y1="80" x2="150" y2="90" stroke="#1e40af" strokeWidth="2" />
              <line x1="140" y1="90" x2="160" y2="90" stroke="#1e40af" strokeWidth="2" />
              <line x1="144" y1="94" x2="156" y2="94" stroke="#1e40af" strokeWidth="2" />
              <line x1="148" y1="98" x2="152" y2="98" stroke="#1e40af" strokeWidth="2" />
            </svg>
          </div>
          <div className="p-3 border-t border-border bg-card flex gap-3">
            <div className="flex-1 text-xs font-mono bg-primary/5 border border-primary/15 rounded-lg p-2.5">
              <div className="text-muted-foreground mb-1">节点电压</div>
              <div className="text-primary font-semibold">N1: 12.000 V</div>
              <div className="text-primary font-semibold">N2: 4.000 V</div>
            </div>
            <div className="flex-1 text-xs font-mono bg-secondary/5 border border-secondary/15 rounded-lg p-2.5">
              <div className="text-muted-foreground mb-1">支路电流</div>
              <div className="text-secondary font-semibold">R1: 0.800 A</div>
              <div className="text-secondary font-semibold">R2: 0.800 A</div>
            </div>
          </div>
        </div>

        <div className="text-center text-xs text-muted-foreground pb-4">
          由 Replit AI Integrations 提供 AI 能力
        </div>
      </main>
    </div>
  );
}
