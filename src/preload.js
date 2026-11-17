const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  chooseInstallDirectory: () => ipcRenderer.invoke("settings:choose-install-directory"),
  repairGame: id => ipcRenderer.invoke("game:repair", id),
  openGameFolder: id => ipcRenderer.invoke("game:open-folder", id),
  downloadLauncherUpdate: () => ipcRenderer.invoke("launcher:update-download"),
  installLauncherUpdate: () => ipcRenderer.invoke("launcher:update-install"),
  getCatalog: () => ipcRenderer.invoke("catalog:get"),
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  installGame: id => ipcRenderer.invoke("game:install", id),
  pauseDownload: id => ipcRenderer.invoke("download:pause", id),
  resumeDownload: id => ipcRenderer.invoke("download:resume", id),
  cancelDownload: id => ipcRenderer.invoke("download:cancel", id),
  launchGame: id => ipcRenderer.invoke("game:launch", id),
  openMods: id => ipcRenderer.invoke("game:mods", id),
  listMods: id => ipcRenderer.invoke("mods:list", id),
  installMod: id => ipcRenderer.invoke("mods:install", id),
  removeMod: (id, modId) => ipcRenderer.invoke("mods:remove", id, modId),
  uninstallGame: id => ipcRenderer.invoke("game:uninstall", id),
  addGame: game => ipcRenderer.invoke("catalog:add", game),
  openExternal: url => ipcRenderer.invoke("external:open", url),
  onProgress: callback => ipcRenderer.on("download:progress", (_event, data) => callback(data)),
  onQueue: callback => ipcRenderer.on("download:queue", (_event, data) => callback(data)),
  onStatus: callback => ipcRenderer.on("app:status", (_event, data) => callback(data)),
  onLauncherUpdate: callback => ipcRenderer.on("launcher:update-available", (_event, data) => callback(data))
});
