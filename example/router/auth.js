export const STORAGE_PREFIX = "oauth-router";

export const isLoggedIn = () =>
  !!sessionStorage.getItem(`${STORAGE_PREFIX}:token`);

export const currentUser = () => {
  try {
    return JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}:user`) || "null");
  } catch {
    return null;
  }
};

export const currentToken = () =>
  sessionStorage.getItem(`${STORAGE_PREFIX}:token`) || "";

export const setNext = (path) => sessionStorage.setItem("auth:next", path);
export const takeNext = () => {
  const v = sessionStorage.getItem("auth:next");
  sessionStorage.removeItem("auth:next");
  return v;
};
