import { querySaas } from "./api/db.js";
import { updatePromotion } from "./api/services/promotionService.js";
import { normalizePromotionInput, type CreatePromotionInput } from "./shared/promotion.js";

type PromotionRow = {
  id: string;
  payload: CreatePromotionInput | string;
};

function asPayload(value: PromotionRow["payload"]): CreatePromotionInput {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return normalizePromotionInput(parsed);
}

async function main(): Promise<void> {
  const result = await querySaas<PromotionRow>(
    `
      SELECT id, payload
      FROM saas_promotion
      ORDER BY updated_at DESC, created_at DESC
    `,
  );

  for (const row of result.rows) {
    const payload = asPayload(row.payload);
    const updated = await updatePromotion(row.id, payload);
    console.log(JSON.stringify({
      id: row.id,
      voucherCode: payload.voucherCode,
      updated: Boolean(updated),
      integration: updated?.integration ?? null,
    }));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
