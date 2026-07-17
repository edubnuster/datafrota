import { Router, type Request, type Response } from "express";
import {
  AdminAccountValidationError,
  getAdminAccount,
  updateAdminAccount,
} from "../services/adminAccountService.js";
import type { UpdateSaasAdminAccountInput } from "../../shared/adminAccount.js";

const router = Router();

router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const item = await getAdminAccount();
    res.status(200).json({ success: true, item });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Nao foi possivel carregar a conta administrativa.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.put("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await updateAdminAccount(req.body as UpdateSaasAdminAccountInput);
    res.status(200).json({ success: true, item });
  } catch (error) {
    if (error instanceof AdminAccountValidationError) {
      res.status(400).json({
        success: false,
        error: "Dados invalidos para atualizar a conta administrativa.",
        issues: error.issues,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel atualizar a conta administrativa.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export default router;
