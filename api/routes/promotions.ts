import { Router, type Request, type Response } from "express";
import {
  createPromotion,
  deletePromotion,
  listPromotions,
  PromotionValidationError,
  updatePromotion,
} from "../services/promotionService.js";
import { getPromotionDashboardStats } from "../services/promotionDashboardService.js";
import { resolveSaasAccessContext, SaasAccessError } from "../services/saasAccessService.js";
import type { CreatePromotionInput } from "../../shared/promotion.js";

const router = Router();

router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const accessContext = await resolveSaasAccessContext(_req);
    const items = await listPromotions({
      companyId: accessContext.role === "company_admin" ? accessContext.companyId : null,
    });
    res.status(200).json({ success: true, items });
  } catch (error) {
    if (error instanceof SaasAccessError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel listar as campanhas.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.get("/dashboard/stats", async (_req: Request, res: Response): Promise<void> => {
  try {
    const accessContext = await resolveSaasAccessContext(_req);
    const item = await getPromotionDashboardStats({
      companyId: accessContext.role === "company_admin" ? accessContext.companyId : null,
    });
    res.status(200).json({ success: true, item });
  } catch (error) {
    if (error instanceof SaasAccessError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel carregar o dashboard de vouchers.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const accessContext = await resolveSaasAccessContext(req);
    if (accessContext.role !== "company_admin") {
      res.status(403).json({
        success: false,
        error: "Somente o login da empresa pode cadastrar campanhas neste modulo.",
      });
      return;
    }

    const created = await createPromotion(req.body as CreatePromotionInput, {
      companyId: accessContext.companyId,
      allowedBranchIds: accessContext.allowedBranchIds,
    });
    res.status(201).json({ success: true, item: created });
  } catch (error) {
    if (error instanceof SaasAccessError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    if (error instanceof PromotionValidationError) {
      res.status(400).json({
        success: false,
        error: "Dados invalidos para cadastrar a campanha.",
        issues: error.issues,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel cadastrar a campanha.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.put("/:promotionId", async (req: Request, res: Response): Promise<void> => {
  try {
    const accessContext = await resolveSaasAccessContext(req);
    if (accessContext.role !== "company_admin") {
      res.status(403).json({
        success: false,
        error: "Somente o login da empresa pode atualizar campanhas neste modulo.",
      });
      return;
    }

    const updated = await updatePromotion(req.params.promotionId, req.body as CreatePromotionInput, {
      companyId: accessContext.companyId,
      allowedBranchIds: accessContext.allowedBranchIds,
    });

    if (!updated) {
      res.status(404).json({
        success: false,
        error: "Campanha nao encontrada para atualizacao.",
      });
      return;
    }

    res.status(200).json({ success: true, item: updated });
  } catch (error) {
    if (error instanceof SaasAccessError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    if (error instanceof PromotionValidationError) {
      res.status(400).json({
        success: false,
        error: "Dados invalidos para atualizar a campanha.",
        issues: error.issues,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel atualizar a campanha.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.delete("/:promotionId", async (req: Request, res: Response): Promise<void> => {
  try {
    const accessContext = await resolveSaasAccessContext(req);
    if (accessContext.role !== "company_admin") {
      res.status(403).json({
        success: false,
        error: "Somente o login da empresa pode excluir campanhas neste modulo.",
      });
      return;
    }

    const deleted = await deletePromotion(req.params.promotionId, {
      companyId: accessContext.companyId,
    });

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: "Campanha nao encontrada para exclusao.",
      });
      return;
    }

    res.status(200).json({ success: true, item: deleted });
  } catch (error) {
    if (error instanceof SaasAccessError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel excluir a campanha.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export default router;
