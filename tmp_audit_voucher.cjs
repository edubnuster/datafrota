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
  const auth = await client.query(`
    SELECT id, short_code, product_codes, product_code, customer_codes, customer_code,
           customer_group_codes, payment_form_codes, payment_form_code,
           branch_ids, active_weekdays, valid_from, valid_until, created_at
    FROM discount_authorization
    WHERE short_code = $1
    LIMIT 1
  `, ['DKDMN']);
  console.log(JSON.stringify(auth.rows[0] ?? null, null, 2));
  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
