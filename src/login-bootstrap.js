import { applyWipeFromUrlIfRequested } from "./terrain-persistence.js";

const MODE_KEY = "grassWorldAppMode";

/**
 * @param {"desktop" | "tablet"} mode
 */
function applyBodyMode(mode) {
  document.body.classList.toggle("app-mode-desktop", mode === "desktop");
  document.body.classList.toggle("app-mode-tablet", mode === "tablet");
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

async function enterGame() {
  const gameRoot = document.getElementById("game-root");
  const loginRoot = document.getElementById("login-root");
  const splash = document.getElementById("app-splash");

  if (splash) {
    splash.classList.add("is-dismissed");
    splash.setAttribute("aria-hidden", "true");
    splash.setAttribute("hidden", "");
  }

  if (gameRoot) {
    gameRoot.classList.remove("game-root--concealed");
    gameRoot.removeAttribute("hidden");
  }
  if (loginRoot) {
    loginRoot.hidden = true;
    loginRoot.setAttribute("aria-hidden", "true");
  }

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const { main } = await import("./main.js");
  await main();
}

function wireModeSplashThenEnter() {
  const splash = document.getElementById("app-splash");
  const pickDesktop = document.getElementById("splash-mode-desktop");
  const pickTablet = document.getElementById("splash-mode-tablet");

  if (!splash || !pickDesktop || !pickTablet) {
    applyBodyMode("desktop");
    void enterGame();
    return;
  }

  const go = (/** @type {"desktop" | "tablet"} */ mode) => {
    applyBodyMode(mode);
    void enterGame();
  };

  pickDesktop.addEventListener("click", () => go("desktop"));
  pickTablet.addEventListener("click", () => go("tablet"));
}

async function run() {
  if (applyWipeFromUrlIfRequested()) return;
  const canvas = document.getElementById("login-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    applyBodyMode("desktop");
    void import("./main.js").then((m) => m.main());
    return;
  }

  wireModeSplashThenEnter();
}

run();
