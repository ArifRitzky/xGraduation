const serverless = require("serverless-http");
const app = require("../../index");

const handler = serverless(app);

// netlify.toml redirect meneruskan path lengkap termasuk prefix
// "/.netlify/functions/api" (lihat netlify.toml). index.js mendaftarkan
// rute di "/api/..." dan "/health", jadi prefix itu perlu dibuang dulu
// supaya path yang diterima Express persis sama seperti di localhost.
module.exports.handler = async (event, context) => {
  event.path = event.path.replace(/^\/\.netlify\/functions\/api/, "") || "/";
  return handler(event, context);
};
