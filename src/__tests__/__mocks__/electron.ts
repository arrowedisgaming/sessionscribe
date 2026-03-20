// Mock Electron APIs for testing main-process code outside Electron
export const app = {
  getPath: (name: string) => `/tmp/session-scribe-test/${name}`,
  getAppPath: () => '/tmp/session-scribe-test/app',
  isPackaged: false,
  quit: jest.fn(),
  requestSingleInstanceLock: () => true,
  on: jest.fn(),
};

export const BrowserWindow = {
  getAllWindows: () => [],
};

export const ipcMain = {
  handle: jest.fn(),
  on: jest.fn(),
};

export const dialog = {
  showOpenDialog: jest.fn(),
};

export const shell = {
  openPath: jest.fn(),
  openExternal: jest.fn(),
};

export const session = {
  defaultSession: {
    webRequest: {
      onHeadersReceived: jest.fn(),
    },
  },
};

export const nativeImage = {
  createFromPath: jest.fn(() => ({})),
};
