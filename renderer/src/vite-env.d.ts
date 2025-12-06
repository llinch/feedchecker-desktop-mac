/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  // добавьте другие переменные окружения здесь
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Типы для Electron API
interface Window {
  electronAPI?: {
    getBackendUrl: () => Promise<string>;
    checkBackendHealth: () => Promise<boolean>;
    onBackendError: (callback: (message: string) => void) => void;
    onBackendInfo: (callback: (message: string) => void) => void;
    onBackendWarning: (callback: (message: string) => void) => void;
    removeAllListeners: (channel: string) => void;
  };
}

