import express from "express";
import crypto from "node:crypto";

const PORT = 4000;
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
]);

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }
  res.setHeader("access-control-allow-headers", "authorization, content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const codes = new Map();   // code -> { username, challenge, redirectUri, expiresAt }
const tokens = new Map();  // token -> { username, expiresAt }

const now = () => Date.now();
const minutes = (n) => n * 60_000;

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = (s) => b64url(crypto.createHash("sha256").update(s, "utf8").digest());

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

function renderLoginPage({ clientId, redirectUri, state, codeChallenge, codeChallengeMethod, scope, responseType }) {
  const hidden = (name, value) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>Mock OAuth — Sign in</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; }
    label { display: block; margin: 1rem 0 0.25rem; }
    input[type=text] { width: 100%; padding: 0.5em; font-size: 1rem; box-sizing: border-box; }
    button { margin-top: 1rem; padding: 0.5em 1em; font-size: 1rem; cursor: pointer; }
    .meta { color: #666; font-size: 0.875rem; margin-top: 2rem; line-height: 1.5; }
    code { background: #f4f4f4; padding: 0.1em 0.3em; border-radius: 3px; }
  </style>
</head><body>
  <h1>Mock OAuth — Sign in</h1>
  <p>Enter any username to sign in. No password — this is a demo server.</p>
  <form method="POST" action="/authorize">
    <label for="username">Username</label>
    <input id="username" name="username" type="text" required autofocus value="alice">
    ${hidden("client_id", clientId)}
    ${hidden("redirect_uri", redirectUri)}
    ${hidden("state", state)}
    ${hidden("code_challenge", codeChallenge)}
    ${hidden("code_challenge_method", codeChallengeMethod)}
    ${hidden("scope", scope)}
    ${hidden("response_type", responseType)}
    <button type="submit">Sign in</button>
  </form>
  <p class="meta">
    Client: <code>${escapeHtml(clientId)}</code><br>
    Redirect: <code>${escapeHtml(redirectUri)}</code><br>
    Scope: <code>${escapeHtml(scope)}</code>
  </p>
</body></html>`;
}

app.get("/authorize", (req, res) => {
  const q = req.query;
  if (q.response_type !== "code") {
    return res.status(400).send("only response_type=code is supported");
  }
  if (q.code_challenge_method !== "S256") {
    return res.status(400).send("only code_challenge_method=S256 is supported");
  }
  if (!q.client_id || !q.redirect_uri || !q.code_challenge || !q.state) {
    return res.status(400).send("missing required parameters");
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(renderLoginPage({
    clientId: q.client_id,
    redirectUri: q.redirect_uri,
    state: q.state,
    codeChallenge: q.code_challenge,
    codeChallengeMethod: q.code_challenge_method,
    scope: q.scope || "",
    responseType: q.response_type,
  }));
});

app.post("/authorize", (req, res) => {
  const { username, redirect_uri, state, code_challenge } = req.body;
  if (!username?.trim() || !redirect_uri || !state || !code_challenge) {
    return res.status(400).send("invalid form submission");
  }
  const code = b64url(crypto.randomBytes(24));
  codes.set(code, {
    username: username.trim(),
    challenge: code_challenge,
    redirectUri: redirect_uri,
    expiresAt: now() + minutes(1),
  });
  const target = new URL(redirect_uri);
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);
  res.redirect(302, target.toString());
});

app.post("/token", (req, res) => {
  const { grant_type, code, code_verifier, redirect_uri } = req.body;
  if (grant_type !== "authorization_code") {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }
  if (!code || !code_verifier || !redirect_uri) {
    return res.status(400).json({ error: "invalid_request" });
  }
  const entry = codes.get(code);
  if (!entry) {
    return res.status(400).json({ error: "invalid_grant", error_description: "unknown code" });
  }
  codes.delete(code); // one-time use
  if (entry.expiresAt < now()) {
    return res.status(400).json({ error: "invalid_grant", error_description: "code expired" });
  }
  if (entry.redirectUri !== redirect_uri) {
    return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
  }
  const computedChallenge = sha256(code_verifier);
  const a = Buffer.from(computedChallenge);
  const b = Buffer.from(entry.challenge);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ error: "invalid_grant", error_description: "pkce verification failed" });
  }

  const accessToken = b64url(crypto.randomBytes(32));
  tokens.set(accessToken, {
    username: entry.username,
    expiresAt: now() + minutes(60),
  });
  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
  });
});

app.get("/userinfo", (req, res) => {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "missing_bearer" });
  const token = tokens.get(m[1]);
  if (!token) return res.status(401).json({ error: "invalid_token" });
  if (token.expiresAt < now()) {
    tokens.delete(m[1]);
    return res.status(401).json({ error: "expired_token" });
  }
  res.json({ username: token.username });
});

setInterval(() => {
  const t = now();
  for (const [k, v] of codes) if (v.expiresAt < t) codes.delete(k);
  for (const [k, v] of tokens) if (v.expiresAt < t) tokens.delete(k);
}, 60_000).unref();

app.listen(PORT, () => {
  console.log(`mock oauth server listening on http://localhost:${PORT}`);
  console.log(`allowing client origins: ${[...ALLOWED_ORIGINS].join(", ")}`);
});
