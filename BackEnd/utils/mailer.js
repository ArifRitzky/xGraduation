// utils/mailer.js
// Pengirim email untuk verifikasi email & lupa password.
// Sengaja tidak wajib dikonfigurasi (sama seperti GOOGLE_API_KEY / GOOGLE_CLIENT_ID):
// kalau SMTP_HOST kosong (mis. saat development di localhost), email tidak benar-benar
// dikirim - isinya dicetak ke console supaya link verifikasi/reset tetap bisa dites manual.
const nodemailer = require("nodemailer");
const path = require("path");
const config = require("../config");

let transporter = null;
if (config.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465, // 465 = TLS langsung, 587/25 = STARTTLS
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.pass }
      : undefined,
  });
}

const BRAND_NAME = "xGraduation";
// Dikirim sebagai lampiran ber-cid (bukan link gambar dari internet), supaya logo tetap
// tampil walau klien email penerima memblokir gambar eksternal by default.
const LOGO_PATH = path.join(__dirname, "..", "assets", "email-logo.png");
const LOGO_CID = "brand-logo";

// ---------------------------------------------------------------------
// Template HTML sederhana (tabel + inline CSS, bukan file terpisah) supaya
// tetap tampil rapi di klien email lama yang tidak mendukung CSS eksternal
// (Outlook, dsb.). "text" versi polos tetap dikirim berdampingan (multipart)
// untuk klien email yang mematikan tampilan HTML.
// ---------------------------------------------------------------------
function emailLayout({ heading, bodyHtml }) {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background:#ffffff;padding:24px 32px;border-bottom:1px solid #e5e7eb;">
                <img src="cid:${LOGO_CID}" alt="${BRAND_NAME}" height="26" style="display:block;height:26px;width:auto;">
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#111827;">${heading}</h1>
                <div style="font-size:15px;line-height:1.6;color:#374151;">${bodyHtml}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f9fafb;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;">
                Email otomatis dari ${BRAND_NAME} Client Photo Proofing - mohon tidak membalas email ini.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function actionButton(link, label) {
  return `<p style="text-align:center;margin:28px 0;">
    <a href="${link}" style="background:#111827;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;display:inline-block;">${label}</a>
  </p>
  <p style="font-size:13px;color:#6b7280;word-break:break-all;margin:0;">Atau salin link ini ke browser:<br>
    <a href="${link}" style="color:#2563eb;">${link}</a>
  </p>`;
}

// text sederhana (bukan HTML) sebagai fallback - dikirim berdampingan dengan HTML,
// dan dipakai apa adanya saat SMTP belum diisi (dicetak ke console untuk dites manual).
async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    console.warn(
      "[mailer] SMTP_HOST belum diisi di .env - email TIDAK benar-benar dikirim. Isi pesan:\n" +
        `  Kepada : ${to}\n  Subjek : ${subject}\n  Isi    :\n${text
          .split("\n")
          .map((line) => "    " + line)
          .join("\n")}`,
    );
    return { sent: false };
  }

  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject,
      text,
      html,
      attachments: html
        ? [{ filename: "logo.png", path: LOGO_PATH, cid: LOGO_CID }]
        : undefined,
    });
    return { sent: true };
  } catch (err) {
    // Kegagalan kirim email tidak boleh membuat request API gagal total (mis. saat
    // register) - pemanggil memutuskan sendiri apakah ini fatal atau cukup dicatat.
    console.error("[mailer] Gagal mengirim email:", err.message);
    return { sent: false, error: err.message };
  }
}

function sendVerifyEmail(to, link) {
  return sendMail({
    to,
    subject: `Aktivasi akun - ${BRAND_NAME} Client Photo Proofing`,
    text:
      `Halo,\n\nKlik link berikut untuk mengaktifkan akunmu:\n${link}\n\n` +
      `Link ini berlaku selama 24 jam. Kalau kamu tidak merasa mendaftar, abaikan saja email ini.`,
    html: emailLayout({
      heading: "Aktifkan akunmu",
      bodyHtml:
        `<p style="margin:0 0 8px;">Halo,</p>` +
        `<p style="margin:0;">Terima kasih sudah mendaftar. Klik tombol di bawah ini untuk mengaktifkan akunmu sebelum bisa login:</p>` +
        actionButton(link, "Aktifkan Akun") +
        `<p style="margin:16px 0 0;color:#6b7280;font-size:13px;">Link ini berlaku selama 24 jam. Kalau kamu tidak merasa mendaftar, abaikan saja email ini.</p>`,
    }),
  });
}

function sendResetPasswordEmail(to, link) {
  return sendMail({
    to,
    subject: `Reset password - ${BRAND_NAME} Client Photo Proofing`,
    text:
      `Halo,\n\nAda permintaan untuk mengatur ulang password akunmu. Klik link berikut:\n${link}\n\n` +
      `Link ini berlaku selama 30 menit dan hanya bisa dipakai sekali. Kalau kamu tidak meminta ini, ` +
      `abaikan saja email ini - password kamu tidak akan berubah.`,
    html: emailLayout({
      heading: "Atur ulang password",
      bodyHtml:
        `<p style="margin:0 0 8px;">Halo,</p>` +
        `<p style="margin:0;">Ada permintaan untuk mengatur ulang password akunmu. Klik tombol di bawah:</p>` +
        actionButton(link, "Atur Ulang Password") +
        `<p style="margin:16px 0 0;color:#6b7280;font-size:13px;">Link ini berlaku 30 menit dan hanya bisa dipakai sekali. Kalau kamu tidak meminta ini, abaikan saja email ini - password kamu tidak akan berubah.</p>`,
    }),
  });
}

function sendGoogleOnlyNotice(to) {
  return sendMail({
    to,
    subject: `Reset password - ${BRAND_NAME} Client Photo Proofing`,
    text:
      `Halo,\n\nAda permintaan reset password untuk akun ini, tapi akun ini masuk lewat "Masuk dengan Google" ` +
      `dan tidak punya password. Gunakan tombol "Masuk dengan Google" di halaman login.\n\n` +
      `Kalau ini bukan kamu, abaikan saja email ini.`,
    html: emailLayout({
      heading: "Akun ini masuk lewat Google",
      bodyHtml:
        `<p style="margin:0 0 8px;">Halo,</p>` +
        `<p style="margin:0;">Ada permintaan reset password untuk akun ini, tapi akun ini masuk lewat "Masuk dengan Google" dan tidak punya password. Gunakan tombol "Masuk dengan Google" di halaman login sebagai gantinya.</p>` +
        `<p style="margin:16px 0 0;color:#6b7280;font-size:13px;">Kalau ini bukan kamu, abaikan saja email ini.</p>`,
    }),
  });
}

module.exports = {
  sendMail,
  sendVerifyEmail,
  sendResetPasswordEmail,
  sendGoogleOnlyNotice,
};