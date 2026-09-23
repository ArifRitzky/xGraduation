// Menjalankan db/schema.sql ke database (tidak perlu paste manual di SQL Editor Neon).
//   npm run db:setup  -> buat tabel yang belum ada (data aman)
//   npm run db:reset  -> HAPUS tabel lalu buat ulang dari nol (data hilang)
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { pool } = require('../db');

const reset = process.argv.includes('--reset');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

(async () => {
  try {
    if (reset) {
      const answer = await ask(
        'PERINGATAN: ini menghapus tabel admins, projects, dan selections beserta SEMUA isinya.\n' +
          'Ketik RESET (huruf besar) untuk lanjut: '
      );
      if (answer.trim() !== 'RESET') {
        console.log('Dibatalkan, tidak ada yang diubah.');
        return;
      }
      await pool.query('DROP TABLE IF EXISTS selections, projects, admins CASCADE');
      console.log('Tabel lama dihapus.');
    }

    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query(sql);

    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log('Schema siap. Tabel di database:', rows.map((r) => r.table_name).join(', '));
  } catch (err) {
    console.error('Gagal menjalankan schema:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
