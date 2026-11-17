const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { pipeline } = require("node:stream/promises");
const { Readable, Transform } = require("node:stream");
const extract = require("extract-zip");
const { autoUpdater } = require("electron-updater");
const { pathToFileURL } = require("node:url");
const provenance = require("./provenance");

let win;
let launcherConfig = {};
let catalog = { games: [], studio: { name: "Indie Games" } };
let installQueue = Promise.resolve();
function queueInstall(id) { const task = installQueue.then(() => installGame(id)); installQueue = task.catch(() => {}); return task; }

function resourceFile(name) {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, "..", name);
}
function settingsPath() { return path.join(app.getPath("userData"), "settings.json"); }
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsPath(), "utf8")); } catch { return {}; } }
function writeSettings(value) { fs.mkdirSync(app.getPath("userData"), { recursive: true }); fs.writeFileSync(settingsPath(), JSON.stringify(value, null, 2)); }
function userFiles() {
  const configured = readSettings().installDirectory;
  const root = configured && path.isAbsolute(configured) ? configured : path.join(app.getPath("userData"), "games");
  fs.mkdirSync(root, { recursive: true }); return root;
}
function installedPath(game) { return path.join(userFiles(), game.id); }
function customCatalogPath() { return path.join(app.getPath("userData"), "custom-games.json"); }
function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function safeId(value) { return /^[a-z0-9][a-z0-9-]{1,63}$/.test(value); }

function safeHttpUrl(value) {
  if (!value) return "";
  try { const url = new URL(String(value)); return ["https:", "http:"].includes(url.protocol) ? url.toString() : ""; }
  catch { return ""; }
}
function validateGame(game) {
  if (!game || !safeId(game.id) || !game.name ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(game.repository || "")) {
    throw new Error("Ungültiger Spieleintrag. Benötigt werden ID, Name und GitHub-Repository (owner/repo).");
  }
  const executable = String(game.executable || "");
  if (executable && (path.isAbsolute(executable) || executable.split(/[\\/]/).includes(".."))) {
    throw new Error("Der EXE-Pfad muss relativ zum Installationsordner sein.");
  }
  return {
    id: game.id,
    name: String(game.name).slice(0, 80),
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
    platformExecutables: Object.fromEntries(["windows", "linux", "macos"].filter(key => typeof game.platformExecutables?.[key] === "string").map(key => [key, game.platformExecutables[key].slice(0, 240)]))
  };
}

async function loadConfiguration() {
  const loaded = JSON.parse(await fsp.readFile(resourceFile("launcher.config.json"), "utf8"));
  if (loaded.schemaVersion !== 1) throw new Error("Nicht unterstützte launcher.config.json-Version.");
  launcherConfig = loaded;
  const catalogName = path.basename(loaded.catalogFile || "catalog.json");
  const base = JSON.parse(await fsp.readFile(resourceFile(catalogName), "utf8"));
  let custom = [];
  try { custom = JSON.parse(await fsp.readFile(customCatalogPath(), "utf8")); } catch {}
  const seen = new Set();
  catalog = {
    ...base,
    games: [...(base.games || []), ...(Array.isArray(custom) ? custom : [])].filter(game => {
      if (!game || seen.has(game.id)) return false;
      seen.add(game.id);
      return true;
    }).map(validateGame)
  };
}
function publicConfig() {
  return {
    branding: launcherConfig.branding || {},
    provenance,
    version: app.getVersion(),
    updateEnabled: Boolean(launcherConfig.updateRepository),
    library: launcherConfig.library || { layoutMode: "auto", largeLibraryThreshold: 30, compactMaxGames: 9, mediumMaxGames: 29 },
    settings: launcherConfig.settings || {}
  };
}
async function getReleases(game) {
  const response = await fetch(`https://api.github.com/repos/${game.repository}/releases?per_page=30`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Thornyx-Launcher" }
  });
  if (!response.ok) throw new Error(`GitHub API: ${response.status} ${response.statusText}`);
  const releases = await response.json();
  return releases.filter(r => !r.draft && (game.channel === "prerelease" || !r.prerelease))
    .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
}
function readInstalledVersion(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(installedPath({ id }), ".thornyx-install.json"), "utf8")).version || "";
  } catch { return ""; }
}
function metadataImage(root, value) {
  const remote = safeHttpUrl(value);
  if (remote) return remote;
  if (typeof value !== "string" || !value.trim()) return "";
  const candidate = path.resolve(root, value);
  if (candidate === root || !candidate.startsWith(root + path.sep)) return "";
  try { return fs.statSync(candidate).isFile() ? pathToFileURL(candidate).href : ""; } catch { return ""; }
}
function readPackagedMetadata(game) {
  const root = installedPath(game);
  if (!fs.existsSync(root)) return {};
  for (const name of ["thornyx-game.json", "game.json", "metadata.json"]) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
      const screenshots = Array.isArray(data.screenshots) ? data.screenshots.slice(0, 8).map(value => metadataImage(root, value)).filter(Boolean) : [];
      return {
        name: typeof data.title === "string" ? data.title.slice(0, 80) : game.name,
        description: typeof data.description === "string" ? data.description.slice(0, 1000) : game.description,
        genre: typeof data.genre === "string" ? data.genre.slice(0, 80) : game.genre,
        developer: typeof data.developer === "string" ? data.developer.slice(0, 80) : game.developer,
        cover: metadataImage(root, data.cover || data.coverUrl) || game.cover,
        heroImage: metadataImage(root, data.heroImage || data.background) || game.heroImage,
        screenshots,
        website: safeHttpUrl(data.website) || game.itchUrl
      };
    } catch {}
  }
  const images = fs.readdirSync(root, { recursive: true }).filter(file => /\.(png|jpe?g|webp)$/i.test(String(file)));
  const cover = images.find(file => /(^|[\\/])(cover|poster|thumbnail)\./i.test(String(file))) || images.find(file => /cover|poster|thumbnail/i.test(String(file)));
  const hero = images.find(file => /(^|[\\/])(banner|background|hero)\./i.test(String(file))) || images.find(file => /banner|background|hero/i.test(String(file)));
  return { cover: cover ? metadataImage(root, String(cover)) : game.cover, heroImage: hero ? metadataImage(root, String(hero)) : game.heroImage };
}

function platformKey() { return process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"; }
function releaseAssetPattern(game) { return game.platformAssets?.[platformKey()] || game.assetPattern; }
function releaseInfo(game, releases) {
  const latest = releases[0];
  const pattern = releaseAssetPattern(game);
  const asset = latest?.assets?.find(a => a.name.toLowerCase().includes(pattern.toLowerCase()));
  const supportedPlatform = game.platform === "auto" || game.platform === platformKey() || Boolean(game.platformAssets?.[platformKey()] && game.platformExecutables?.[platformKey()]);
  return {
    version: latest?.tag_name || "—",
    name: latest?.name || latest?.tag_name || "Noch kein Release",
    body: latest?.body || "Für dieses Release gibt es keine Release-Notes.",
    publishedAt: latest?.published_at || null,
    htmlUrl: latest?.html_url || "",
    supportedPlatform,
    assetName: supportedPlatform ? (asset?.name || "") : "",
    assetUrl: supportedPlatform ? (asset?.browser_download_url || "") : "",
    assetSize: asset?.size || 0,
    installed: fs.existsSync(installedPath(game)),
    installedVersion: readInstalledVersion(game.id)
  };
}
async function getCatalogView() {
  return Promise.all(catalog.games.map(async game => {
    try {
      const info = releaseInfo(game, await getReleases(game));
      return { ...game, ...readPackagedMetadata(game), ...info, updateAvailable: info.installed && info.version !== info.installedVersion };
    } catch (error) {
      return {
        ...game,
        installed: fs.existsSync(installedPath(game)),
        installedVersion: readInstalledVersion(game.id),
        supportedPlatform: game.platform === "auto" || game.platform === platformKey() || Boolean(game.platformAssets?.[platformKey()] && game.platformExecutables?.[platformKey()]),
        error: error.message
      };
    }
  }));
}
async function download(url, destination, gameId) {
  const response = await fetch(url, { headers: { "User-Agent": "Thornyx-Launcher" } });
  if (!response.ok || !response.body) throw new Error(`Download fehlgeschlagen: HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length") || 0);
  let received = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      send("download:progress", { id: gameId, received, total, percent: total ? Math.round(received / total * 100) : 0 });
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(destination));
}
async function installGame(id) {
  const game = catalog.games.find(g => g.id === id);
  if (!game) throw new Error("Spiel nicht gefunden.");
  const releases = await getReleases(game);
  const latest = releases[0];
  if (!latest) throw new Error("Für dieses Spiel wurde kein passendes Release gefunden.");
  const pattern = releaseAssetPattern(game);
  const asset = latest.assets.find(a => a.name.toLowerCase().includes(pattern.toLowerCase()));
  if (!asset) throw new Error("Kein Release-Asset passend zu „" + pattern + "“ für " + platformKey() + " gefunden.");

  const root = userFiles();
  const temp = path.join(root, `.tmp-${id}-${Date.now()}`);
  const target = installedPath(game);
  const backup = target + ".old";
  const archive = path.join(root, `${id}-download${path.extname(asset.name)}`);
  let movedOld = false;

  await fsp.mkdir(temp, { recursive: true });
  try {
    send("app:status", { message: `Lade ${game.name} herunter …` });
    await download(asset.browser_download_url, archive, id);
    if (asset.name.toLowerCase().endsWith(".zip")) {
      send("app:status", { message: `Entpacke ${game.name} …` });
      await extract(archive, { dir: temp });
    } else {
      await fsp.copyFile(archive, path.join(temp, path.basename(asset.name)));
    }
    await fsp.writeFile(path.join(temp, ".thornyx-install.json"), JSON.stringify({
      version: latest.tag_name,
      installedAt: new Date().toISOString()
    }, null, 2));

    await fsp.rm(backup, { recursive: true, force: true });
    if (fs.existsSync(target)) {
      await fsp.rename(target, backup);
      movedOld = true;
    }
    try {
      await fsp.rename(temp, target);
    } catch (error) {
      if (movedOld && !fs.existsSync(target)) await fsp.rename(backup, target);
      throw error;
    }
    await fsp.rm(backup, { recursive: true, force: true });
    return { success: true, version: latest.tag_name };
  } catch (error) {
    await fsp.rm(temp, { recursive: true, force: true });
    throw error;
  } finally {
    await fsp.rm(archive, { force: true });
  }
}
function resolveExecutable(game) {
  const root = path.resolve(installedPath(game));
  const configuredExecutable = game.platformExecutables?.[platformKey()] || game.executable;
  if (configuredExecutable) {
    const candidate = path.resolve(root, configuredExecutable);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) throw new Error("Der Startpfad liegt außerhalb des Installationsordners.");
    if (!fs.existsSync(candidate)) throw new Error("Die konfigurierte Startdatei wurde nicht gefunden.");
    return candidate;
  }
  const files = fs.readdirSync(root, { recursive: true });
  const wanted = process.platform === "win32" ? [".exe"] : process.platform === "darwin" ? [".app", ".command"] : [".x86_64", ".x86", ".sh"];
  const match = files.find(file => {
    const value = String(file).toLowerCase();
    return wanted.some(ext => ext && value.endsWith(ext)) && !value.includes("unins");
  });
  if (!match && process.platform === "linux") match = files.find(file => { const full = path.join(root, String(file)); try { const stat = fs.statSync(full); return stat.isFile() && (stat.mode & 0o111) !== 0 && !/\.(so|dll|txt|json|dat|pak)$/i.test(full); } catch { return false; } });
  if (!match) throw new Error("Keine passende Startdatei gefunden. Bitte platformExecutables oder executable konfigurieren.");
  return path.join(root, match);
}
function registerIpc() {
  ipcMain.handle("config:get", () => publicConfig());
  ipcMain.handle("settings:get", () => ({ installDirectory: userFiles() }));
  ipcMain.handle("settings:choose-install-directory", async () => {
    const result = await dialog.showOpenDialog(win, { title: "Spielinstallationsordner auswählen", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true, installDirectory: userFiles() };
    const chosen = path.resolve(result.filePaths[0]); writeSettings({ ...readSettings(), installDirectory: chosen });
    fs.mkdirSync(chosen, { recursive: true }); return { canceled: false, installDirectory: chosen };
  });
  ipcMain.handle("catalog:get", getCatalogView);
  ipcMain.handle("updates:check", getCatalogView);
  ipcMain.handle("game:install", async (_event, id) => queueInstall(id));
  ipcMain.handle("game:repair", async (_event, id) => queueInstall(id));
  ipcMain.handle("game:open-folder", async (_event, id) => {
    const game = catalog.games.find(g => g.id === id);
    if (!game || !fs.existsSync(installedPath(game))) throw new Error("Spielordner nicht gefunden.");
    const error = await shell.openPath(installedPath(game)); if (error) throw new Error(error); return { success: true };
  });
  ipcMain.handle("game:launch", async (_event, id) => {
    const game = catalog.games.find(g => g.id === id);
    if (!game || !fs.existsSync(installedPath(game))) throw new Error("Installiere das Spiel zuerst.");
    const { spawn } = require("node:child_process");
    const exe = resolveExecutable(game);
    if (process.platform === "darwin" && exe.toLowerCase().endsWith(".app")) {
      const error = await shell.openPath(exe);
      if (error) throw new Error(error);
      return { success: true };
    }
    if (process.platform !== "win32") await fsp.chmod(exe, 0o755).catch(() => {});
    const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: "ignore" });
    child.unref();
    return { success: true };
  });
  ipcMain.handle("mods:list", async (_event, id) => {
    const game = catalog.games.find(g => g.id === id);
    if (!game || !game.mods || !fs.existsSync(installedPath(game))) throw new Error("Mods sind für dieses Spiel nicht verfügbar.");
    const root = path.join(installedPath(game), "Mods");
    await fsp.mkdir(root, { recursive: true });
    return (await fsp.readdir(root, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => ({ id: item.name, name: item.name }));
  });
  ipcMain.handle("mods:install", async (_event, id) => {
    const game = catalog.games.find(g => g.id === id);
    if (!game || !game.mods || !fs.existsSync(installedPath(game))) throw new Error("Mods sind für dieses Spiel nicht verfügbar.");
    const picked = await dialog.showOpenDialog(win, { title: "Mod-ZIP auswählen", properties: ["openFile"], filters: [{ name: "ZIP-Mods", extensions: ["zip"] }] });
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
    const root = path.join(installedPath(game), "Mods");
    await fsp.mkdir(root, { recursive: true });
    const base = path.basename(picked.filePaths[0], path.extname(picked.filePaths[0])).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "mod";
    let modId = "mod-" + base, suffix = 2;
    while (fs.existsSync(path.join(root, modId))) modId = "mod-" + base + "-" + suffix++;
    const destination = path.join(root, modId);
    await fsp.mkdir(destination, { recursive: true });
    try { await extract(picked.filePaths[0], { dir: destination }); }
    catch (error) { await fsp.rm(destination, { recursive: true, force: true }); throw error; }
    return { success: true, id: modId };
  });
  ipcMain.handle("mods:remove", async (_event, id, modId) => {
    const game = catalog.games.find(g => g.id === id);
    if (!game || !game.mods || !safeId(modId) || !fs.existsSync(installedPath(game))) throw new Error("Ungültiger Mod-Eintrag.");
    const root = path.resolve(installedPath(game), "Mods");
    const target = path.resolve(root, modId);
    if (!target.startsWith(root + path.sep)) throw new Error("Ungültiger Mod-Pfad.");
    await fsp.rm(target, { recursive: true, force: true });
    return { success: true };
  });
  ipcMain.handle("game:mods", async (_event, id) => {
    const game = catalog.games.find(g => g.id === id);
    if (!game || !game.mods) throw new Error("Für dieses Spiel ist kein Mod-Ordner aktiviert.");
    const folder = path.join(installedPath(game), "Mods");
    await fsp.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
    return { success: true };
  });
  ipcMain.handle("game:uninstall", async (_event, id) => {
    const game = catalog.games.find(g => g.id === id);
    if (!game) throw new Error("Spiel nicht gefunden.");
    await fsp.rm(installedPath(game), { recursive: true, force: true });
    return { success: true };
  });
  ipcMain.handle("catalog:add", async (_event, raw) => {
    const game = validateGame(raw);
    if (catalog.games.some(g => g.id === game.id)) throw new Error("Diese Spiel-ID existiert bereits.");
    const custom = JSON.parse(await fsp.readFile(customCatalogPath(), "utf8").catch(() => "[]"));
    custom.push(game);
    await fsp.writeFile(customCatalogPath(), JSON.stringify(custom, null, 2));
    await loadConfiguration();
    return { success: true };
  });
  ipcMain.handle("external:open", async (_event, url) => {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Ungültiger Link.");
    await shell.openExternal(parsed.toString());
    return { success: true };
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: launcherConfig.branding?.backgroundColor || "#0b0d12",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, "index.html"));
}
app.whenReady().then(async () => {
  await loadConfiguration();
  registerIpc();
  createWindow();
  if (app.isPackaged && launcherConfig.updateRepository) {
    autoUpdater.autoDownload = false;
    autoUpdater.on("update-available", info => send("launcher:update-available", { version: info.version }));
    autoUpdater.on("update-not-available", () => send("app:status", { message: "Launcher ist aktuell." }));
    autoUpdater.on("error", error => send("app:status", { message: "Launcher-Update fehlgeschlagen: " + error.message }));
    ipcMain.handle("launcher:update-download", async () => { await autoUpdater.downloadUpdate(); return { success: true }; });
    ipcMain.handle("launcher:update-install", () => { autoUpdater.quitAndInstall(); return { success: true }; });
    setTimeout(() => autoUpdater.checkForUpdates().catch(error => send("app:status", { message: "Update-Prüfung nicht möglich: " + error.message })), 8000);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
