const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  getCatalog: () => ipcRenderer.invoke("catalog:get"),
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  installGame: id => ipcRenderer.invoke("game:install", id),
  launchGame: id => ipcRenderer.invoke("game:launch", id),
  openMods: id => ipcRenderer.invoke("game:mods", id),
  uninstallGame: id => ipcRenderer.invoke("game:uninstall", id),
  addGame: game => ipcRenderer.invoke("catalog:add", game),
  openExternal: url => ipcRenderer.invoke("external:open", url),
  onProgress: callback => ipcRenderer.on("download:progress", (_event, data) => callback(data)),
  onStatus: callback => ipcRenderer.on("app:status", (_event, data) => callback(data))
});
