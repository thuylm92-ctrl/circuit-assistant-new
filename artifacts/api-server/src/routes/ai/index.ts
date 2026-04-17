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

router.post("/ai/analyze", async (req, res): Promise<void> => {
  const { circuit, solution, problemText } = req.body as {
    circuit: {
      elements: Array<{ id: string; type: string; value?: number; unit?: string; label?: string; nodeFrom: string; nodeTo: string }>;
      nodes: Array<{ id: string; label?: string }>;
      analysisType?: string;
    };
    solution: {
      nodeVoltages: Array<{ nodeId: string; voltage: number; voltageImag?: number; unit: string }>;
      branchCurrents: Array<{ elementId: string; current: number; currentImag?: number; unit: string }>;
      analysisType: string;
    };
    problemText?: string;
  };

  if (!circuit || !solution) {
    res.status(400).json({ error: "circuit and solution are required" });
    return;
  }

  // Build a structured description of the circuit and solution
  const circuitDesc = circuit.elements
    .filter((e) => e.type !== "wire" && e.type !== "ground")
    .map((e) => `${e.label ?? e.id}（${e.type}）: ${e.value ?? ""}${e.unit ?? ""}，从节点${e.nodeFrom}到节点${e.nodeTo}`)
    .join("\n");

  const nodeVoltagesDesc = solution.nodeVoltages
    .map((n) => {
      if (solution.analysisType === "ac" && n.voltageImag !== undefined) {
        return `节点${n.nodeId}: V = ${n.voltage.toFixed(4)} + j${(n.voltageImag ?? 0).toFixed(4)} V`;
      }
      return `节点${n.nodeId}: V = ${n.voltage.toFixed(4)} V`;
    })
    .join("\n");

  const branchCurrentsDesc = solution.branchCurrents
    .map((b) => {
      const el = circuit.elements.find((e) => e.id === b.elementId);
      const name = el?.label ?? b.elementId;
      if (solution.analysisType === "ac" && b.currentImag !== undefined) {
        return `${name}: I = ${b.current.toFixed(4)} + j${(b.currentImag ?? 0).toFixed(4)} A`;
      }
      return `${name}: I = ${b.current.toFixed(4)} A`;
    })
    .join("\n");

  const systemPrompt = `你是一位专业的电路分析教师，正在向大学生解释电路题目的解题过程。
你有已知的正确答案（由MNA修正节点分析法数值求解器算出），你的任务是用清晰的步骤解释如何得到这个答案。

重要原则：
1. 所有解释必须与提供的数值答案完全一致，不得编造或改变任何数值
2. 按照实际的解题思路解释每一步
3. 每一步要包含具体的公式（使用LaTeX格式，用$$包围）
4. 解释要面向初学者，但也要保证准确性
5. 如果答案中有零或接近零的量，要解释为什么
6. 分析类型：${solution.analysisType === "ac" ? "交流稳态分析（相量法）" : "直流稳态分析"}

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
  "keyInsights": ["关键点1", "关键点2"]
}

只返回JSON，不要有其他文字。`;

  const userMessage = `${problemText ? `题目要求：\n${problemText}\n\n` : ""}电路描述：
${circuitDesc}

MNA求解结果（此为正确答案）：
节点电压：
${nodeVoltagesDesc}

支路电流：
${branchCurrentsDesc}

请基于以上正确答案，给出清晰的分步解题过程。`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    let parsed: {
      steps?: Array<{ stepNumber: number; title: string; explanation: string; formula?: string }>;
      summary?: string;
      keyInsights?: string[];
    };

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      parsed = {};
    }

    res.json({
      steps: parsed.steps ?? [],
      summary: parsed.summary ?? "分析完成。",
      keyInsights: parsed.keyInsights ?? [],
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
