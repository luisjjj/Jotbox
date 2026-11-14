const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("jotboxDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: ipcRenderer.sendSync("desktop:version"),
  publishState: (state) => ipcRenderer.send("island:state", state),
  onState: (listener) => subscribe("island:state", listener),
  onCommand: (listener) => subscribe("island:command", listener),
  command: (command) => ipcRenderer.send("island:command", command),
  setInteractive: (interactive) => ipcRenderer.send("island:interactive", Boolean(interactive)),
  openMain: () => ipcRenderer.send("main:open"),
});
