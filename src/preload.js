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
  launchGame: id => ipcRenderer.invoke("game:launch", id),
  openMods: id => ipcRenderer.invoke("game:mods", id),
  uninstallGame: id => ipcRenderer.invoke("game:uninstall", id),
  addGame: game => ipcRenderer.invoke("catalog:add", game),
  openExternal: url => ipcRenderer.invoke("external:open", url),
  onProgress: callback => ipcRenderer.on("download:progress", (_event, data) => callback(data)),
  onStatus: callback => ipcRenderer.on("app:status", (_event, data) => callback(data)),
  onLauncherUpdate: callback => ipcRenderer.on("launcher:update-available", (_event, data) => callback(data))
});
