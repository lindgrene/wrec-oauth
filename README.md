# wrec-oauth

An OAuth 2.0 login web component built with [wrec](https://github.com/mvolkmann/wrec), plus a runnable demo against a local mock auth server.

The component implements the **Authorization Code flow with PKCE** — the modern recommendation for browser clients (no client secret in the browser).

## Quick start

```sh
npm install
npm run dev
```

This starts three processes:
- **Mock OAuth server** on `http://localhost:4000`
- **Basic demo** (two `<oauth-login>` instances + event log) on `http://localhost:5173`
- **Router demo** (a small SPA using [`universal-router`](https://www.npmjs.com/package/universal-router) with protected routes) on `http://localhost:5174`

Open <http://localhost:5173/> to see the component on its own, or <http://localhost:5174/> to see it integrated with client-side routing — try clicking **Profile** while signed out and watch the auth guard redirect you through the login flow and back to where you wanted to go.

For both: click **Log in**, enter any username on the mock login page, and you'll return to the demo signed in as that user.

## Using the component

```html
<script type="module" src="/path/to/oauth-login.js"></script>

<oauth-login
  client-id="my-client"
  authorize-url="https://issuer.example.com/authorize"
  token-url="https://issuer.example.com/token"
  userinfo-url="https://issuer.example.com/userinfo"
  redirect-uri="https://app.example.com/"
  scope="openid profile"></oauth-login>
```

Default behavior: shows a **Log in** button when signed out, and `Hello, {username}!` + a **Log out** button when signed in.

### Attributes

| attribute | description | default |
|---|---|---|
| `client-id` | OAuth client identifier sent to `/authorize` | — (required) |
| `authorize-url` | Authorization endpoint URL | — (required) |
| `token-url` | Token endpoint URL | — (required) |
| `userinfo-url` | UserInfo endpoint URL (optional — only used to populate `username` and the `user` event payload) | `""` |
| `redirect-uri` | The exact URL the user will be returned to after sign-in. Must match where the page is hosted, including the trailing slash. | — (required) |
| `scope` | Requested scopes | `"openid profile"` |
| `storage-prefix` | Namespace for storage keys (lets multiple instances coexist on a page) | `"oauth"` |
| `persist` | `"session"` (cleared when tab closes) or `"local"` (persists across tabs) | `"session"` |

### Slots

| slot | shown when | default content |
|---|---|---|
| `logged-in` | user is authenticated | `Hello, {username}!` |
| `logged-out` | user is not authenticated | `<button>Log in</button>` (the component still wires the click handler internally) |

```html
<oauth-login ...>
  <span slot="logged-in">Welcome back!</span>
  <button slot="logged-out">Sign in with Demo</button>
</oauth-login>
```

### Events

All events bubble and are composed.

| event | detail | when |
|---|---|---|
| `login` | `{ user, accessToken, restored? }` | after a successful token exchange, or after a stored session is restored on page load (`restored: true`) |
| `logout` | `{}` | after `logout()` is called |
| `error` | `{ message, cause? }` | on any failure (state mismatch, token exchange failure, network error, etc.) |

```js
document.querySelector("oauth-login").addEventListener("login", (e) => {
  console.log("signed in as", e.detail.user);
});
```

### Methods

- `login()` — kicks off the authorization redirect.
- `logout()` — clears stored token/user and resets state.

## How it works

1. On click of **Log in**, the component generates a PKCE `code_verifier` (32 random bytes, base64url-encoded) and a random `state`, stores both in `sessionStorage`, and redirects to the authorization endpoint with `code_challenge=SHA-256(verifier)` and `code_challenge_method=S256`.
2. The auth server redirects back to `redirect_uri` with `?code=…&state=…`.
3. On mount, the component sees the `code`/`state` in the URL. It verifies `state` matches the value it stored (if not, it ignores the callback — useful when multiple instances share a page), then POSTs `code` + `code_verifier` to the token endpoint.
4. On success it fetches the `userinfo` endpoint with the access token, stores both in `session-` or `localStorage`, scrubs `code`/`state` from the URL via `history.replaceState`, and dispatches a `login` event.
5. On reload, a stored token is restored from storage and a `login` event with `restored: true` is dispatched.

## Security notes

This demo is fine for local exploration. For production:

- **Don't trust browser storage with tokens long-term.** Modern guidance is to terminate OAuth on a backend-for-frontend (BFF) and use httpOnly cookies for session.
- This component uses **PKCE S256 only** — never falls back to `plain`.
- The `state` parameter is checked on every callback; mismatches dispatch `error` and do not exchange the code.
- The `code` and `state` are removed from the URL via `history.replaceState` immediately after the exchange begins.
- User-provided fields (e.g. `username` from `/userinfo`) are rendered via text nodes — never `innerHTML`.

## Project layout

```
.
├── src/
│   └── oauth-login.js      # the <oauth-login> component
└── example/
    ├── index.html          # basic demo (two component instances + event log)
    ├── server.js           # Express mock OAuth + PKCE server
    └── router/             # routed demo with protected routes
        ├── index.html
        ├── app-root.js     # app shell (nav, outlet, login/logout wiring)
        ├── router.js       # universal-router setup + auth guard
        ├── auth.js         # isLoggedIn() + storage helpers
        └── views/          # home, login, profile, settings, not-found
```

### Router demo: protected routes pattern

The router demo follows the [universal-router-with-wrec](https://github.com/mvolkmann/wrec/blob/main/docs/universal-router-with-wrec.md) pattern with one addition — an **auth guard** baked into `renderRoute`:

```js
// example/router/router.js
async function renderRoute(outlet, path = location.pathname + location.search) {
  const result = await router.resolve(new URL(path, location.origin).pathname);

  if (result.requiresAuth && !isLoggedIn()) {
    setNext(path);                                              // remember where we were going
    const target = "/login?next=" + encodeURIComponent(path);
    history.replaceState(null, "", target);
    return renderRoute(outlet, target);                         // re-render at /login
  }

  outlet.replaceChildren(createRouteElement(result));
}
```

Routes opt into protection by returning `requiresAuth: true` from their action:

```js
{ path: "/profile",  action: () => ({ tagName: "profile-view",  requiresAuth: true }) }
```

After the OAuth round-trip lands at `redirect-uri`, the app shell catches the `login` event bubbling out of the single `<oauth-login>` instance (mounted in the nav) and `navigateTo`s the stashed `next` path.

## Caveats / known limitations

- The mock server's `redirect_uri` is exact-match. Vite serves the example at `http://localhost:5173/` (with the trailing slash) — the attribute, the value sent to `/authorize`, and the value sent to `/token` must all match exactly.
- Web Crypto (`crypto.subtle.digest`) requires a secure context. `localhost` qualifies in every modern browser; production deployments need HTTPS.
- The mock server keeps codes and tokens in memory; restarting the server logs out all sessions.

## License

MIT
