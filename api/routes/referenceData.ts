import { Router, type Request, type Response } from "express";
import { listReferenceData } from "../services/referenceDataService.js";
import { resolveSaasAccessContext, SaasAccessError } from "../services/saasAccessService.js";
import type { ReferenceDataType } from "../../shared/referenceData.js";

const router = Router();

router.get("/:type", async (req: Request, res: Response): Promise<void> => {
  const type = req.params.type as ReferenceDataType;
  const allowedTypes: ReferenceDataType[] = [
    "products",
    "product-groups",
    "customer-groups",
    "customers",
    "branches",
    "payment-forms",
  ];

  if (!allowedTypes.includes(type)) {
    res.status(400).json({
      success: false,
      error: "Tipo de lista invalido.",
    });
    return;
  }

  try {
    const accessContext = await resolveSaasAccessContext(req);
    const selectedCodes = String(req.query.selected || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const items = await listReferenceData(type, String(req.query.q || ""), selectedCodes, {
      allowedBranchIds: accessContext.role === "company_admin" ? accessContext.allowedBranchIds : null,
      companyId: accessContext.role === "company_admin" ? accessContext.companyId : null,
    });
    res.status(200).json({
      success: true,
      items,
    });
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
      error: "Nao foi possivel carregar os dados de referencia.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export default router;
