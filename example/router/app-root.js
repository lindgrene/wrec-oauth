import { css, html, Wrec } from "wrec";

import "../../src/oauth-login.js";
import {
  handleLinkClick,
  navigateTo,
  renderRoute,
  startRouteListener,
} from "./router.js";
import { setNext, takeNext } from "./auth.js";

class AppRoot extends Wrec {
  static css = css`
    :host {
      display: block;
      font-family: system-ui, sans-serif;
      max-width: 48rem;
      margin: 0 auto;
      padding: 0 1rem;
      line-height: 1.5;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid #ddd;
      margin-bottom: 1.5rem;
    }
    nav { display: flex; gap: 1rem; }
    nav a {
      color: #1559a8;
      text-decoration: none;
      padding: 0.25em 0;
    }
    nav a:hover { text-decoration: underline; }
    main { padding-bottom: 4rem; }
  `;

  static html = html`
    <div>
      <header>
        <nav>
          <a href="/">Home</a>
          <a href="/profile">Profile</a>
          <a href="/settings">Settings</a>
        </nav>
        <oauth-login
          id="auth"
          client-id="demo"
          authorize-url="http://localhost:4000/authorize"
          token-url="http://localhost:4000/token"
          userinfo-url="http://localhost:4000/userinfo"
          redirect-uri="http://localhost:5174/"
          scope="openid profile"
          storage-prefix="oauth-router"></oauth-login>
      </header>
      <main id="outlet"></main>
    </div>
  `;

  ready() {
    const outlet = this.shadowRoot.getElementById("outlet");
    const oauthEl = this.shadowRoot.getElementById("auth");

    this.addEventListener("click", (e) => handleLinkClick(e, outlet));

    this.addEventListener("login", () => {
      const next = takeNext();
      const current = location.pathname + location.search;
      if (next && next !== current) {
        void navigateTo(outlet, next);
      } else {
        void renderRoute(outlet);
      }
    });

    this.addEventListener("logout", () => {
      void renderRoute(outlet);
    });

    this.addEventListener("request-login", (e) => {
      if (e.detail?.next) setNext(e.detail.next);
      oauthEl.login();
    });

    startRouteListener(outlet);
    void renderRoute(outlet);
  }
}

AppRoot.define("app-root");
