// Server Google Drive TIRUAN untuk tes otomatis. Meniru bentuk respons Drive API v3,
// tapi bukan Google sungguhan: perilaku asli Drive tetap harus dites dengan folder betul.
const http = require('node:http');

async function startMockDrive() {
  const state = { requests: [], handler: () => ({ status: 500, body: {} }) };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    const record = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
    };
    state.requests.push(record);
    const reply = state.handler(record);
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.baseUrl = `http://127.0.0.1:${server.address().port}/drive/v3`;
  state.close = () => new Promise((resolve) => server.close(resolve));
  state.reset = () => {
    state.requests.length = 0;
    state.handler = () => ({ status: 500, body: {} });
  };
  return state;
}

// Bentuk error seperti yang dikirim Google.
const googleError = (status, message, reason) => ({
  status,
  body: { error: { code: status, message, errors: [{ reason }] } },
});

const file = (name, extra = {}) => ({
  id: `id-${name}`,
  name,
  mimeType: 'image/jpeg',
  thumbnailLink: `https://lh3.googleusercontent.com/drive-storage/${name}=s220`,
  imageMediaMetadata: { width: 4000, height: 6000 },
  ...extra,
});

module.exports = { startMockDrive, googleError, file };
