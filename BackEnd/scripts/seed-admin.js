// Membuat akun admin pertama (password disimpan sebagai hash bcrypt, bukan teks asli).
//   npm run seed:admin
// Kalau email sudah ada, script menawarkan untuk mengganti password-nya (berguna saat lupa password).
const bcrypt = require('bcryptjs');
const readline = require('readline');
const { pool } = require('../db');
const { isEmail, cleanString, validPassword } = require('../utils/validators');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
// Saat mengetik password, karakter tidak ditampilkan (seperti sudo).
// _writeToOutput adalah fungsi internal Node; kalau suatu versi Node tidak punya, password tetap
// bisa diketik, hanya saja terlihat di layar.
if (typeof rl._writeToOutput === 'function') {
  const originalWrite = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (text) => {
    if (!muted) originalWrite(text);
  };
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      muted = false;
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = hidden; // diaktifkan setelah pertanyaan tercetak
  });
}

(async () => {
  try {
    console.log('Buat akun admin. (Saat mengetik password, layar sengaja tidak menampilkan apa pun.)\n');

    const email = (await ask('Email: ')).trim().toLowerCase();
    if (!isEmail(email)) throw new Error('Format email tidak valid.');

    const existing = await pool.query('SELECT id FROM admins WHERE email = $1', [email]);
    if (existing.rows[0]) {
      const overwrite = (await ask('Admin dengan email ini sudah ada. Ganti password-nya? (y/N): ')).trim().toLowerCase();
      if (overwrite !== 'y') {
        console.log('Dibatalkan, tidak ada yang diubah.');
        return;
      }
    }

    const name = cleanString(await ask('Nama (ditampilkan di dashboard): '), { max: 100 });
    if (!name) throw new Error('Nama wajib diisi.');

    const password = await ask('Password (minimal 8 karakter): ', { hidden: true });
    if (!validPassword(password, 8)) throw new Error('Password minimal 8 karakter (maksimal 72).');
    const confirm = await ask('Ulangi password: ', { hidden: true });
    if (confirm !== password) throw new Error('Password tidak sama.');

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO admins (email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [email, name, hash]
    );
    console.log(`\nSelesai. Admin "${email}" siap dipakai untuk login.`);
  } catch (err) {
    console.error(`\nGagal: ${err.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
    await pool.end();
  }
})();
