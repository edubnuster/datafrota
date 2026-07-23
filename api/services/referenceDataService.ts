import { ensureCompaniesSchema, query, querySaas } from "../db.js";
import type { ReferenceDataType, ReferenceOption } from "../../shared/referenceData.js";
import { listTenantReferenceData } from "./referenceSyncService.js";

function normalizeTerm(term: string): string {
  return term.trim();
}

function decodeLegacyText(hexValue: string): string {
  return Buffer.from(hexValue, "hex").toString("latin1").trim();
}

function mapRows(
  rows: Array<{ code: string | number; nameHex: string | null; value?: string | number | null }>,
): ReferenceOption[] {
  return rows
    .filter((row) => row.nameHex)
    .map((row) => ({
      code: String(row.code),
      name: decodeLegacyText(String(row.nameHex)),
      value: row.value === null || row.value === undefined ? undefined : String(row.value),
    }));
}

function filterReferenceOptions(
  items: ReferenceOption[],
  term: string,
  selectedCodes: string[],
  limit: number,
): ReferenceOption[] {
  const normalizedTerm = term.trim().toLowerCase();
  const selectedSet = new Set(selectedCodes);

  return items
    .filter((item) => {
      if (selectedSet.has(item.code)) {
        return true;
      }

      if (!normalizedTerm) {
        return true;
      }

      return (
        item.code.toLowerCase().includes(normalizedTerm) ||
        item.name.toLowerCase().includes(normalizedTerm) ||
        String(item.value ?? "")
          .toLowerCase()
          .includes(normalizedTerm)
      );
    })
    .sort((left, right) => {
      const selectedDelta = Number(selectedSet.has(right.code)) - Number(selectedSet.has(left.code));
      if (selectedDelta !== 0) {
        return selectedDelta;
      }

      const nameDelta = left.name.localeCompare(right.name, "pt-BR");
      if (nameDelta !== 0) {
        return nameDelta;
      }

      return left.code.localeCompare(right.code, "pt-BR", { numeric: true });
    })
    .slice(0, limit + selectedSet.size);
}

async function hasPublishedReferenceSnapshot(companyId: string): Promise<boolean> {
  const result = await querySaas<{ published_version: number }>(
    `
      SELECT published_version
      FROM tenant_reference_snapshot_state
      WHERE company_id = $1
      LIMIT 1
    `,
    [companyId],
  );

  return Number(result.rows[0]?.published_version ?? 0) > 0;
}

async function listLegacyReferenceData(
  type: Exclude<ReferenceDataType, "branches">,
  term: string,
  normalizedSelectedCodes: string[],
  hasSearch: boolean,
): Promise<ReferenceOption[]> {
  if (type === "products") {
    const result = await query<{ code: string; nameHex: string; value: string }>(
      `
        SELECT
          codigo AS code,
          ENCODE(CONVERT_TO(nome, 'LATIN1'), 'hex') AS "nameHex",
          CAST(grid AS TEXT) AS value
        FROM produto
        WHERE flag = 'A'
          AND (
            $1 = ''
            OR codigo ILIKE '%' || $1 || '%'
            OR CAST(grid AS TEXT) ILIKE '%' || $1 || '%'
            OR nome ILIKE '%' || $1 || '%'
            OR CAST(grid AS TEXT) = ANY($2)
          )
        ORDER BY
          CASE WHEN CAST(grid AS TEXT) = ANY($2) THEN 0 ELSE 1 END,
          nome ASC
        LIMIT ($3 + COALESCE(array_length($2, 1), 0))
      `,
      [term, normalizedSelectedCodes, hasSearch ? 30 : 20],
    );

    return mapRows(result.rows);
  }

  if (type === "product-groups") {
    const result = await query<{ code: number }>(
      `
        SELECT DISTINCT
          gp.codigo AS code
        FROM grupo_produto gp
        INNER JOIN produto p
          ON CAST(p.grupo AS TEXT) = CAST(gp.grid AS TEXT)
        WHERE p.flag = 'A'
        ORDER BY gp.codigo ASC
      `,
    );

    const items: ReferenceOption[] = [];

    for (const row of result.rows) {
      try {
        const groupResult = await query<{ name: string }>(
          `
            SELECT nome AS name
            FROM grupo_produto
            WHERE codigo = $1
            ORDER BY grid DESC
            LIMIT 1
          `,
          [row.code],
        );
        const name = String(groupResult.rows[0]?.name || "").trim();

        if (!name) {
          continue;
        }

        items.push({
          code: String(row.code),
          name,
        });
      } catch {
        // Ignora linhas legadas com encoding invalido sem quebrar a tela.
      }
    }

    return filterReferenceOptions(items, term, normalizedSelectedCodes, hasSearch ? 50 : 100);
  }

  if (type === "customers") {
    const result = await query<{ code: string; nameHex: string; value: string }>(
      `
        SELECT
          CAST(codigo AS TEXT) AS code,
          ENCODE(CONVERT_TO(nome, 'LATIN1'), 'hex') AS "nameHex",
          CAST(grid AS TEXT) AS value
        FROM pessoa
        WHERE flag = 'A'
          AND nome IS NOT NULL
          AND (
            $1 = ''
            OR CAST(codigo AS TEXT) ILIKE '%' || $1 || '%'
            OR CAST(grid AS TEXT) ILIKE '%' || $1 || '%'
            OR nome ILIKE '%' || $1 || '%'
          )
        ORDER BY nome ASC
        LIMIT $2
      `,
      [term, hasSearch ? 30 : 20],
    );

    return mapRows(result.rows);
  }

  if (type === "payment-forms") {
    const result = await query<{ code: number; nameHex: string; value: string }>(
      `
        SELECT
          codigo AS code,
          ENCODE(CONVERT_TO(nome, 'LATIN1'), 'hex') AS "nameHex",
          CAST(grid AS TEXT) AS value
        FROM forma_pgto
        WHERE flag = 'A'
          AND (
            $1 = ''
            OR CAST(codigo AS TEXT) ILIKE '%' || $1 || '%'
            OR CAST(grid AS TEXT) ILIKE '%' || $1 || '%'
            OR nome ILIKE '%' || $1 || '%'
          )
        ORDER BY nome ASC
        LIMIT $2
      `,
      [term, hasSearch ? 50 : 100],
    );

    return mapRows(result.rows);
  }

  const result = await query<{ code: number; nameHex: string }>(
    `
      SELECT
        codigo AS code,
        ENCODE(CONVERT_TO(nome, 'LATIN1'), 'hex') AS "nameHex"
      FROM grupo_pessoa
      WHERE flag = 'A'
        AND (
          $1 = ''
          OR CAST(codigo AS TEXT) ILIKE '%' || $1 || '%'
          OR nome ILIKE '%' || $1 || '%'
          OR CAST(codigo AS TEXT) = ANY($2)
        )
      ORDER BY
        CASE WHEN CAST(codigo AS TEXT) = ANY($2) THEN 0 ELSE 1 END,
        nome ASC
      LIMIT ($3 + COALESCE(array_length($2, 1), 0))
    `,
    [term, normalizedSelectedCodes, hasSearch ? 50 : 100],
  );

  return mapRows(result.rows);
}

export async function listReferenceData(
  type: ReferenceDataType,
  search = "",
  selectedCodes: string[] = [],
  options?: {
    allowedBranchIds?: string[] | null;
    companyId?: string | null;
  },
): Promise<ReferenceOption[]> {
  const term = normalizeTerm(search);
  const normalizedSelectedCodes = Array.from(new Set(selectedCodes.map((code) => code.trim()).filter(Boolean)));
  const hasSearch = term.length > 0;
  const allowedBranchIds = Array.from(new Set((options?.allowedBranchIds ?? []).map((code) => code.trim()).filter(Boolean)));

  if (type === "branches") {
    if (options?.companyId) {
      await ensureCompaniesSchema();
      const result = await querySaas<{ code: string; name: string; value: string }>(
        `
          SELECT
            branch_code AS code,
            branch_name AS name,
            branch_id AS value
          FROM saas_company_branch
          WHERE company_id = $1
            AND is_active = TRUE
            AND (
              $2 = ''
              OR branch_code ILIKE '%' || $2 || '%'
              OR branch_id ILIKE '%' || $2 || '%'
              OR branch_name ILIKE '%' || $2 || '%'
              OR branch_id = ANY($4::text[])
            )
            AND (
              COALESCE(array_length($3::text[], 1), 0) = 0
              OR branch_id = ANY($3::text[])
            )
          ORDER BY branch_name ASC, branch_id ASC
          LIMIT ($5 + COALESCE(array_length($4::text[], 1), 0))
        `,
        [
          options.companyId,
          term,
          allowedBranchIds,
          normalizedSelectedCodes,
          hasSearch ? 50 : 100,
        ],
      );

      return result.rows.map((row) => ({
        code: row.code,
        name: row.name,
        value: row.value,
      }));
    }

    return [];
  }

  if (!options?.companyId) {
    return [];
  }

  void allowedBranchIds;

  if (!(await hasPublishedReferenceSnapshot(options.companyId))) {
    return listLegacyReferenceData(type, term, normalizedSelectedCodes, hasSearch);
  }

  return listTenantReferenceData(options.companyId, type, term, normalizedSelectedCodes);
}
