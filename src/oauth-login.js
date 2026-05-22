import { css, html, Wrec } from "wrec";

const b64url = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const randomBytes = (n) => {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
};

class OAuthLogin extends Wrec {
  static properties = {
    clientId: { type: String, value: "" },
    authorizeUrl: { type: String, value: "" },
    tokenUrl: { type: String, value: "" },
    userinfoUrl: { type: String, value: "" },
    redirectUri: { type: String, value: "" },
    scope: { type: String, value: "openid profile" },
    storagePrefix: { type: String, value: "oauth" },
    persist: { type: String, value: "session", values: ["session", "local"] },

    accessToken: { type: String, value: "" },
    username: { type: String, value: "" },
    loading: { type: Boolean, value: false },
    error: { type: String, value: "" },
    loggedIn: { type: Boolean, value: false },
  };

  static css = css`
    :host { display: inline-block; font-family: system-ui, sans-serif; }
    .hide { display: none; }
    .row { display: flex; align-items: center; gap: 0.5em; }
    button { padding: 0.5em 1em; cursor: pointer; }
    .error { color: #b00020; }
  `;

  static html = html`
    <div>
      <div class="this.loading ? 'row' : 'hide'">Signing in…</div>
      <div class="this.error ? 'error' : 'hide'">this.error</div>
      <div class="this.loggedIn ? 'row' : 'hide'">
        <slot name="logged-in">Hello, <span>this.username</span>!</slot>
        <button onClick="this.logout()">Log out</button>
      </div>
      <div class="this.loggedIn ? 'hide' : 'row'">
        <slot name="logged-out"><button onClick="this.login()">Log in</button></slot>
      </div>
    </div>
  `;

  ready() {
    this.addEventListener("click", this.#onLightClick.bind(this));
    this.#init();
  }

  #onLightClick(e) {
    // Events from inside the shadow DOM are retargeted to the host, so
    // e.target === this means a click on the component's own fallback content
    // (which wrec already wired). Anything else is a click on slotted light-DOM
    // content — walk up looking for a slot attribute and dispatch accordingly.
    if (e.target === this) return;
    for (let node = e.target; node && node !== this; node = node.parentNode) {
      const slot = node.getAttribute?.("slot");
      if (slot === "logged-out") { this.login(); return; }
      if (slot === "logged-in") return;
    }
  }

  async #init() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");
    const err = params.get("error");

    if (err) {
      this.#scrubUrl();
      this.#fail(params.get("error_description") || err);
      return;
    }

    if (code && state) {
      const pkceRaw = sessionStorage.getItem(this.#pkceKey);
      if (pkceRaw) {
        let pkce;
        try { pkce = JSON.parse(pkceRaw); } catch { pkce = null; }
        if (pkce && pkce.state === state) {
          await this.#handleCallback(code, pkce);
          return;
        }
      }
      // No matching pkce — likely another instance owns this callback; ignore.
    }

    this.#restore();
  }

  async #handleCallback(code, pkce) {
    this.loading = true;
    sessionStorage.removeItem(this.#pkceKey);
    this.#scrubUrl();
    try {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: pkce.verifier,
        redirect_uri: this.redirectUri,
        client_id: this.clientId,
      });
      const tokenRes = await fetch(this.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!tokenRes.ok) {
        const detail = await tokenRes.text();
        throw new Error(`token exchange failed: ${tokenRes.status} ${detail}`);
      }
      const token = await tokenRes.json();
      const accessToken = token.access_token;

      let user = null;
      if (this.userinfoUrl) {
        const infoRes = await fetch(this.userinfoUrl, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        if (!infoRes.ok) throw new Error(`userinfo failed: ${infoRes.status}`);
        user = await infoRes.json();
      }

      this.#persist(accessToken, user);
      this.batchSet({
        accessToken,
        username: user?.username || user?.name || user?.sub || "",
        loggedIn: true,
        loading: false,
        error: "",
      });
      this.dispatch("login", { user, accessToken });
    } catch (e) {
      this.#persist("", null);
      this.batchSet({ accessToken: "", username: "", loggedIn: false, loading: false });
      this.#fail(e.message || String(e), e);
    }
  }

  #restore() {
    const store = this.#store;
    const tok = store.getItem(this.#tokenKey);
    const userRaw = store.getItem(this.#userKey);
    if (!tok) return;
    let user = null;
    if (userRaw) {
      try { user = JSON.parse(userRaw); } catch { user = null; }
    }
    this.batchSet({
      accessToken: tok,
      username: user?.username || user?.name || user?.sub || "",
      loggedIn: true,
      loading: false,
      error: "",
    });
    this.dispatch("login", { user, accessToken: tok, restored: true });
  }

  async login() {
    if (!this.authorizeUrl || !this.clientId || !this.redirectUri) {
      this.#fail("oauth-login requires authorize-url, client-id, and redirect-uri attributes");
      return;
    }
    try {
      const verifier = b64url(randomBytes(32));
      const state = b64url(randomBytes(16));
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
      );
      const challenge = b64url(new Uint8Array(digest));

      sessionStorage.setItem(this.#pkceKey, JSON.stringify({ verifier, state }));

      const url = new URL(this.authorizeUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", this.clientId);
      url.searchParams.set("redirect_uri", this.redirectUri);
      url.searchParams.set("scope", this.scope);
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      location.assign(url.toString());
    } catch (e) {
      this.#fail(e.message || String(e), e);
    }
  }

  logout() {
    this.#persist("", null);
    this.batchSet({
      accessToken: "",
      username: "",
      loggedIn: false,
      error: "",
    });
    this.dispatch("logout", {});
  }

  #persist(token, user) {
    const store = this.#store;
    if (token) {
      store.setItem(this.#tokenKey, token);
      if (user) store.setItem(this.#userKey, JSON.stringify(user));
      else store.removeItem(this.#userKey);
    } else {
      store.removeItem(this.#tokenKey);
      store.removeItem(this.#userKey);
    }
  }

  #fail(message, cause) {
    this.error = message;
    this.loading = false;
    this.dispatch("error", { message, cause });
  }

  #scrubUrl() {
    const url = new URL(location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    history.replaceState({}, "", url.toString());
  }

  get #store() {
    return this.persist === "local" ? localStorage : sessionStorage;
  }
  get #tokenKey() { return `${this.storagePrefix}:token`; }
  get #userKey() { return `${this.storagePrefix}:user`; }
  get #pkceKey() { return `${this.storagePrefix}:pkce`; }
}

OAuthLogin.define("oauth-login");

export { OAuthLogin };
