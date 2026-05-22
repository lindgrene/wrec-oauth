import UniversalRouter from "universal-router";

import "./views/home-view.js";
import "./views/login-view.js";
import "./views/profile-view.js";
import "./views/settings-view.js";
import "./views/not-found-view.js";

import { isLoggedIn, setNext } from "./auth.js";

const routes = [
  {
    path: "",
    action: () => ({ tagName: "home-view" }),
  },
  {
    path: "/login",
    action: () => {
      const next = new URLSearchParams(location.search).get("next") || "/";
      return { tagName: "login-view", properties: { next } };
    },
  },
  {
    path: "/profile",
    action: () => ({ tagName: "profile-view", requiresAuth: true }),
  },
  {
    path: "/settings",
    action: () => ({ tagName: "settings-view", requiresAuth: true }),
  },
  {
    path: "(.*)",
    action: () => ({ tagName: "not-found-view" }),
  },
];

const router = new UniversalRouter(routes);

function createRouteElement(result) {
  const el = document.createElement(result.tagName);
  if (result.properties) Object.assign(el, result.properties);
  return el;
}

export async function renderRoute(outlet, path = location.pathname + location.search) {
  const url = new URL(path, location.origin);
  const result = await router.resolve(url.pathname);

  if (result.requiresAuth && !isLoggedIn()) {
    setNext(path);
    const target = "/login?next=" + encodeURIComponent(path);
    history.replaceState(null, "", target);
    return renderRoute(outlet, target);
  }

  outlet.replaceChildren(createRouteElement(result));
}

export async function navigateTo(outlet, path) {
  history.pushState(null, "", path);
  await renderRoute(outlet, path);
}

export function startRouteListener(outlet) {
  window.addEventListener("popstate", () => {
    void renderRoute(outlet);
  });
}

export function handleLinkClick(event, outlet) {
  if (event.defaultPrevented) return;
  if (event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const link = event
    .composedPath()
    .find((t) => t instanceof HTMLAnchorElement);
  if (!link) return;
  if (link.origin !== location.origin) return;
  if (link.target && link.target !== "_self") return;
  if (link.hasAttribute("download")) return;

  event.preventDefault();
  void navigateTo(outlet, link.pathname + link.search + link.hash);
}
