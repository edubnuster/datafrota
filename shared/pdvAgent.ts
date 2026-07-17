export const PDV_AGENT_STATUS_VALUES = ["active", "revoked"] as const;
export const PDV_PAIRING_STATUS_VALUES = ["pending", "used", "expired", "cancelled"] as const;

export type PdvAgentStatus = (typeof PDV_AGENT_STATUS_VALUES)[number];
export type PdvPairingStatus = (typeof PDV_PAIRING_STATUS_VALUES)[number];

export interface PdvAgent {
  id: string;
  companyId: string;
  branchId: string | null;
  stationCode: string | null;
  deviceName: string | null;
  deviceFingerprint: string | null;
  installedVersion: string | null;
  status: PdvAgentStatus;
  pairedAt: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface PdvPairingToken {
  id: string;
  companyId: string;
  branchId: string | null;
  stationCode: string | null;
  description: string | null;
  tokenCode: string;
  status: PdvPairingStatus;
  expiresAt: string;
  usedAt: string | null;
  usedByAgentId: string | null;
  createdAt: string;
}

export interface CreatePdvPairingTokenInput {
  branchId?: string | null;
  stationCode?: string | null;
  description?: string | null;
  expiresInMinutes?: number | null;
}

export interface ActivatePdvAgentInput {
  pairingCode: string;
  stationCode?: string | null;
  deviceName?: string | null;
  deviceFingerprint?: string | null;
  installedVersion?: string | null;
}

export interface ActivatePdvAgentResult {
  agent: PdvAgent;
  apiToken: string;
}
