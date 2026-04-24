import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

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
  const { circuit, solution, problemText } = req.body as {
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

只返回JSON，不要有其他文字。`;

  const baseUserMessage = `${problemText ? `题目要求：\n${problemText}\n\n` : ""}电路描述：
${circuitDesc}

请独立完成解题，给出清晰的分步推导过程，并在 computedAnswers 字段里给出你算得的所有节点电压和支路电流。`;

  try {
    let lastParsed: AnalyzeAIOutput = {};
    let attempts = 0;
    let verified = false;
    let lastMismatches: string[] = [];

    for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
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

      const { passed, mismatches } = verifyAIAgainstMNA(lastParsed.computedAnswers, solution);
      lastMismatches = mismatches;
      if (passed) {
        verified = true;
        break;
      }
    }

    let verificationNote: string | undefined;
    if (!verified) {
      verificationNote = `AI 经过 ${MAX_ATTEMPTS} 次尝试仍无法给出与权威求解器一致的解题过程，下方步骤仅供参考，准确数值以"求解结果"为准。`;
      req.log.warn({ mismatches: lastMismatches, attempts }, "AI verification failed after max attempts");
    }

    res.json({
      steps: lastParsed.steps ?? [],
      summary: lastParsed.summary ?? "分析完成。",
      keyInsights: lastParsed.keyInsights ?? [],
      verified,
      verificationAttempts: attempts > MAX_ATTEMPTS ? MAX_ATTEMPTS : attempts,
      ...(verificationNote ? { verificationNote } : {}),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to analyze circuit");
    res.status(500).json({ error: "AI分析服务暂时不可用，请稍后再试。" });
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
