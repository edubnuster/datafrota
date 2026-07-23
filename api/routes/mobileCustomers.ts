import { Router, type Request, type Response } from "express";
import {
  MobileCustomerAuthValidationError,
  getMobileCustomerBootstrap,
  loginMobileCustomer,
  requireMobileCustomerSession,
  registerMobileCustomer,
  updateMobileCustomerProfile,
} from "../services/mobileCustomerAuthService.js";
import {
  issueMobilePromotionVoucher,
  listEligibleMobilePromotions,
  MobileCustomerPromotionError,
} from "../services/mobileCustomerPromotionService.js";
import type {
  CreateMobileCustomerInput,
  MobileCustomerLoginInput,
} from "../../shared/mobileCustomer.js";

const router = Router();

router.get("/bootstrap", async (_req: Request, res: Response): Promise<void> => {
  try {
    const companyId = typeof _req.query.companyId === "string" ? _req.query.companyId.trim() : undefined;
    const item = await getMobileCustomerBootstrap(companyId);
    res.status(200).json({ success: true, item });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Nao foi possivel carregar a configuracao inicial do app mobile.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await registerMobileCustomer(req.body as CreateMobileCustomerInput);
    res.status(201).json({ success: true, item });
  } catch (error) {
    if (error instanceof MobileCustomerAuthValidationError) {
      res.status(400).json({
        success: false,
        error: "Dados invalidos para cadastro mobile.",
        issues: error.issues,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel concluir o cadastro mobile.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await loginMobileCustomer(req.body as MobileCustomerLoginInput);
    res.status(200).json({ success: true, item });
  } catch (error) {
    if (error instanceof MobileCustomerAuthValidationError) {
      res.status(400).json({
        success: false,
        error: "Nao foi possivel autenticar o cliente mobile.",
        issues: error.issues,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Falha inesperada ao autenticar o cliente mobile.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.get("/me/promotions", async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await requireMobileCustomerSession(req);
    const items = await listEligibleMobilePromotions({
      companyId: session.companyId,
      documentNumber: session.documentNumberDigits,
      customerBirthDate: session.customer.birthDate,
    });
    res.status(200).json({ success: true, items });
  } catch (error) {
    if (error instanceof MobileCustomerAuthValidationError) {
      res.status(401).json({
        success: false,
        error: "Nao foi possivel identificar a sessao do cliente mobile.",
        issues: error.issues,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Falha inesperada ao buscar as promocoes do app mobile.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/me/promotions/:promotionId/voucher", async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await requireMobileCustomerSession(req);
    const item = await issueMobilePromotionVoucher({
      companyId: session.companyId,
      promotionId: req.params.promotionId,
      documentNumber: session.documentNumberDigits,
      documentType: session.customer.documentType,
      customerBirthDate: session.customer.birthDate,
    });
    res.status(201).json({ success: true, item });
  } catch (error) {
    if (error instanceof MobileCustomerAuthValidationError) {
      res.status(401).json({
        success: false,
        error: "Nao foi possivel identificar a sessao do cliente mobile.",
        issues: error.issues,
      });
      return;
    }

    if (error instanceof MobileCustomerPromotionError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Falha inesperada ao emitir o voucher da promocao no app mobile.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

async function handleUpdateProfile(req: Request, res: Response): Promise<void> {
  try {
    const session = await requireMobileCustomerSession(req);
    const item = await updateMobileCustomerProfile({
      accountId: session.accountId,
      companyId: session.companyId,
      input: req.body as Record<string, unknown>,
    });
    res.status(200).json({ success: true, item });
  } catch (error) {
    if (error instanceof MobileCustomerAuthValidationError) {
      res.status(400).json({
        success: false,
        error: "Dados invalidos para atualizar o perfil mobile.",
        issues: error.issues,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel atualizar o perfil mobile.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
}

router.patch("/me", handleUpdateProfile);
router.post("/me", handleUpdateProfile);

export default router;
