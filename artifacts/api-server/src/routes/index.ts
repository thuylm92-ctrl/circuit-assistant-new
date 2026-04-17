import { Router, type IRouter } from "express";
import healthRouter from "./health";
import circuitRouter from "./circuit";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(circuitRouter);
router.use(aiRouter);

export default router;
