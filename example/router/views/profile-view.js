import { css, html, Wrec } from "wrec";
import { currentToken, currentUser } from "../auth.js";

class ProfileView extends Wrec {
  static properties = {
    username: { type: String, value: "" },
    tokenPreview: { type: String, value: "" },
  };

  static css = css`
    :host { display: block; }
    h2 { margin-top: 0; }
    code { background: #f4f4f4; padding: 0.1em 0.3em; border-radius: 3px; }
    .muted { color: #666; font-size: 0.875rem; }
  `;

  static html = html`
    <section>
      <h2>Profile</h2>
      <p>Hello, <strong><span>this.username</span></strong>!</p>
      <p>Access token: <code>this.tokenPreview</code></p>
      <p class="muted">This route is protected. Refresh the page — your session is in <code>sessionStorage</code>, so you'll still see this view as long as you're signed in.</p>
    </section>
  `;

  ready() {
    const user = currentUser();
    this.username = user?.username || user?.name || "(unknown)";
    const tok = currentToken();
    this.tokenPreview = tok ? `${tok.slice(0, 8)}…${tok.slice(-4)}` : "(none)";
  }
}

ProfileView.define("profile-view");
