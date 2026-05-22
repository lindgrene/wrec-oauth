import { css, html, Wrec } from "wrec";
import { currentUser } from "../auth.js";

class SettingsView extends Wrec {
  static properties = {
    username: { type: String, value: "" },
  };

  static css = css`
    :host { display: block; }
    h2 { margin-top: 0; }
    fieldset { border: 1px solid #ddd; border-radius: 6px; padding: 1rem; }
    label { display: block; margin: 0.25rem 0; }
  `;

  static html = html`
    <section>
      <h2>Settings</h2>
      <p>Also protected — same <code>requiresAuth: true</code> on the route, no separate auth check needed in this view.</p>
      <fieldset>
        <legend>Account</legend>
        <label>Signed in as: <strong><span>this.username</span></strong></label>
        <label><input type="checkbox"> Send me notifications</label>
        <label><input type="checkbox"> Use dark mode</label>
      </fieldset>
    </section>
  `;

  ready() {
    const user = currentUser();
    this.username = user?.username || user?.name || "(unknown)";
  }
}

SettingsView.define("settings-view");
