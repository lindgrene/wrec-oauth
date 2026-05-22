import { css, html, Wrec } from "wrec";

class HomeView extends Wrec {
  static css = css`
    :host { display: block; }
    h2 { margin-top: 0; }
    ul { padding-left: 1.25rem; }
    .muted { color: #666; }
  `;

  static html = html`
    <section>
      <h2>Home</h2>
      <p>Welcome to the routed OAuth demo. Public route — anyone can see this.</p>
      <ul>
        <li><a href="/profile">/profile</a> (requires sign-in)</li>
        <li><a href="/settings">/settings</a> (requires sign-in)</li>
      </ul>
      <p class="muted">Use the <strong>Log in</strong> button in the nav to authenticate, or just click a protected link and you'll be sent to the login page first.</p>
    </section>
  `;
}

HomeView.define("home-view");
