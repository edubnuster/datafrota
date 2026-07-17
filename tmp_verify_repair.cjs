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
  const promo = await client.query(`SELECT payload FROM saas.saas_promotion WHERE voucher_code = $1 LIMIT 1`, ['DKDMN']);
  const auth = await client.query(`SELECT customer_codes, payment_form_codes, branch_ids FROM discount_authorization WHERE short_code = $1 LIMIT 1`, ['DKDMN']);
  console.log('PROMO', JSON.stringify(promo.rows[0] ?? null, null, 2));
  console.log('AUTH', JSON.stringify(auth.rows[0] ?? null, null, 2));
  await client.end();
})().catch((error) => { console.error(error); process.exit(1); });
