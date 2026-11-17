const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { pipeline } = require("node:stream/promises");
const { Readable, Transform } = require("node:stream");
const extract = require("extract-zip");
const { autoUpdater } = require("electron-updater");
const provenance = require("./provenance");

let win;
let launcherConfig = {};
let catalog = { games: [], studio: { name: "Indie Games" } };

function resourceFile(name) {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, "..", name);
}
function userFiles() {
  const root = path.join(app.getPath("userData"), "games");
  fs.mkdirSync(root, { recursive: true });
  return root;
}
function installedPath(game) { return path.join(userFiles(), game.id); }
function customCatalogPath() { return path.join(app.getPath("userData"), "custom-games.json"); }
function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function safeId(value) { return /^[a-z0-9][a-z0-9-]{1,63}$/.test(value); }

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
    description: String(game.description || "").slice(0, 500),
    itchUrl: String(game.itchUrl || ""),
    mods: Boolean(game.mods),
    platform: "windows"
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
function releaseInfo(game, releases) {
  const latest = releases[0];
  const asset = latest?.assets?.find(a => a.name.toLowerCase().includes(game.assetPattern.toLowerCase()));
  return {
    version: latest?.tag_name || "—",
    name: latest?.name || latest?.tag_name || "Noch kein Release",
    body: latest?.body || "Für dieses Release gibt es keine Release-Notes.",
    publishedAt: latest?.published_at || null,
    htmlUrl: latest?.html_url || "",
    assetName: asset?.name || "",
    assetUrl: asset?.browser_download_url || "",
    assetSize: asset?.size || 0,
    installed: fs.existsSync(installedPath(game)),
    installedVersion: readInstalledVersion(game.id)
  };
}
async function getCatalogView() {
  return Promise.all(catalog.games.map(async game => {
    try {
      const info = releaseInfo(game, await getReleases(game));
      return { ...game, ...info, updateAvailable: info.installed && info.version !== info.installedVersion };
    } catch (error) {
      return {
        ...game,
        installed: fs.existsSync(installedPath(game)),
        installedVersion: readInstalledVersion(game.id),
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
  const asset = latest.assets.find(a => a.name.toLowerCase().includes(game.assetPattern.toLowerCase()));
  if (!asset) throw new Error(`Kein Release-Asset passend zu „${game.assetPattern}“ gefunden.`);

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
  if (game.executable) {
    const candidate = path.resolve(root, game.executable);
    if (!candidate.startsWith(root + path.sep) || !fs.existsSync(candidate)) {
      throw new Error("Die konfigurierte EXE wurde im Installationsordner nicht gefunden.");
    }
    return candidate;
  }
  const files = fs.readdirSync(root, { recursive: true });
  const exe = files.find(file => String(file).toLowerCase().endsWith(".exe") && !String(file).toLowerCase().includes("unins"));
  if (!exe) throw new Error("Keine EXE gefunden. Bitte im Spieleintrag den korrekten executable-Pfad angeben.");
  return path.join(root, exe);
}
function registerIpc() {
  ipcMain.handle("config:get", () => publicConfig());
  ipcMain.handle("catalog:get", getCatalogView);
  ipcMain.handle("updates:check", getCatalogView);
  ipcMain.handle("game:install", async (_event, id) => installGame(id));
  ipcMain.handle("game:launch", async (_event, id) => {
    const game = catalog.games.find(g => g.id === id);
    if (!game || !fs.existsSync(installedPath(game))) throw new Error("Installiere das Spiel zuerst.");
    const { spawn } = require("node:child_process");
    const exe = resolveExecutable(game);
    const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: "ignore" });
    child.unref();
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
    autoUpdater.on("error", error => send("app:status", { message: "Launcher-Update fehlgeschlagen: " + error.message }));
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(error => {
      send("app:status", { message: "Update-Prüfung nicht möglich: " + error.message });
    }), 8000);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
