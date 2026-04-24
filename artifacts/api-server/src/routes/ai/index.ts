import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  solveCircuit as runMnaSolver,
  type CircuitElement as MnaCircuitElement,
  type CircuitInput as MnaCircuitInput,
  type CircuitSolution as MnaCircuitSolution,
} from "../../lib/mna-solver";

const router: IRouter = Router();

router.post("/ai/extract-problem", async (req, res): Promise<void> => {
  const { imageBase64, mimeType } = req.body as { imageBase64?: string; mimeType?: string };

  if (!imageBase64 || !mimeType) {
    res.status(400).json({ error: "imageBase64 and mimeType are required" });
    return;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 2048,
      messages: [
        {
          role: "system",
          content: `你是一个大学电路课程助教，专门分析电路题目图片。
请从用户上传的图片中提取题目信息。
返回一个JSON对象，格式如下：
{
  "isCircuitRelated": boolean,
  "confidence": number (0-1),
  "problemText": string,
  "targetVariables": string[],
  "constraints": string[]
}

如果图片与电路题目完全无关，isCircuitRelated为false，confidence设为低值。
如果图片是电路题目，提取：
- problemText: 题目的完整描述
- targetVariables: 需要求解的量（例如 ["节点A的电压", "通过R1的电流"]）
- constraints: 已知条件和约束（例如 ["R1 = 10Ω", "Vs = 5V", "直流稳态分析"]）

只返回JSON，不要有其他文字。`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
            {
              type: "text",
              text: "请分析这张图片并提取电路题目信息。",
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    let parsed: {
      isCircuitRelated: boolean;
      confidence: number;
      problemText?: string;
      targetVariables?: string[];
      constraints?: string[];
    };

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { isCircuitRelated: false, confidence: 0 };
    } catch {
      parsed = { isCircuitRelated: false, confidence: 0 };
    }

    res.json({
      isCircuitRelated: parsed.isCircuitRelated ?? false,
      confidence: parsed.confidence ?? 0,
      problemText: parsed.problemText ?? "",
      targetVariables: parsed.targetVariables ?? [],
      constraints: parsed.constraints ?? [],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to extract problem from image");
    res.status(500).json({ error: "AI服务暂时不可用，请稍后再试。" });
  }
});

interface AnalyzeNodeVoltage { nodeId: string; voltage: number; voltageImag?: number; unit: string }
interface AnalyzeBranchCurrent { elementId: string; current: number; currentImag?: number; unit: string }
interface AnalyzeStep { stepNumber: number; title: string; explanation: string; formula?: string }

interface AnalyzeAIOutput {
  steps?: AnalyzeStep[];
  summary?: string;
  keyInsights?: string[];
  computedAnswers?: {
    nodeVoltages?: Array<{ nodeId: string; voltage: number; voltageImag?: number }>;
    branchCurrents?: Array<{ elementId: string; current: number; currentImag?: number }>;
  };
}

const VERIFY_TOL_REL = 0.01; // 1% relative tolerance
const VERIFY_TOL_ABS = 1e-3; // absolute floor for near-zero values
const MAX_ATTEMPTS = 3;

function compareScalar(aiVal: number, mnaVal: number): boolean {
  const diff = Math.abs(aiVal - mnaVal);
  if (diff <= VERIFY_TOL_ABS) return true;
  const denom = Math.max(Math.abs(mnaVal), VERIFY_TOL_ABS);
  return diff / denom <= VERIFY_TOL_REL;
}

function compareComplex(
  aiRe: number, aiIm: number,
  mnaRe: number, mnaIm: number,
): boolean {
  const diff = Math.hypot(aiRe - mnaRe, aiIm - mnaIm);
  if (diff <= VERIFY_TOL_ABS) return true;
  const mag = Math.max(Math.hypot(mnaRe, mnaIm), VERIFY_TOL_ABS);
  return diff / mag <= VERIFY_TOL_REL;
}

function safeNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function fmt(n: number | null): string {
  return n === null ? "(无效值)" : n.toFixed(4);
}

function verifyAIAgainstMNA(
  aiAnswers: AnalyzeAIOutput["computedAnswers"],
  solution: { nodeVoltages: AnalyzeNodeVoltage[]; branchCurrents: AnalyzeBranchCurrent[]; analysisType: string },
): { passed: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const isAc = solution.analysisType === "ac";

  if (!aiAnswers) {
    return { passed: false, mismatches: ["未返回computedAnswers字段"] };
  }

  for (const mna of solution.nodeVoltages) {
    const ai = aiAnswers.nodeVoltages?.find((x) => x.nodeId === mna.nodeId);
    if (!ai) {
      mismatches.push(`节点${mna.nodeId}的电压未独立计算`);
      continue;
    }
    const vRe = safeNum(ai.voltage);
    if (vRe === null) {
      mismatches.push(`节点${mna.nodeId}电压数值无效（不是有效数字）`);
      continue;
    }
    if (isAc) {
      const vIm = safeNum(ai.voltageImag) ?? 0;
      const ok = compareComplex(vRe, vIm, mna.voltage, mna.voltageImag ?? 0);
      if (!ok) {
        mismatches.push(
          `节点${mna.nodeId}电压：你算的是 ${fmt(vRe)}+j${fmt(vIm)}，正确应该是 ${fmt(mna.voltage)}+j${fmt(mna.voltageImag ?? 0)}`,
        );
      }
    } else {
      const ok = compareScalar(vRe, mna.voltage);
      if (!ok) {
        mismatches.push(
          `节点${mna.nodeId}电压：你算的是 ${fmt(vRe)} V，正确应该是 ${fmt(mna.voltage)} V`,
        );
      }
    }
  }

  for (const mna of solution.branchCurrents) {
    const ai = aiAnswers.branchCurrents?.find((x) => x.elementId === mna.elementId);
    if (!ai) {
      mismatches.push(`元件${mna.elementId}的电流未独立计算`);
      continue;
    }
    const iRe = safeNum(ai.current);
    if (iRe === null) {
      mismatches.push(`元件${mna.elementId}电流数值无效（不是有效数字）`);
      continue;
    }
    if (isAc) {
      const iIm = safeNum(ai.currentImag) ?? 0;
      const ok = compareComplex(iRe, iIm, mna.current, mna.currentImag ?? 0);
      if (!ok) {
        mismatches.push(
          `元件${mna.elementId}电流：你算的是 ${fmt(iRe)}+j${fmt(iIm)}，正确应该是 ${fmt(mna.current)}+j${fmt(mna.currentImag ?? 0)}`,
        );
      }
    } else {
      const ok = compareScalar(iRe, mna.current);
      if (!ok) {
        mismatches.push(
          `元件${mna.elementId}电流：你算的是 ${fmt(iRe)} A，正确应该是 ${fmt(mna.current)} A（注意：电流方向约定从节点${(mna as { nodeFrom?: string }).nodeFrom ?? "起点"}→节点${(mna as { nodeTo?: string }).nodeTo ?? "终点"}为正）`,
        );
      }
    }
  }

  return { passed: mismatches.length === 0, mismatches };
}

router.post("/ai/analyze", async (req, res): Promise<void> => {
  const { circuit, solution, problemText, unknownElements } = req.body as {
    circuit: {
      elements: Array<{ id: string; type: string; value?: number; unit?: string; label?: string; nodeFrom: string; nodeTo: string }>;
      nodes: Array<{ id: string; label?: string }>;
      analysisType?: string;
    };
    solution: {
      nodeVoltages: AnalyzeNodeVoltage[];
      branchCurrents: AnalyzeBranchCurrent[];
      analysisType: string;
    };
    problemText?: string;
    unknownElements?: string[];
  };

  if (!circuit || !solution) {
    res.status(400).json({ error: "circuit and solution are required" });
    return;
  }

  // Build a structured description of the circuit (NO MNA answer leaked here)
  const circuitDesc = circuit.elements
    .filter((e) => e.type !== "wire" && e.type !== "ground")
    .map((e) => `${e.label ?? e.id}（${e.type}）: ${e.value ?? ""}${e.unit ?? ""}，从节点${e.nodeFrom}到节点${e.nodeTo}`)
    .join("\n");

  const nodeIds = solution.nodeVoltages.map((n) => n.nodeId).join(", ");
  const elementIds = solution.branchCurrents.map((b) => b.elementId).join(", ");

  // Defensively normalise unknownElements: optional array of strings from the
  // client; we don't validate request bodies at runtime here, so a malformed
  // payload (non-array, non-string entries, or huge list) shouldn't crash
  // this handler. Cap to 32 entries to keep prompt budget bounded.
  const safeUnknown = Array.isArray(unknownElements)
    ? unknownElements
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .slice(0, 32)
    : [];

  const unknownGuidance = safeUnknown.length > 0
    ? `

9. **待定参数（symbolic unknowns）处理 — 极其重要**：
   下列元件的真实数值题目未给出（用户标记为"待定"）：${safeUnknown.join("、")}。
   你必须把它们当作**未知量**（symbolic unknowns），用元件的 label 作为符号
   （例如 R₁ 写成 \`R_1\`，电压源 V₁ 写成 \`V_1\`）参与全部推导。

   - **每一步的 \`formula\` 字段必须用 LaTeX 符号表达式**（如 \`V_R = \\frac{V_s R_2}{R_1 + R_2}\`），
     不要把 R、V、I 替换成"电路描述"里给出的占位数字。
   - **每一步的 \`explanation\` 字段先用符号说理，最后再附一句"代入占位值得到 …"
     给出此步的近似数值**（基于电路描述里的占位数字），让学生看到符号→数值的过渡。
   - \`summary\` 也要先讲符号结论，再附"按本次占位值代入约为 …"。
   - \`computedAnswers\` 字段：按"电路描述"里的占位数值算出最终数字填进去（这是为了
     与权威求解器内部一致性比对所用，不是题目最终答案）。**注意：因为本次包含待定
     参数，服务端会跳过严格的逐项数值校验**，但请仍然认真填写。
   - \`keyInsights\` 至少有一条要明确指出："以上结论中的最终量随 ${safeUnknown.join("、")}
     变化的关系式"。`
    : "";

  const systemPrompt = `你是一位专业的电路分析教师，正在独立分析并向大学生解释电路题目的解题过程。

重要原则：
1. 你必须独立推导，不得倒着编造过程。每一步的算式与最终数值必须自洽。
2. 每一步要包含具体的公式（使用LaTeX格式，用$$包围）
3. 解释要面向初学者，但要保证数学严谨
4. 分析类型：${solution.analysisType === "ac" ? "交流稳态分析（相量法）" : "直流稳态分析"}
5. 在 \`computedAnswers\` 字段里，按你独立推导的结果，填入所有节点电压（节点编号：${nodeIds}）与所有元件电流（元件编号：${elementIds}）。这些数字将与权威求解器逐项比对，请认真计算。
6. 单位约定：电压用伏特(V)，电流用安培(A)。AC分析时使用复数（实部+虚部，j为虚数单位）。
7. **电流参考方向约定**：每个元件的电流取"从 nodeFrom 流向 nodeTo"为正方向（电路描述里"从节点A到节点B"中A是nodeFrom）。如果实际电流相反，请填入负值。这一点非常重要，否则数值会被判为错误。
8. 节点电压均以接地节点（节点编号通常含"0"或"gnd"）为参考点；接地节点电压为0。

返回一个JSON对象：
{
  "steps": [
    {
      "stepNumber": 1,
      "title": "步骤标题",
      "explanation": "详细解释",
      "formula": "LaTeX公式（可选）"
    }
  ],
  "summary": "总结性结论",
  "keyInsights": ["关键点1", "关键点2"],
  "computedAnswers": {
    "nodeVoltages": [{ "nodeId": "n1", "voltage": 12.5${solution.analysisType === "ac" ? ", \"voltageImag\": 0" : ""} }],
    "branchCurrents": [{ "elementId": "R1", "current": 0.625${solution.analysisType === "ac" ? ", \"currentImag\": 0" : ""} }]
  }
}

只返回JSON，不要有其他文字。${unknownGuidance}`;

  const baseUserMessage = `${problemText ? `题目要求：\n${problemText}\n\n` : ""}电路描述：
${circuitDesc}

请独立完成解题，给出清晰的分步推导过程，并在 computedAnswers 字段里给出你算得的所有节点电压和支路电流。`;

  try {
    let lastParsed: AnalyzeAIOutput = {};
    let attempts = 0;
    let verified = false;
    let lastMismatches: string[] = [];

    // When the user marked any element as 待定 (unknown), the AI is asked to
    // reason symbolically. computedAnswers will only match the MNA solver's
    // placeholder-driven numbers if the AI mechanically substitutes — which
    // defeats the symbolic explanation we want. So in that case we make a
    // single attempt and skip strict numerical verification.
    const placeholderBased = safeUnknown.length > 0;
    const maxAttempts = placeholderBased ? 1 : MAX_ATTEMPTS;

    for (attempts = 1; attempts <= maxAttempts; attempts++) {
      // Rebuild a compact message list each round (don't append history → keeps token cost flat)
      const messages: { role: "system" | "user"; content: string }[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: baseUserMessage },
      ];

      if (attempts > 1 && lastMismatches.length > 0) {
        messages.push({
          role: "user",
          content: `你之前的推导出现了以下偏差（这是第 ${attempts}/${MAX_ATTEMPTS} 次尝试），请重新独立推导。**不要直接照抄下面的"正确值"**，而是检查你的方法/方程/参考方向哪里不对，从头按正确思路推导：
${lastMismatches.map((m) => `- ${m}`).join("\n")}

请重新输出完整的JSON（包含steps、summary、keyInsights、computedAnswers），保证每一步的算式自洽且与computedAnswers一致。`,
        });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 4096,
        messages,
      });

      const content = response.choices[0]?.message?.content ?? "{}";
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        lastParsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as AnalyzeAIOutput) : {};
      } catch {
        lastParsed = {};
      }

      if (placeholderBased) {
        // Soft-verify: don't gate on numerical match. We log any divergence
        // for visibility but accept the symbolic explanation as-is and stop.
        const { passed, mismatches } = verifyAIAgainstMNA(lastParsed.computedAnswers, solution);
        if (!passed) {
          req.log.info(
            { mismatches, unknown: safeUnknown },
            "AI numerical answers diverged from MNA placeholder solve (expected — symbolic mode, soft verify)",
          );
        }
        lastMismatches = [];
        verified = true;
        break;
      }
      const { passed, mismatches } = verifyAIAgainstMNA(lastParsed.computedAnswers, solution);
      lastMismatches = mismatches;
      if (passed) {
        verified = true;
        break;
      }
    }

    let verificationNote: string | undefined;
    if (placeholderBased) {
      verificationNote = `本题包含待定参数（${safeUnknown.join("、")}）。下方解析按符号方式推导，"求解结果"中的数值仅基于占位假设，请以解析中的符号公式为准。`;
    } else if (!verified) {
      verificationNote = `AI 经过 ${MAX_ATTEMPTS} 次尝试仍无法给出与权威求解器一致的解题过程，下方步骤仅供参考，准确数值以"求解结果"为准。`;
      req.log.warn({ mismatches: lastMismatches, attempts }, "AI verification failed after max attempts");
    }

    res.json({
      steps: lastParsed.steps ?? [],
      summary: lastParsed.summary ?? "分析完成。",
      keyInsights: lastParsed.keyInsights ?? [],
      verified,
      verificationAttempts: attempts > maxAttempts ? maxAttempts : attempts,
      ...(verificationNote ? { verificationNote } : {}),
      ...(placeholderBased ? { placeholderBased: true } : {}),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to analyze circuit");
    res.status(500).json({ error: "AI分析服务暂时不可用，请稍后再试。" });
  }
});

// ─── /ai/solve-unknowns ─────────────────────────────────────────────────────
// Given a circuit with one or more elements marked "待定" (unknown) plus a list
// of user-written target constraints (e.g. "V(n1) = 5V"), ask the AI to write
// the MNA equations symbolically and return numeric values for every unknown
// that simultaneously satisfy the constraints. We then verify by substituting
// those values into the circuit and re-running our authoritative MNA solver:
// if any parsed constraint disagrees with the verified solution, we feed the
// mismatches back to the AI and retry up to MAX_SOLVE_ATTEMPTS times.

interface UnknownElementSpec {
  elementId: string;
  label: string;
  type: string;
  unit?: string;
}

interface UnknownValue {
  elementId: string;
  label: string;
  value: number;
  valueImag?: number;
  unit: string;
  displayValue?: string;
}

interface SolveUnknownsAIOutput {
  unknownValues?: Array<Partial<UnknownValue>>;
  reasoning?: string;
}

const MAX_SOLVE_ATTEMPTS = 3;
const SOLVE_TOL_REL = 0.01; // 1 % relative tolerance
const SOLVE_TOL_ABS = 1e-3;

// Parse the most common student-written constraint forms. Anything we can't
// parse is reported back to the client so the user knows it wasn't enforced.
//
// Supported forms (whitespace tolerant, case-insensitive):
//   V(<node>) = <number>[unit]
//   V(<node1>, <node2>) = <number>[unit]
//   V<node> = <number>[unit]
//   I(<elementLabelOrId>) = <number>[unit]
//   I<elementLabelOrId> = <number>[unit]
//
// Returns either a parsed constraint object or null if the line couldn't be
// recognised (the caller will record it in `unverifiedConstraints`).
type ParsedConstraint =
  | { kind: "V_node"; node: string; value: number; raw: string }
  | { kind: "V_diff"; nodeA: string; nodeB: string; value: number; raw: string }
  | { kind: "I_branch"; element: string; value: number; raw: string };

// Convert "200mA" → 0.2, "2.5kV" → 2500, "10" → 10. We strip a trailing base
// unit letter (V/A/Ω/Ohm/W/F/H/Hz) if present, then look for an SI prefix
// just before it. Anything we don't recognise is silently treated as the
// base unit so users can still type bare numbers.
const SI_PREFIX: Record<string, number> = {
  T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2,
  d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, µ: 1e-6, μ: 1e-6,
  n: 1e-9, p: 1e-12, f: 1e-15,
};
function parseSiNumber(raw: string): number {
  const trimmed = raw.trim();
  // Strip a trailing base unit token if present (case-insensitive on the unit
  // body itself but not on the SI prefix — "mA" vs "MA" matters).
  const unitMatch = trimmed.match(/^(.*?)([TGMkhdcmuµμnpf])?(V|A|Ω|Ohm|ohm|W|F|H|Hz|s)?\s*$/);
  if (!unitMatch) return Number(trimmed);
  const numericPart = unitMatch[1].trim();
  const prefix = unitMatch[2];
  const n = Number(numericPart);
  if (!Number.isFinite(n)) return NaN;
  if (!prefix) return n;
  const mult = SI_PREFIX[prefix];
  return mult ? n * mult : n;
}

function parseConstraint(raw: string): ParsedConstraint | null {
  const line = raw.trim().replace(/[；;]+$/, "");
  if (!line) return null;
  // Capture the entire RHS (number + optional SI prefix + optional unit) as
  // one chunk so we can hand it to parseSiNumber for proper SI handling.
  const rhsRe = "([-+]?\\d+(?:\\.\\d+)?(?:[eE][+\\-]?\\d+)?\\s*[a-zA-ZΩµμ]*)";

  // V(a, b) = X
  let m = line.match(new RegExp(`^[Vv]\\s*\\(\\s*([\\w.,_\\-]+?)\\s*,\\s*([\\w.,_\\-]+?)\\s*\\)\\s*=\\s*${rhsRe}`));
  if (m) {
    const v = parseSiNumber(m[3]);
    if (Number.isFinite(v)) return { kind: "V_diff", nodeA: m[1], nodeB: m[2], value: v, raw };
  }
  // V(a) = X
  m = line.match(new RegExp(`^[Vv]\\s*\\(\\s*([\\w.,_\\-]+?)\\s*\\)\\s*=\\s*${rhsRe}`));
  if (m) {
    const v = parseSiNumber(m[2]);
    if (Number.isFinite(v)) return { kind: "V_node", node: m[1], value: v, raw };
  }
  // V<a> = X (no parens)
  m = line.match(new RegExp(`^[Vv]([\\w.\\-]+)\\s*=\\s*${rhsRe}`));
  if (m) {
    const v = parseSiNumber(m[2]);
    if (Number.isFinite(v)) return { kind: "V_node", node: m[1], value: v, raw };
  }
  // I(R1) = X
  m = line.match(new RegExp(`^[Ii]\\s*\\(\\s*([\\w.\\-]+?)\\s*\\)\\s*=\\s*${rhsRe}`));
  if (m) {
    const v = parseSiNumber(m[2]);
    if (Number.isFinite(v)) return { kind: "I_branch", element: m[1], value: v, raw };
  }
  // I<R1> = X
  m = line.match(new RegExp(`^[Ii]([\\w.\\-]+)\\s*=\\s*${rhsRe}`));
  if (m) {
    const v = parseSiNumber(m[2]);
    if (Number.isFinite(v)) return { kind: "I_branch", element: m[1], value: v, raw };
  }
  return null;
}

function compareScalarSolve(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  if (diff <= SOLVE_TOL_ABS) return true;
  const denom = Math.max(Math.abs(b), SOLVE_TOL_ABS);
  return diff / denom <= SOLVE_TOL_REL;
}

interface VerifyResult {
  passed: boolean;
  mismatches: string[];
  unparseable: string[];
  solverError?: string;
}

function verifyUnknownsAgainstConstraints(
  proposed: UnknownValue[],
  baseCircuit: MnaCircuitInput,
  unknownIds: Set<string>,
  constraints: string[],
): VerifyResult {
  // Substitute proposed values back into the circuit
  const valueById = new Map(proposed.map((u) => [u.elementId, u.value]));
  const subbed: MnaCircuitElement[] = baseCircuit.elements.map((el) => {
    if (!unknownIds.has(el.id)) return el;
    const v = valueById.get(el.id);
    if (v === undefined || !Number.isFinite(v)) return el;
    // Resistors/inductors must stay >0 for MNA stability
    let safeValue = v;
    if ((el.type === "resistor") && safeValue <= 0) safeValue = 1e-9;
    return { ...el, value: safeValue };
  });
  const verifyCircuit: MnaCircuitInput = { ...baseCircuit, elements: subbed };

  const sol = runMnaSolver(verifyCircuit);
  if ("error" in sol) {
    return { passed: false, mismatches: [], unparseable: [], solverError: sol.details ?? sol.error };
  }
  const solution = sol as MnaCircuitSolution;

  // Build lookups
  const voltOf = new Map<string, number>();
  voltOf.set("0", 0);
  for (const nv of solution.nodeVoltages) voltOf.set(nv.nodeId, nv.voltage);
  const currOf = new Map<string, number>();
  for (const bc of solution.branchCurrents) {
    currOf.set(bc.elementId, bc.current);
    // Also index by element label if available (lets users write I(R1) instead of an internal id)
    const matchingEl = verifyCircuit.elements.find((e) => e.id === bc.elementId);
    if (matchingEl?.label) currOf.set(matchingEl.label, bc.current);
  }

  const mismatches: string[] = [];
  const unparseable: string[] = [];
  for (const raw of constraints) {
    const parsed = parseConstraint(raw);
    if (!parsed) { unparseable.push(raw); continue; }
    if (parsed.kind === "V_node") {
      const v = voltOf.get(parsed.node);
      if (v === undefined) {
        unparseable.push(`${raw}（找不到节点 ${parsed.node}）`);
        continue;
      }
      if (!compareScalarSolve(v, parsed.value)) {
        mismatches.push(`约束 "${raw}"：代入你给的待定参数后实际 V(${parsed.node}) = ${v.toFixed(4)}，目标值 = ${parsed.value}`);
      }
    } else if (parsed.kind === "V_diff") {
      const va = voltOf.get(parsed.nodeA);
      const vb = voltOf.get(parsed.nodeB);
      if (va === undefined || vb === undefined) {
        unparseable.push(`${raw}（找不到节点 ${parsed.nodeA} 或 ${parsed.nodeB}）`);
        continue;
      }
      const diff = va - vb;
      if (!compareScalarSolve(diff, parsed.value)) {
        mismatches.push(`约束 "${raw}"：代入你给的待定参数后实际 V(${parsed.nodeA})-V(${parsed.nodeB}) = ${diff.toFixed(4)}，目标值 = ${parsed.value}`);
      }
    } else {
      const i = currOf.get(parsed.element);
      if (i === undefined) {
        unparseable.push(`${raw}（找不到元件 ${parsed.element}）`);
        continue;
      }
      if (!compareScalarSolve(i, parsed.value)) {
        mismatches.push(`约束 "${raw}"：代入你给的待定参数后实际 I(${parsed.element}) = ${i.toFixed(4)}，目标值 = ${parsed.value}`);
      }
    }
  }
  // Treat unparseable constraints as a verification failure too: if we cannot
  // mechanically check a constraint, we must not advertise the answer as
  // "fully verified" — the caller still surfaces the AI numbers and the
  // unparseable list to the student so they can fix the wording.
  return {
    passed: mismatches.length === 0 && unparseable.length === 0,
    mismatches,
    unparseable,
  };
}

function formatDisplayValue(u: UnknownValue): string {
  // Compact engineering-ish formatting: keep up to 4 significant digits, append unit
  const v = u.value;
  if (!Number.isFinite(v)) return `${v} ${u.unit}`;
  const abs = Math.abs(v);
  let s: string;
  if (abs === 0) s = "0";
  else if (abs >= 1000 || abs < 0.001) s = v.toExponential(3);
  else s = Number(v.toPrecision(4)).toString();
  return u.unit ? `${s} ${u.unit}` : s;
}

router.post("/ai/solve-unknowns", async (req, res): Promise<void> => {
  const { circuit, unknownElements, constraints, problemText } = req.body as {
    circuit?: MnaCircuitInput;
    unknownElements?: UnknownElementSpec[];
    constraints?: string[];
    problemText?: string;
  };

  if (!circuit || !Array.isArray(circuit.elements) || !Array.isArray(circuit.nodes)) {
    res.status(400).json({ error: "circuit (with elements and nodes) is required" });
    return;
  }
  if (!Array.isArray(unknownElements) || unknownElements.length === 0) {
    res.status(400).json({ error: "unknownElements must be a non-empty array" });
    return;
  }
  if (!Array.isArray(constraints) || constraints.length === 0) {
    res.status(400).json({ error: "constraints must be a non-empty array" });
    return;
  }

  // Defensive caps: prevent prompt blow-ups from runaway client payloads.
  const safeUnknowns = unknownElements
    .filter((u): u is UnknownElementSpec =>
      !!u && typeof u.elementId === "string" && typeof u.label === "string" && typeof u.type === "string",
    )
    .slice(0, 16);
  const safeConstraints = constraints
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim())
    .slice(0, 16);
  if (safeUnknowns.length === 0 || safeConstraints.length === 0) {
    res.status(400).json({ error: "At least one valid unknown element and one constraint are required" });
    return;
  }

  const unknownIds = new Set(safeUnknowns.map((u) => u.elementId));

  // Build a structured circuit description for the AI. Substituted placeholder
  // values for unknowns are clearly flagged so the AI knows to ignore them.
  const elementDesc = circuit.elements
    .filter((e) => e.type !== "wire" && e.type !== "ground")
    .map((e) => {
      const isUnknown = unknownIds.has(e.id);
      const label = e.label ?? e.id;
      const valuePart = isUnknown
        ? `值未知（请用符号 ${label} 表示）`
        : `${e.value ?? "?"}${e.unit ?? ""}`;
      return `- ${label}（${e.type}, id=${e.id}）: ${valuePart}, 节点${e.nodeFrom} → 节点${e.nodeTo}`;
    })
    .join("\n");

  const groundDesc = circuit.elements.some((e) => e.type === "ground")
    ? `电路含显式接地元件，参考节点为 0。`
    : `参考节点为 0。`;

  const unknownList = safeUnknowns
    .map((u) => `${u.label}（id=${u.elementId}, type=${u.type}${u.unit ? `, 单位 ${u.unit}` : ""}）`)
    .join("\n- ");

  const constraintList = safeConstraints.map((c, i) => `${i + 1}. ${c}`).join("\n");

  const systemPrompt = `你是一位专业的电路分析教师。学生给你一个电路，里面有 ${safeUnknowns.length} 个待定参数（每个参数都标注了符号 label）以及 ${safeConstraints.length} 个目标约束。
你的任务：
1. 把每个待定参数当作未知数（使用提供的 label 作为变量名）。
2. 用 KCL/KVL/MNA 方程把电路写成代数方程组。
3. 把目标约束（例如 V(n1)=5、I(R3)=0.2 等）作为额外方程加入方程组。
4. 联立解出每个待定参数的数值。如果方程组有唯一解，给出该解；如果存在自由度，挑选一个使所有约束都成立的合理正实数解（并在 reasoning 里说明）。
5. 检查：把你解出的数值代回电路，KCL/KVL 必须自洽，且每个目标约束都要满足。

返回一个 JSON 对象（且仅返回 JSON，不要任何其他文字）：
{
  "unknownValues": [
    { "elementId": "<原始 id>", "label": "<原始 label>", "value": <数值>, "unit": "<单位>" }
  ],
  "reasoning": "用一两句话说明解题思路与求得的关键方程"
}

约束细节：
- value 必须是有限实数。${circuit.analysisType === "ac" ? "AC 分析时可附加 valueImag 表示虚部。" : ""}
- 单位约定：电阻 Ω，电容 F，电感 H，电压 V，电流 A。
- 物理合理性：电阻、电感、电容数值必须 > 0。
- 你必须为列表中的每一个待定参数都返回一个 value，elementId 与请求中的完全一致。`;

  const baseUserMessage = `电路结构：
${elementDesc}

${groundDesc}

待定参数（共 ${safeUnknowns.length} 个）：
- ${unknownList}

学生给出的目标约束（共 ${safeConstraints.length} 个）：
${constraintList}

${problemText ? `题目原文：\n${problemText}\n\n` : ""}请按上面的要求联立求解，并以 JSON 形式返回每个待定参数的具体数值。`;

  try {
    let lastParsed: SolveUnknownsAIOutput = {};
    let lastValues: UnknownValue[] = [];
    let lastVerify: VerifyResult = { passed: false, mismatches: [], unparseable: [] };
    let attempts = 0;
    let verified = false;

    for (attempts = 1; attempts <= MAX_SOLVE_ATTEMPTS; attempts++) {
      const messages: { role: "system" | "user"; content: string }[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: baseUserMessage },
      ];

      if (attempts > 1) {
        const feedbackParts: string[] = [];
        if (lastVerify.solverError) {
          feedbackParts.push(`代入你上次给的数值后 MNA 求解器报错：${lastVerify.solverError}。请检查参数是否物理合理（电阻必须 > 0 等），重新求解。`);
        }
        if (lastVerify.mismatches.length > 0) {
          feedbackParts.push(`代入你上次给的数值后，下列约束没有满足：\n${lastVerify.mismatches.map((m) => `- ${m}`).join("\n")}\n请重新解方程组。`);
        }
        if (feedbackParts.length === 0) {
          feedbackParts.push(`你上次的输出无法被解析为有效 JSON，或缺少必要字段。请严格按照系统提示的 JSON 结构重新输出。`);
        }
        messages.push({
          role: "user",
          content: `这是第 ${attempts}/${MAX_SOLVE_ATTEMPTS} 次尝试。\n${feedbackParts.join("\n\n")}\n\n请重新输出完整 JSON。`,
        });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 3072,
        messages,
      });

      const content = response.choices[0]?.message?.content ?? "{}";
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        lastParsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as SolveUnknownsAIOutput) : {};
      } catch {
        lastParsed = {};
      }

      // Coerce each AI value into our typed shape, falling back to spec metadata
      // so a missing label/unit doesn't lose the row.
      const specById = new Map(safeUnknowns.map((u) => [u.elementId, u]));
      const seen = new Set<string>();
      lastValues = [];
      for (const raw of lastParsed.unknownValues ?? []) {
        const id = typeof raw?.elementId === "string" ? raw.elementId : "";
        const spec = specById.get(id);
        if (!spec || seen.has(id)) continue;
        const v = Number(raw?.value);
        if (!Number.isFinite(v)) continue;
        seen.add(id);
        const u: UnknownValue = {
          elementId: id,
          label: typeof raw.label === "string" && raw.label ? raw.label : spec.label,
          value: v,
          ...(typeof raw.valueImag === "number" && Number.isFinite(raw.valueImag) ? { valueImag: raw.valueImag } : {}),
          unit: typeof raw.unit === "string" && raw.unit ? raw.unit : (spec.unit ?? ""),
        };
        u.displayValue = typeof raw.displayValue === "string" && raw.displayValue ? raw.displayValue : formatDisplayValue(u);
        lastValues.push(u);
      }

      // If the AI returned values for every unknown, run verification.
      const allCovered = safeUnknowns.every((u) => seen.has(u.elementId));
      if (!allCovered) {
        lastVerify = { passed: false, mismatches: [`AI 未能为全部 ${safeUnknowns.length} 个待定参数返回数值（仅 ${seen.size} 个）`], unparseable: [] };
        continue;
      }
      lastVerify = verifyUnknownsAgainstConstraints(lastValues, circuit, unknownIds, safeConstraints);
      if (lastVerify.passed && !lastVerify.solverError) {
        verified = true;
        break;
      }
    }

    let verificationNote: string | undefined;
    if (!verified) {
      if (lastValues.length === 0) {
        verificationNote = `AI 经过 ${MAX_SOLVE_ATTEMPTS} 次尝试未能给出有效的待定参数解。请检查约束格式或题目描述。`;
      } else {
        const detailParts: string[] = [];
        if (lastVerify.solverError) detailParts.push(`求解器错误：${lastVerify.solverError}`);
        if (lastVerify.mismatches.length > 0) detailParts.push(lastVerify.mismatches[0]);
        verificationNote = `AI 经过 ${MAX_SOLVE_ATTEMPTS} 次尝试仍未完全满足全部约束（${detailParts.join("；")}）。下方数值仅供参考，请人工复核。`;
        req.log.warn({ mismatches: lastVerify.mismatches, attempts }, "solve-unknowns verification failed");
      }
    }

    res.json({
      unknownValues: lastValues,
      reasoning: lastParsed.reasoning ?? "",
      verified,
      verificationAttempts: attempts > MAX_SOLVE_ATTEMPTS ? MAX_SOLVE_ATTEMPTS : attempts,
      ...(verificationNote ? { verificationNote } : {}),
      ...(lastVerify.unparseable.length > 0 ? { unverifiedConstraints: lastVerify.unparseable } : {}),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to solve unknowns");
    res.status(500).json({ error: "AI 求解服务暂时不可用，请稍后再试。" });
  }
});

router.post("/ai/chat", async (req, res): Promise<void> => {
  const { messages, circuit, solution, analysis } = req.body as {
    messages: Array<{ role: string; content: string }>;
    circuit?: {
      elements: Array<{ id: string; type: string; value?: number; unit?: string; label?: string }>;
      nodes: Array<{ id: string }>;
      analysisType?: string;
    };
    solution?: {
      nodeVoltages: Array<{ nodeId: string; voltage: number; voltageImag?: number; unit: string }>;
      branchCurrents: Array<{ elementId: string; current: number; currentImag?: number; unit: string }>;
      analysisType: string;
    };
    analysis?: {
      steps?: Array<{ title: string; explanation: string }>;
      summary?: string;
    };
  };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  // Build context about the circuit and solution
  let contextParts: string[] = [];

  if (circuit) {
    const elements = circuit.elements
      .filter((e) => e.type !== "wire" && e.type !== "ground")
      .map((e) => `${e.label ?? e.id}（${e.type}）: ${e.value ?? ""}${e.unit ?? ""}`)
      .join(", ");
    contextParts.push(`电路包含：${elements}`);
  }

  if (solution) {
    const voltages = solution.nodeVoltages
      .map((n) => `节点${n.nodeId}: ${n.voltage.toFixed(3)}V`)
      .join(", ");
    contextParts.push(`节点电压：${voltages}`);
  }

  if (analysis?.summary) {
    contextParts.push(`解题总结：${analysis.summary}`);
  }

  const systemPrompt = `你是一位耐心的大学电路课程助教，正在帮助学生理解电路分析题目。

${contextParts.length > 0 ? `当前电路信息：\n${contextParts.join("\n")}\n` : ""}

回答原则：
1. 用简洁清晰的中文回答
2. 对于具体数值，必须与已知的求解结果一致，不得编造
3. 如果学生问到超出当前题目范围的问题，可以适当扩展但要说明
4. 对于不确定的问题，直接说明不确定，不要乱猜
5. 公式使用 $$...$$ 格式
6. 回答要有教育性，帮助学生真正理解，而不仅仅是给出答案`;

  try {
    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 2048,
      messages: chatMessages,
    });

    const content = response.choices[0]?.message?.content ?? "抱歉，我现在无法回答这个问题。";

    res.json({
      content,
      role: "assistant",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to chat with AI");
    res.status(500).json({ error: "AI服务暂时不可用，请稍后再试。" });
  }
});

export default router;
