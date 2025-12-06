const { contextBridge, ipcRenderer } = require('electron');

// Предоставляем безопасный API для рендерера
contextBridge.exposeInMainWorld('electronAPI', {
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  checkBackendHealth: () => ipcRenderer.invoke('check-backend-health'),
  // Подписка на сообщения от бэкенда
  onBackendError: (callback) => {
    ipcRenderer.on('backend-error', (event, message) => callback(message));
  },
  onBackendInfo: (callback) => {
    ipcRenderer.on('backend-info', (event, message) => callback(message));
  },
  onBackendWarning: (callback) => {
    ipcRenderer.on('backend-warning', (event, message) => callback(message));
  },
  // Удаление слушателей
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});


