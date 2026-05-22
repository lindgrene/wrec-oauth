import { css, html, Wrec } from "wrec";

class NotFoundView extends Wrec {
  static css = css`
    :host { display: block; }
    h2 { margin-top: 0; }
  `;

  static html = html`
    <section>
      <h2>Not found</h2>
      <p>The page you asked for doesn't exist. <a href="/">Go home</a>.</p>
    </section>
  `;
}

NotFoundView.define("not-found-view");
