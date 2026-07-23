import { Client } from "pg";

const client = new Client({
  host: "localhost",
  port: 5432,
  database: "datafrota",
  user: "postgres",
  password: "postgres",
});

async function main() {
  await client.connect();

  const snapshotState = await client.query(`
    SELECT
      company_id,
      published_version,
      sync_status,
      last_started_at,
      last_finished_at,
      last_agent_id,
      LEFT(COALESCE(last_error, ''), 200) AS last_error
    FROM tenant_reference_snapshot_state
    ORDER BY updated_at DESC
    LIMIT 20
  `);

  const snapshotItems = await client.query(`
    SELECT
      company_id,
      reference_type,
      snapshot_version,
      COUNT(*)::int AS total
    FROM tenant_reference_snapshot_item
    GROUP BY company_id, reference_type, snapshot_version
    ORDER BY snapshot_version DESC, company_id, reference_type
    LIMIT 50
  `);

  const agents = await client.query(`
    SELECT
      id,
      company_id,
      branch_id,
      station_code,
      status,
      paired_at,
      last_seen_at
    FROM pdv_agent
    ORDER BY updated_at DESC
    LIMIT 20
  `);

  console.log(JSON.stringify({ snapshotState: snapshotState.rows, snapshotItems: snapshotItems.rows, agents: agents.rows }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => undefined);
  });
