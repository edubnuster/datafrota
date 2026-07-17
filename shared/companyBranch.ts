export interface CompanyBranch {
  id: string;
  companyId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  isActive: boolean;
  isLocalBranch: boolean;
  firstDiscoveredAt: string;
  lastSeenAt: string;
  deactivatedAt: string | null;
  sourceAgentId: string | null;
  updatedAt: string;
}
