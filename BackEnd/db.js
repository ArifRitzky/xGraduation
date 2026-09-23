require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
  console.error('[db] DATABASE_URL belum diisi di file .env');
  process.exit(1);
}

// Neon mewajibkan SSL; connection string dari Neon sudah memuat ?sslmode=require.
const pool = new Pool({ connectionString: process.env.DATABASE_URL.trim(), max: 10 });

// Neon menutup koneksi yang menganggur. Tanpa handler ini, error tersebut bisa membuat server crash.
pool.on('error', (err) => {
  console.error('[db] Koneksi idle terputus:', err.message);
});

const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
