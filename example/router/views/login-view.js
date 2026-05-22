import { css, html, Wrec } from "wrec";

class LoginView extends Wrec {
  static properties = {
    next: { type: String, value: "/" },
  };

  static css = css`
    :host { display: block; }
    h2 { margin-top: 0; }
    button { padding: 0.5em 1em; cursor: pointer; font-size: 1rem; }
    code { background: #f4f4f4; padding: 0.1em 0.3em; border-radius: 3px; }
  `;

  static html = html`
    <section>
      <h2>Sign in required</h2>
      <p>You need to sign in to view <code>this.next</code>.</p>
      <p>Click <strong>Sign in</strong> below, or use the <strong>Log in</strong> button in the nav. After authenticating you'll be sent back to where you were headed.</p>
      <button onClick="this.requestLogin()">Sign in</button>
    </section>
  `;

  requestLogin() {
    this.dispatch("request-login", { next: this.next });
  }
}

LoginView.define("login-view");
