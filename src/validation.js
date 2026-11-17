const path = require("node:path");

function safeId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,63}$/.test(value);
}

function safeHttpUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function resolveInside(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim() || (path.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/.test(relativePath) || /^\\\\/.test(relativePath))) {
    throw new Error("Der Pfad muss relativ zum Zielordner sein.");
  }
  const segments = relativePath.split(/[\\/]/);
  if (segments.includes("..") || segments.includes("")) throw new Error("Ungültiger relativer Pfad.");
  const base = path.resolve(root);
  const candidate = path.resolve(base, relativePath);
  if (candidate === base || !candidate.startsWith(base + path.sep)) {
    throw new Error("Der Pfad liegt außerhalb des Zielordners.");
  }
  return candidate;
}

function validateGame(game) {
  if (!game || !safeId(game.id) || typeof game.name !== "string" || !game.name.trim() ||
      !/^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/.test(game.repository || "")) {
    throw new Error("Ungültiger Spieleintrag. Benötigt werden ID, Name und GitHub-Repository (owner/repo).");
  }
  const executable = String(game.executable || "");
  if (executable) resolveInside("/thornyx-validation-root", executable);
  const platformExecutables = Object.fromEntries(
    ["windows", "linux", "macos"]
      .filter(key => typeof game.platformExecutables?.[key] === "string" && game.platformExecutables[key])
      .map(key => [key, (resolveInside("/thornyx-validation-root", game.platformExecutables[key]), game.platformExecutables[key].slice(0, 240))])
  );
  return {
    id: game.id,
    name: game.name.slice(0, 80),
    developer: String(game.developer || "Indie Developer").slice(0, 80),
    repository: game.repository,
    channel: game.channel === "prerelease" ? "prerelease" : "stable",
    assetPattern: String(game.assetPattern || ".zip").slice(0, 120),
    executable,
    description: String(game.description || "").slice(0, 1000),
    genre: String(game.genre || "Uncategorized").slice(0, 80),
    cover: safeHttpUrl(game.cover),
    heroImage: safeHttpUrl(game.heroImage),
    itchUrl: safeHttpUrl(game.itchUrl),
    mods: Boolean(game.mods),
    platform: ["windows", "linux", "macos", "auto"].includes(game.platform) ? game.platform : "auto",
    platformAssets: Object.fromEntries(["windows", "linux", "macos"].filter(key => typeof game.platformAssets?.[key] === "string").map(key => [key, game.platformAssets[key].slice(0, 120)])),
    platformExecutables
  };
}

module.exports = { safeId, safeHttpUrl, resolveInside, validateGame };
