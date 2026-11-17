const fs = require("node:fs");
const path = require("node:path");
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "launcher.config.json"), "utf8"));
const branding = config.branding || {};
const build = {
  appId: config.appId || "com.example.launcher",
  productName: branding.name || "Indie Game Launcher",
  directories: { output: "dist" },
  files: ["src/**/*", "package.json"],
  extraResources: [
    { from: config.catalogFile || "catalog.json", to: "catalog.json" },
    { from: "launcher.config.json", to: "launcher.config.json" }
  ],
  win: { target: ["nsis"] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true },
  linux: { target: ["AppImage", "deb"], category: "Game", maintainer: "ThornyDevil Studios <thornydevil.studios@gmail.com>", syncDesktopName: true },
  mac: { target: ["dmg", "zip"], category: "public.app-category.games" }
};
if (typeof config.updateRepository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.updateRepository)) {
  const [owner, repo] = config.updateRepository.split("/");
  build.publish = [{ provider: "github", owner, repo }];
}
module.exports = build;
