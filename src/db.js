import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '6543'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

export const db = {
  async query(sql, args = []) {
    const result = await pool.query(sql, args);
    return { rows: result.rows || [] };
  }
};

export default pool;