// =========================================
// BACKEND API CALLER (used by login, dashboard, and the client page)
// Every request carries cookies (credentials: "include") so the admin login
// session and client password access are readable by the server.
// =========================================
const API_BASE = (window.PHOTOPROOFING_API || "").replace(/\/$/, "");

class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status; // 0 = server unreachable
    this.data = data;
  }
}

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // No timeout means a button could say "Processing..." forever if the server never responds.
      // 30s gives Netlify Functions room for a cold start (usually a few seconds, occasionally more).
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new ApiError(
        0,
        "The server didn't respond within 30 seconds. Make sure the backend is running (npm run dev), then try again.",
      );
    }
    throw new ApiError(
      0,
      "Couldn't reach the server. Check your internet connection and make sure the backend is running, then try again.",
    );
  }

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    // empty body or not JSON
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      (data && data.error) || "A server error occurred. Try again later.",
      data,
    );
  }
  return data;
}