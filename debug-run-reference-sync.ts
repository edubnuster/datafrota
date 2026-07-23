import { syncTenantReferenceSnapshot } from "./api/services/referenceSyncService.js";

const companyId = process.argv[2] || "company-1";
const agentId = process.argv[3] || "pdvagt_mrppxrw20pmhnu4b";

async function main() {
  await syncTenantReferenceSnapshot({ companyId, agentId });
  console.log(JSON.stringify({ ok: true, companyId, agentId }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
