import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "../src/oauth-login.js";

const PREFIX = "test-oauth";
const REDIRECT = "http://localhost:5173/";

function makeEl({
  storagePrefix = PREFIX,
  redirect = REDIRECT,
  slots = "",
} = {}) {
  const el = document.createElement("oauth-login");
  el.setAttribute("client-id", "demo");
  el.setAttribute("authorize-url", "http://auth.test/authorize");
  el.setAttribute("token-url", "http://auth.test/token");
  el.setAttribute("userinfo-url", "http://auth.test/userinfo");
  el.setAttribute("redirect-uri", redirect);
  el.setAttribute("scope", "openid profile");
  el.setAttribute("storage-prefix", storagePrefix);
  if (slots) el.innerHTML = slots;
  return el;
}

async function mount(el) {
  document.body.appendChild(el);
  // wrec's connectedCallback is async (await #p() then ready()).
  // Wait two microtasks for the DOM to be built and ready() to run.
  await Promise.resolve();
  await Promise.resolve();
  // Plus a macrotask, since async #init kicks off after ready() returns.
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

function waitForEvent(el, name, timeout = 500) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${name}"`)), timeout);
    el.addEventListener(
      name,
      (e) => {
        clearTimeout(t);
        resolve(e);
      },
      { once: true },
    );
  });
}

function setUrl(url) {
  window.happyDOM.setURL(url);
}

let assignSpy;

beforeAll(() => {
  // Capture location.assign attempts instead of letting happy-dom navigate.
  Object.defineProperty(window.location, "assign", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  assignSpy = window.location.assign;
});

beforeEach(() => {
  sessionStorage.clear();
  if (typeof localStorage !== "undefined") localStorage.clear();
  setUrl("http://localhost:5173/");
  assignSpy.mockClear();
  // Default fetch mock — individual tests override.
  globalThis.fetch = vi.fn(() => {
    throw new Error("fetch not mocked for this test");
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------- Tests ----------

describe("<oauth-login> default render", () => {
  it("shows the Log in button when signed out", async () => {
    const el = await mount(makeEl());
    expect(el.loggedIn).toBe(false);
    // Both default-slot buttons exist in shadow DOM; visibility is controlled by class toggling.
    const buttons = Array.from(el.shadowRoot.querySelectorAll("button"));
    const labels = buttons.map((b) => b.textContent.trim());
    expect(labels).toContain("Log in");
    expect(labels).toContain("Log out");
    // The logged-out branch's wrapper div is shown (class "row"), the logged-in wrapper is hidden.
    const wrappers = Array.from(el.shadowRoot.querySelectorAll("div > div"));
    const classes = wrappers.map((w) => w.getAttribute("class"));
    expect(classes).toContain("row");
    expect(classes).toContain("hide");
  });
});

describe("login()", () => {
  it("builds the authorize URL with PKCE S256 + stashes verifier and state", async () => {
    const el = await mount(makeEl());

    await el.login();

    // Verifies location.assign was called with an /authorize URL.
    expect(assignSpy).toHaveBeenCalledTimes(1);
    const target = new URL(assignSpy.mock.calls[0][0]);
    expect(target.origin + target.pathname).toBe("http://auth.test/authorize");
    expect(target.searchParams.get("response_type")).toBe("code");
    expect(target.searchParams.get("client_id")).toBe("demo");
    expect(target.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(target.searchParams.get("scope")).toBe("openid profile");
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(target.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]+$/);

    // sessionStorage holds the verifier + state under {prefix}:pkce
    const pkce = JSON.parse(sessionStorage.getItem(`${PREFIX}:pkce`));
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.state).toBe(target.searchParams.get("state"));

    // code_challenge is base64url(SHA-256(verifier))
    const expectedChallenge = await sha256Base64Url(pkce.verifier);
    expect(target.searchParams.get("code_challenge")).toBe(expectedChallenge);
  });

  it("dispatches an error event when required attributes are missing", async () => {
    const el = document.createElement("oauth-login");
    el.setAttribute("storage-prefix", PREFIX);
    await mount(el);

    const errorPromise = waitForEvent(el, "error");
    await el.login();
    const ev = await errorPromise;
    expect(ev.detail.message).toMatch(/requires/i);
    expect(assignSpy).not.toHaveBeenCalled();
  });
});

describe("logout()", () => {
  it("clears storage and dispatches a logout event", async () => {
    sessionStorage.setItem(`${PREFIX}:token`, "tok");
    sessionStorage.setItem(`${PREFIX}:user`, JSON.stringify({ username: "alice" }));

    const el = await mount(makeEl());
    expect(el.loggedIn).toBe(true);

    const logoutPromise = waitForEvent(el, "logout");
    el.logout();
    await logoutPromise;

    expect(sessionStorage.getItem(`${PREFIX}:token`)).toBeNull();
    expect(sessionStorage.getItem(`${PREFIX}:user`)).toBeNull();
    expect(el.loggedIn).toBe(false);
    expect(el.username).toBe("");
  });
});

describe("session restore", () => {
  it("hydrates from sessionStorage on mount and dispatches login with restored:true", async () => {
    sessionStorage.setItem(`${PREFIX}:token`, "stored-token");
    sessionStorage.setItem(`${PREFIX}:user`, JSON.stringify({ username: "alice" }));

    const el = makeEl();
    const loginPromise = waitForEvent(el, "login");
    await mount(el);
    const ev = await loginPromise;

    expect(ev.detail.restored).toBe(true);
    expect(ev.detail.accessToken).toBe("stored-token");
    expect(ev.detail.user.username).toBe("alice");
    expect(el.loggedIn).toBe(true);
    expect(el.username).toBe("alice");
  });
});

describe("callback handling", () => {
  it("exchanges the code for a token and fetches userinfo", async () => {
    // Set up pkce + URL as if returning from /authorize
    const verifier = "verifier-abcd-1234";
    const state = "state-xyz";
    sessionStorage.setItem(`${PREFIX}:pkce`, JSON.stringify({ verifier, state }));
    setUrl(`http://localhost:5173/?code=THECODE&state=${state}`);

    globalThis.fetch = vi.fn(async (url, opts) => {
      if (url === "http://auth.test/token") {
        // Verify the body
        const body = new URLSearchParams(opts.body.toString());
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code")).toBe("THECODE");
        expect(body.get("code_verifier")).toBe(verifier);
        expect(body.get("redirect_uri")).toBe(REDIRECT);
        expect(body.get("client_id")).toBe("demo");
        return jsonResponse({ access_token: "issued-token", token_type: "Bearer", expires_in: 3600 });
      }
      if (url === "http://auth.test/userinfo") {
        expect(opts.headers.authorization).toBe("Bearer issued-token");
        return jsonResponse({ username: "alice" });
      }
      throw new Error("unexpected fetch: " + url);
    });

    const el = makeEl();
    const loginPromise = waitForEvent(el, "login");
    document.body.appendChild(el);
    const ev = await loginPromise;

    expect(ev.detail.restored).toBeUndefined();
    expect(ev.detail.accessToken).toBe("issued-token");
    expect(ev.detail.user.username).toBe("alice");
    expect(el.loggedIn).toBe(true);
    expect(el.username).toBe("alice");
    expect(sessionStorage.getItem(`${PREFIX}:token`)).toBe("issued-token");
    expect(sessionStorage.getItem(`${PREFIX}:pkce`)).toBeNull(); // single-flight
  });

  it("ignores the callback when state doesn't match stored pkce", async () => {
    sessionStorage.setItem(
      `${PREFIX}:pkce`,
      JSON.stringify({ verifier: "v", state: "stored-state" }),
    );
    setUrl("http://localhost:5173/?code=X&state=different-state");
    globalThis.fetch = vi.fn();

    const el = await mount(makeEl());
    expect(el.loggedIn).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // pkce stash is preserved (another instance might own it)
    expect(sessionStorage.getItem(`${PREFIX}:pkce`)).not.toBeNull();
  });

  it("dispatches error when the token endpoint fails", async () => {
    const verifier = "v";
    const state = "s";
    sessionStorage.setItem(`${PREFIX}:pkce`, JSON.stringify({ verifier, state }));
    setUrl(`http://localhost:5173/?code=X&state=${state}`);

    globalThis.fetch = vi.fn(async () =>
      new Response("nope", { status: 400, statusText: "Bad Request" }),
    );

    const el = makeEl();
    const errorPromise = waitForEvent(el, "error");
    document.body.appendChild(el);
    const ev = await errorPromise;

    expect(ev.detail.message).toMatch(/token exchange failed/);
    expect(el.loggedIn).toBe(false);
    expect(sessionStorage.getItem(`${PREFIX}:token`)).toBeNull();
  });
});

describe("slot delegation", () => {
  it("clicks on a custom slot=\"logged-out\" element trigger login()", async () => {
    const el = await mount(
      makeEl({ slots: '<button slot="logged-out" id="custom-signin">Sign in</button>' }),
    );

    const customBtn = el.querySelector("#custom-signin");
    expect(customBtn).toBeTruthy();
    customBtn.click();

    // login() is async; wait a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(assignSpy).toHaveBeenCalledTimes(1);
    const target = new URL(assignSpy.mock.calls[0][0]);
    expect(target.pathname).toBe("/authorize");
  });
});

// ---------- helpers ----------

function jsonResponse(obj, init = {}) {
  return new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

async function sha256Base64Url(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
