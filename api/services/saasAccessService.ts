import type { Request } from "express";
import { canonicalizeBranchIds, getCompanyById } from "./companyService.js";

export type SaasAccessContext =
  | {
      role: "saas_admin";
      companyId: null;
      allowedBranchIds: null;
    }
  | {
      role: "company_admin";
      companyId: string;
      allowedBranchIds: string[];
    };

export class SaasAccessError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 401,
  ) {
    super(message);
    this.name = "SaasAccessError";
  }
}

function getHeaderValue(req: Request, name: string): string {
  return String(req.header(name) || "").trim();
}

export async function resolveSaasAccessContext(req: Request): Promise<SaasAccessContext> {
  const role = getHeaderValue(req, "x-saas-role");

  if (role === "saas_admin") {
    return {
      role: "saas_admin",
      companyId: null,
      allowedBranchIds: null,
    };
  }

  if (role !== "company_admin") {
    throw new SaasAccessError("Sessao invalida para acessar os dados da empresa logada.", 401);
  }

  const companyId = getHeaderValue(req, "x-saas-company-id");
  if (!companyId) {
    throw new SaasAccessError("Nao foi possivel identificar a empresa da sessao atual.", 401);
  }

  const company = await getCompanyById(companyId);
  if (!company) {
    throw new SaasAccessError("A empresa da sessao atual nao foi encontrada.", 404);
  }

  const allowedBranchIds = await canonicalizeBranchIds(company.selectedBranchIds);

  return {
    role: "company_admin",
    companyId: company.id,
    allowedBranchIds,
  };
}
