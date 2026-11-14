const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jotboxPicker", {
  onSources: (listener) => {
    const handler = (_event, sources) => listener(sources);
    ipcRenderer.on("picker:sources", handler);
    return () => ipcRenderer.removeListener("picker:sources", handler);
  },
  pick: (id) => ipcRenderer.send("picker:pick", id),
  cancel: () => ipcRenderer.send("picker:cancel"),
});
