import { ensureCompaniesSchema, query, querySaas } from "../db.js";
import type { ReferenceDataType, ReferenceOption } from "../../shared/referenceData.js";

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
  const hasSearch = term.length > 0;
  const normalizedSelectedCodes = Array.from(new Set(selectedCodes.map((code) => code.trim()).filter(Boolean)));
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

    if (options?.allowedBranchIds && allowedBranchIds.length === 0) {
      return [];
    }

    const result = await query<{ code: string | number; nameHex: string | null; value: string | number }>(
      `
        SELECT DISTINCT ON (CAST(grid AS TEXT))
          codigo AS code,
          ENCODE(CONVERT_TO(nome, 'LATIN1'), 'hex') AS "nameHex",
          CAST(grid AS TEXT) AS value
        FROM empresa
        WHERE flag = 'A'
          AND (
            COALESCE(array_length($3::text[], 1), 0) = 0
            OR CAST(grid AS TEXT) = ANY($3::text[])
          )
          AND (
            $1 = ''
            OR CAST(codigo AS TEXT) ILIKE '%' || $1 || '%'
            OR CAST(grid AS TEXT) ILIKE '%' || $1 || '%'
            OR nome ILIKE '%' || $1 || '%'
          )
        ORDER BY CAST(grid AS TEXT), nome ASC
        LIMIT $2
      `,
      [term, hasSearch ? 50 : 100, allowedBranchIds],
    );

    return mapRows(result.rows);
  }

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
    const result = await query<{ code: number; nameHex: string; sortName: string }>(
      `
        SELECT DISTINCT
          gp.codigo AS code,
          ENCODE(CONVERT_TO(gp.nome, 'LATIN1'), 'hex') AS "nameHex",
          gp.nome AS "sortName"
        FROM grupo_produto gp
        INNER JOIN produto p
          ON CAST(p.grupo AS TEXT) = CAST(gp.grid AS TEXT)
        WHERE p.flag = 'A'
          AND ($1 = '' OR CAST(gp.codigo AS TEXT) ILIKE '%' || $1 || '%' OR gp.nome ILIKE '%' || $1 || '%')
        ORDER BY "sortName" ASC
        LIMIT $2
      `,
      [term, hasSearch ? 50 : 100],
    );

    return mapRows(result.rows);
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
        AND ($1 = '' OR CAST(codigo AS TEXT) ILIKE '%' || $1 || '%' OR nome ILIKE '%' || $1 || '%')
      ORDER BY nome ASC
      LIMIT $2
    `,
    [term, hasSearch ? 50 : 100],
  );

  return mapRows(result.rows);
}
