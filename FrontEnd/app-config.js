// Alamat backend (tanpa garis miring di akhir).
// Lokal: server jalan di port 3000 (npm run dev).
// Saat deploy, ganti dengan alamat backend yang asli, misalnya "https://api.domainmu.com".
window.PHOTOPROOFING_API = "http://localhost:3000";

// Client ID OAuth Google untuk tombol "Masuk dengan Google" di halaman login.
// Dari Google Cloud Console: APIs & Services > Credentials > OAuth client ID > Web application.
// Kosongkan kalau belum mau mengaktifkan fitur ini - tombolnya otomatis disembunyikan,
// login pakai email/password tetap jalan seperti biasa. Nilai ini AMAN ditaruh di sini
// (bukan rahasia), beda dengan GOOGLE_API_KEY di backend yang wajib dirahasiakan.
window.PHOTOPROOFING_GOOGLE_CLIENT_ID = "827865059631-tktee5a0qtdij3nneh3j5tt19l44mjvr.apps.googleusercontent.com";