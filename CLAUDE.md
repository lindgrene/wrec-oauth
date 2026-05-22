# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start all three processes via `concurrently`: mock OAuth server (`:4000`), basic-demo Vite (`:5173`), router-demo Vite (`:5174`). Use this for normal local work.
- `npm run server` — just the mock auth server (nodemon-watched).
- `npm run client` — just the basic-demo Vite root (`example/`).
- `npm run client:router` — just the router-demo Vite root (`example/router/`).
- `npm test` — run the vitest suite (`test/oauth-login.test.js`) once. Uses happy-dom; covers PKCE URL construction, callback exchange (with mocked `fetch`), session restore, state-mismatch handling, and slotted-button click delegation.
- `npm run test:watch` — vitest in watch mode.

There is **no lint script and no build step.** For UI verification beyond the unit tests, run the dev servers and drive the browser — a chrome-devtools MCP server is configured in `.mcp.json` for headless verification.

## Architecture

This repo ships **one component** (`src/oauth-login.js`) and **two demos** wired against a single shared mock OAuth server.

### The `<oauth-login>` component

Implements OAuth 2.0 Authorization Code Flow + PKCE entirely in the browser. Single class extending `Wrec`, no helpers/utilities split out. The full flow lives in three private async methods: `#init` (called from `ready()` — detects callback params vs. session restore), `#handleCallback` (token exchange + userinfo + persist + dispatch), and `login()`/`logout()`.

State surface: `clientId`, `authorizeUrl`, `tokenUrl`, `userinfoUrl`, `redirectUri`, `scope`, `storagePrefix`, `persist` (config); `accessToken`, `username`, `loading`, `error`, `loggedIn` (internal reactive state). All declared in `static properties` because wrec only tracks reactivity on declared properties.

### Two demos, two Vite roots

The basic demo (`example/index.html`) and router demo (`example/router/index.html`) run as **independent Vite instances** on different ports rather than nested under one. This is intentional: nesting an SPA-routed app under a non-SPA parent breaks Vite's `index.html` fallback for unknown paths. Two roots cost very little and keep each demo's fallback boundary clean.

Both share `example/server.js`. The CORS middleware reflects the request origin from an allowlist (`:5173` + `:5174`) — **adding a new client origin means updating `ALLOWED_ORIGINS` in `server.js`**, or the browser will block `/token` and `/userinfo` calls with "Failed to fetch".

### Router demo's auth guard

The interesting integration is in `example/router/router.js`. `renderRoute` wraps `router.resolve(path)`: if the resolved route returns `requiresAuth: true` and `isLoggedIn()` is false, it stashes the requested path in `sessionStorage["auth:next"]`, `history.replaceState`s the URL to `/login?next=...`, and recursively re-renders. Routes opt into protection just by returning `requiresAuth: true` from their `action`.

`isLoggedIn()` (in `auth.js`) is a one-liner reading `sessionStorage["oauth-router:token"]` — the exact key the `<oauth-login>` instance in the app shell writes to. The guard and component are decoupled via this shared storage convention. **There is no event bus, no shared `WrecState`** — adding one would over-engineer this.

After the OAuth round-trip lands at `redirect-uri` (`http://localhost:5174/`), `app-root.js` catches the `login` event bubbling out of the single `<oauth-login>` in the nav, takes the stashed `next`, and `navigateTo`s.

## wrec specifics that matter when editing components

These aren't documented obviously in the wrec README and have already cost time in this repo:

- **Template expressions are JS evaluated via `new Function(...)`** (line 202 of `wrec-DHGadgxK.js`). Inline ternaries, optional chaining, method calls all work. Don't add complexity to avoid them.
- **Shadow DOM, mode `open`.** All component templates are inside their shadow root. Slot children live in light DOM.
- **`onClick="..."` is evaluated only on click**, never at wire-time. Safe to call mutating methods. But the attribute value must be a valid JS expression — bare method *names* fall through to a different code path that looks up `this[name]` (which is undefined for the full `"this.method()"` string), so wrec correctly treats it as an expression.
- **Slot fallback content is wired by wrec, slotted light-DOM children are not.** A consumer who passes `<button slot="logged-out">Sign in</button>` gets a button with no click handler. The pattern used in `src/oauth-login.js` is host-level click delegation in `#onLightClick`: walk up `event.target`'s parent chain looking for a `slot` attribute, fire the appropriate method. `e.target === this` distinguishes events retargeted out of shadow DOM (which wrec already handled) from genuine light-DOM clicks.
- **SSR (`OAuthLogin.ssr({...})` / `wrec/ssr`) is intentionally unsupported.** wrec's SSR evaluates `onClick` attributes at render time, which calls component methods on a non-instance proxy and throws "Receiver must be an instance of class". This is a known wrec quirk — don't try to fix it from this side. The unit tests use happy-dom, which does NOT evaluate `onClick` at render time, so the component mounts and renders cleanly there.
- **Boolean attribute reflection works on declared properties only.** If you need to render based on something, declare it in `static properties` so wrec installs the getter/setter and tracks dependencies.

## OAuth-flow invariants to preserve

- **`redirect-uri` must exactly match** the URL the page is served from (including trailing slash). Vite serves at `:5173/` and `:5174/`. The component, the auth server's stored redirect URI, and the `/token` call all compare with `===`.
- **PKCE state is stashed in `sessionStorage` under `{storagePrefix}:pkce`** — single-flight: it's read once on callback then removed. Don't move it to `localStorage` or persist after callback.
- **Order in `#handleCallback`**: persist → batchSet → dispatch. The app shell's `login` listener relies on `sessionStorage` already reflecting the new token by the time the event fires.
- **State validation gates the callback.** A mismatched `state` parameter means another instance owns the callback (or it's a CSRF attempt); the component ignores it silently. Don't relax this.

## Mock auth server caveats

`example/server.js` is a teaching mock, not a real OIDC provider. Codes and tokens live in in-memory `Map`s with TTLs (60s codes, 1h tokens) and a sweeper interval. Restart wipes everything. The `username` is the only "identity" — there's no password, no user db.

Adding new endpoints or auth flows means changes here AND likely in the component. The component is plain OAuth 2.0 + PKCE, so any spec-compliant server should drop in — but the mock cuts corners (e.g., it accepts any `client_id`, doesn't issue ID tokens).
