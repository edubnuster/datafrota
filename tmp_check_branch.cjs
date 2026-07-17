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
  const caixa = await client.query(`SELECT conta, empresa, data, fechamento FROM caixa ORDER BY data DESC NULLS LAST LIMIT 5`);
  const empresas = await client.query(`SELECT codigo, grid, nome, flag FROM empresa WHERE flag='A' ORDER BY nome ASC LIMIT 20`);
  console.log('CAIXA', JSON.stringify(caixa.rows, null, 2));
  console.log('EMPRESA', JSON.stringify(empresas.rows, null, 2));
  await client.end();
})().catch((error) => { console.error(error); process.exit(1); });
