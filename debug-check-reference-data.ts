import { listReferenceData } from "./api/services/referenceDataService.js";

async function main() {
  const companyId = process.argv[2] || "company-1";
  const types = ["products", "product-groups", "customers", "customer-groups", "payment-forms"] as const;

  for (const type of types) {
    const items = await listReferenceData(type, "", [], { companyId, allowedBranchIds: null });
    console.log(JSON.stringify({ type, total: items.length, first: items[0] ?? null }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
