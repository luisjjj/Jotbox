import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 1,
});

try {
  const result = await pool.query(
    `delete from users
      where email like 'test.%' or email like 'ui.test.%' or email like 'api.test.%'
      returning email`,
  );
  console.log("removed", result.rowCount, result.rows.map((row) => row.email).join(", "));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
