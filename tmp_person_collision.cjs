require("dotenv").config();
const { Client } = require("pg");
(async function () {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });
  await client.connect();
  const rows = await client.query(`
    SELECT CAST(codigo AS TEXT) AS codigo, CAST(grid AS TEXT) AS grid, nome, flag
    FROM pessoa
    WHERE CAST(codigo AS TEXT) IN ('4022','4030')
       OR CAST(grid AS TEXT) IN ('4022','4030')
    ORDER BY codigo, grid
  `);
  console.log(JSON.stringify(rows.rows, null, 2));
  await client.end();
})().catch((error) => { console.error(error); process.exit(1); });
