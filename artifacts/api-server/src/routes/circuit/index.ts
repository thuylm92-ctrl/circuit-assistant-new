import { Router, type IRouter } from "express";
import {
  SolveCircuitBody,
  ValidateCircuitBody,
} from "@workspace/api-zod";
import { solveCircuit, validateCircuit } from "../../lib/mna-solver";

const router: IRouter = Router();

router.post("/circuit/solve", async (req, res): Promise<void> => {
  const parsed = SolveCircuitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = solveCircuit(parsed.data as Parameters<typeof solveCircuit>[0]);

  if ("reason" in result) {
    res.status(422).json(result);
    return;
  }

  res.json(result);
});

router.post("/circuit/validate", async (req, res): Promise<void> => {
  const parsed = ValidateCircuitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = validateCircuit(parsed.data as Parameters<typeof validateCircuit>[0]);
  res.json(result);
});

export default router;
