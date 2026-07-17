import { Router, type Request, type Response } from "express";
import {
  CompanyValidationError,
  createCompany,
  deleteCompany,
  listCompanies,
  updateCompany,
} from "../services/companyService.js";
import type { CreateCompanyInput } from "../../shared/company.js";

const router = Router();

router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const items = await listCompanies();
    res.status(200).json({ success: true, items });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Nao foi possivel listar as empresas.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const created = await createCompany(req.body as CreateCompanyInput);
    res.status(201).json({ success: true, item: created });
  } catch (error) {
    if (error instanceof CompanyValidationError) {
      res.status(400).json({
        success: false,
        error: "Dados invalidos para cadastrar a empresa.",
        issues: error.issues,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel cadastrar a empresa.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.put("/:companyId", async (req: Request, res: Response): Promise<void> => {
  try {
    const updated = await updateCompany(req.params.companyId, req.body as CreateCompanyInput);

    if (!updated) {
      res.status(404).json({
        success: false,
        error: "Empresa nao encontrada para atualizacao.",
      });
      return;
    }

    res.status(200).json({ success: true, item: updated });
  } catch (error) {
    if (error instanceof CompanyValidationError) {
      res.status(400).json({
        success: false,
        error: "Dados invalidos para atualizar a empresa.",
        issues: error.issues,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel atualizar a empresa.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.delete("/:companyId", async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await deleteCompany(req.params.companyId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: "Empresa nao encontrada para exclusao.",
      });
      return;
    }

    res.status(200).json({ success: true, item: deleted });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Nao foi possivel excluir a empresa.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export default router;
