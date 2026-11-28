const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('browserUI', {
  command: (name, args) => ipcRenderer.invoke('browser-ui', name, args),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('browser-state', listener);
    return () => ipcRenderer.removeListener('browser-state', listener);
  },
  subscribeLayout: (callback) => {
    const listener = (_event, layout) => callback(layout);
    ipcRenderer.on('browser-layout', listener);
    return () => ipcRenderer.removeListener('browser-layout', listener);
  },
  subscribeShortcut: (callback) => {
    const listener = (_event, shortcut) => callback(shortcut);
    ipcRenderer.on('browser-shortcut', listener);
    return () => ipcRenderer.removeListener('browser-shortcut', listener);
  },
});
