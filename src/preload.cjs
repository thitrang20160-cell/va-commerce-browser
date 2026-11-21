const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('browserUI', {
  command: (name, args) => ipcRenderer.invoke('browser-ui', name, args),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('browser-state', listener);
    return () => ipcRenderer.removeListener('browser-state', listener);
  },
});
