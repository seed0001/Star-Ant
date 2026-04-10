/** @returns {"water" | "land" | null} */
export function consumeBootstrapTerrain() {
  try {
    const v = sessionStorage.getItem("gwBootstrapTerrain");
    if (v === "land" || v === "water") {
      sessionStorage.removeItem("gwBootstrapTerrain");
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}
