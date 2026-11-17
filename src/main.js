const { app, BrowserWindow, ipcMain, shell, dialog, Notification } = require("electron");
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
const queuedGameIds = [];
const downloadControllers = new Map();
const pausedDownloads = new Set();
const cancelledDownloads = new Set();
function publishDownloadQueue() { send("download:queue", { queue: [...queuedGameIds], paused: [...pausedDownloads] }); }
function queueInstall(id) {
  cancelledDownloads.delete(id);
  if (!queuedGameIds.includes(id)) queuedGameIds.push(id);
  publishDownloadQueue();
  const task = installQueue.then(() => pausedDownloads.has(id) || cancelledDownloads.has(id) ? { paused: pausedDownloads.has(id), cancelled: cancelledDownloads.has(id) } : installGame(id));
  installQueue = task.catch(() => {}).finally(() => {
    const index = queuedGameIds.indexOf(id); if (index >= 0) queuedGameIds.splice(index, 1);
    publishDownloadQueue();
  });
  return task;
}
function pauseGameDownload(id) { pausedDownloads.add(id); downloadControllers.get(id)?.abort(); publishDownloadQueue(); return { success: true }; }
function resumeGameDownload(id) { pausedDownloads.delete(id); cancelledDownloads.delete(id); publishDownloadQueue(); return queueInstall(id); }
function cancelGameDownload(id) { cancelledDownloads.add(id); pausedDownloads.delete(id); downloadControllers.get(id)?.abort(); publishDownloadQueue(); return { success: true }; }

function resourceFile(name) {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, "..", name);
}
function logFilePath() { return path.join(app.getPath("userData"), "logs", "launcher.log"); }
function writeLog(level, message) {
  try { fs.mkdirSync(path.dirname(logFilePath()), { recursive: true }); fs.appendFileSync(logFilePath(), "[" + new Date().toISOString() + "] [" + level + "] " + String(message) + "\n"); } catch {}
}
function notifyUser(title, body) {
  if (readSettings().notifications !== false && Notification.isSupported()) new Notification({ title, body }).show();
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
  const images = fs.readdirSync(root, { recursive: true }).filter(file => /\.(png|jpe?g|webp)$/i.test(String(file)));
  const coverFile = images.find(file => /(^|[\\/])(cover|poster|thumbnail)\./i.test(String(file))) || images.find(file => /cover|poster|thumbnail/i.test(String(file)));
  const heroFile = images.find(file => /(^|[\\/])(banner|background|hero)\./i.test(String(file))) || images.find(file => /banner|background|hero/i.test(String(file)));
  const detectedCover = coverFile ? metadataImage(root, String(coverFile)) : game.cover;
  const detectedHero = heroFile ? metadataImage(root, String(heroFile)) : game.heroImage;
  for (const name of ["thornyx-game.json", "game.json", "metadata.json"]) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
      const screenshots = Array.isArray(data.screenshots) ? data.screenshots.slice(0, 8).map(value => metadataImage(root, value)).filter(Boolean) : [];
      return {
        name: typeof data.title === "string" ? data.title.slice(0, 80) : (typeof data.name === "string" ? data.name.slice(0, 80) : game.name),
        description: typeof data.description === "string" ? data.description.slice(0, 1000) : game.description,
        genre: typeof data.genre === "string" ? data.genre.slice(0, 80) : game.genre,
        developer: typeof data.developer === "string" ? data.developer.slice(0, 80) : game.developer,
        cover: metadataImage(root, data.cover || data.coverUrl) || detectedCover,
        heroImage: metadataImage(root, data.heroImage || data.background) || detectedHero,
        screenshots,
        website: safeHttpUrl(data.website) || game.itchUrl
      };
    } catch {}
  }
  return { cover: detectedCover, heroImage: detectedHero };
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
async function download(url, destination, gameId, expectedSize = 0) {
  let offset = 0;
  try { offset = (await fsp.stat(destination)).size; } catch {}
  if (expectedSize && offset >= expectedSize) return { success: true };
  const controller = new AbortController();
  downloadControllers.set(gameId, controller);
  try {
    const headers = { "User-Agent": "Thornyx-Launcher" };
    if (offset) headers.Range = "bytes=" + offset + "-";
    let response = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
    if (offset && response.status !== 206) {
      await fsp.rm(destination, { force: true });
      offset = 0;
      response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Thornyx-Launcher" } });
    }
    if (!response.ok || !response.body) throw new Error("Download fehlgeschlagen: HTTP " + response.status);
    const total = Number(response.headers.get("content-length") || 0) + offset;
    let received = offset;
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        send("download:progress", { id: gameId, received, total, percent: total ? Math.round(received / total * 100) : 0 });
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(destination, { flags: offset ? "a" : "w" }), { signal: controller.signal });
    const finalSize = (await fsp.stat(destination)).size;
    if (expectedSize && finalSize !== expectedSize) throw new Error("Download unvollständig: " + finalSize + " von " + expectedSize + " Bytes.");
    return { success: true };
  } catch (error) {
    if (pausedDownloads.has(gameId)) return { paused: true };
    if (cancelledDownloads.has(gameId)) return { cancelled: true };
    throw error;
  } finally {
    downloadControllers.delete(gameId);
  }
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
  const safeVersion = String(latest.tag_name || "latest").replace(/[^A-Za-z0-9._-]/g, "_");
  const archive = path.join(root, `${id}-${safeVersion}-download${path.extname(asset.name)}`);
  let movedOld = false;
  let keepArchive = false;

  await fsp.mkdir(temp, { recursive: true });
  try {
    send("app:status", { message: `Lade ${game.name} herunter …` });
    const downloadResult = await download(asset.browser_download_url, archive, id, Number(asset.size || 0));
    if (downloadResult.paused) { keepArchive = true; await fsp.rm(temp, { recursive: true, force: true }); return { success: false, paused: true }; }
    if (downloadResult.cancelled) { await fsp.rm(temp, { recursive: true, force: true }); return { success: false, cancelled: true }; }
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
    writeLog("INFO", "Spiel installiert: " + game.name + " (" + latest.tag_name + ")"); notifyUser("Installation abgeschlossen", game.name + " ist jetzt spielbereit.");
    return { success: true, version: latest.tag_name };
  } catch (error) {
    await fsp.rm(temp, { recursive: true, force: true });
    writeLog("ERROR", "Installation fehlgeschlagen (" + id + "): " + error.stack);
    if (pausedDownloads.has(id)) { keepArchive = true; return { success: false, paused: true }; }
    if (cancelledDownloads.has(id)) return { success: false, cancelled: true };
    throw error;
  } finally {
    if (!keepArchive) await fsp.rm(archive, { force: true });
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
  ipcMain.handle("settings:get", () => ({ ...readSettings(), installDirectory: userFiles() }));
  ipcMain.handle("settings:save", (_event, values) => {
    const next = { ...readSettings(), notifications: values?.notifications !== false, startMaximized: Boolean(values?.startMaximized), autoStart: Boolean(values?.autoStart) };
    writeSettings(next);
    if (process.platform === "win32" || process.platform === "darwin") app.setLoginItemSettings({ openAtLogin: next.autoStart });
    if (win && !win.isDestroyed()) { if (next.startMaximized) win.maximize(); else win.unmaximize(); }
    return { success: true, ...next };
  });
  ipcMain.handle("diagnostics:open-logs", async () => { writeLog("INFO", "Logordner geöffnet"); const error = await shell.openPath(path.dirname(logFilePath())); if (error) throw new Error(error); return { success: true }; });
  ipcMain.handle("settings:choose-install-directory", async () => {
    const result = await dialog.showOpenDialog(win, { title: "Spielinstallationsordner auswählen", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true, installDirectory: userFiles() };
    const previous = userFiles();
    const chosen = path.resolve(result.filePaths[0]);
    if (chosen === previous) return { canceled: false, installDirectory: previous };
    const relative = path.relative(previous, chosen);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("Der neue Installationsordner darf nicht innerhalb des bisherigen Spieleordners liegen.");
    fs.mkdirSync(chosen, { recursive: true });
    for (const entry of await fsp.readdir(previous, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".tmp-") || entry.name.endsWith(".old")) continue;
      const source = path.join(previous, entry.name);
      if (!fs.existsSync(path.join(source, ".thornyx-install.json"))) continue;
      const destination = path.join(chosen, entry.name);
      if (!fs.existsSync(destination)) {
        await fsp.cp(source, destination, { recursive: true, errorOnExist: true });
        await fsp.rm(source, { recursive: true, force: true });
      }
    }
    writeSettings({ ...readSettings(), installDirectory: chosen });
    return { canceled: false, installDirectory: chosen };
  });
  ipcMain.handle("catalog:get", getCatalogView);
  ipcMain.handle("updates:check", getCatalogView);
  ipcMain.handle("game:install", async (_event, id) => queueInstall(id));
  ipcMain.handle("download:pause", (_event, id) => pauseGameDownload(id));
  ipcMain.handle("download:resume", async (_event, id) => resumeGameDownload(id));
  ipcMain.handle("download:cancel", (_event, id) => cancelGameDownload(id));
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
    writeLog("INFO", "Spiel gestartet: " + game.name);
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
  if (readSettings().startMaximized) win.maximize();
}
process.on("uncaughtException", error => writeLog("FATAL", error.stack || error.message));
process.on("unhandledRejection", error => writeLog("ERROR", error?.stack || String(error)));
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
