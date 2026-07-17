import { Router, type Request, type Response } from "express";
import {
  PdvAgentError,
  listPdvPromotionsForAgent,
  requirePdvAgentSession,
} from "../services/pdvAgentService.js";

const router = Router();

router.get("/sync", async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await requirePdvAgentSession(req);
    const payload = await listPdvPromotionsForAgent(session);
    res.status(200).json({ success: true, ...payload });
  } catch (error) {
    if (error instanceof PdvAgentError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel sincronizar as promocoes do PDV.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export default router;
