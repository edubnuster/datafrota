import { query } from "../db.js";
import type { ReferenceDataType, ReferenceOption } from "../../shared/referenceData.js";

function normalizeTerm(term: string): string {
  return term.trim();
}

function mapRows(
  rows: Array<{ code: string | number; name: string | null; value?: string | number | null }>,
): ReferenceOption[] {
  return rows
    .filter((row) => row.name)
    .map((row) => ({
      code: String(row.code),
      name: String(row.name).trim(),
      value: row.value === null || row.value === undefined ? undefined : String(row.value),
    }));
}

export async function listReferenceData(
  type: ReferenceDataType,
  search = "",
): Promise<ReferenceOption[]> {
  const term = normalizeTerm(search);
  const hasSearch = term.length > 0;

  if (type === "products") {
    const result = await query<{ code: string; name: string; value: string }>(
      `
        SELECT
          codigo AS code,
          nome AS name,
          CAST(grid AS TEXT) AS value
        FROM produto
        WHERE flag = 'A'
          AND (
            $1 = ''
            OR codigo ILIKE '%' || $1 || '%'
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

  if (type === "product-groups") {
    const result = await query<{ code: number; name: string }>(
      `
        SELECT DISTINCT
          gp.codigo AS code,
          gp.nome AS name
        FROM grupo_produto gp
        INNER JOIN produto p
          ON CAST(p.grupo AS TEXT) = CAST(gp.grid AS TEXT)
        WHERE p.flag = 'A'
          AND ($1 = '' OR CAST(gp.codigo AS TEXT) ILIKE '%' || $1 || '%' OR gp.nome ILIKE '%' || $1 || '%')
        ORDER BY name ASC
        LIMIT $2
      `,
      [term, hasSearch ? 50 : 100],
    );

    return mapRows(result.rows);
  }

  if (type === "customers") {
    const result = await query<{ code: string; name: string; value: string }>(
      `
        SELECT
          CAST(codigo AS TEXT) AS code,
          nome AS name,
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
    const result = await query<{ code: number; name: string; value: string }>(
      `
        SELECT
          codigo AS code,
          nome AS name,
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

  const result = await query<{ code: number; name: string }>(
    `
      SELECT
        codigo AS code,
        nome AS name
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
