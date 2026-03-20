/**
 * Session Scribe — Main Process Entry Point
 * Copyright (C) 2026 Arrowed
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { app, BrowserWindow, nativeImage, session } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc-handlers';
import { sessionRecorder } from './recording/recorder';
import { discordConnection } from './discord/connection';
import { processTracker } from './utils/process-tracker';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) {
  app.quit();
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

const createWindow = (): void => {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), '..', '..', 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  const mainWindow = new BrowserWindow({
    height: 700,
    width: 1000,
    minWidth: 800,
    minHeight: 600,
    title: 'Session Scribe',
    icon,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock.setIcon(icon);
  }

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
};

app.on('ready', () => {
  // Set Content Security Policy — stricter in production, allows eval for webpack HMR in dev
  const isDev = process.env.NODE_ENV === 'development';
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-eval'" : "script-src 'self'";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [`default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'`],
      },
    });
  });

  registerIpcHandlers();
  createWindow();
});

let isShuttingDown = false;

app.on('before-quit', async (event) => {
  if (isShuttingDown) return;

  if (sessionRecorder.recording) {
    event.preventDefault();
    isShuttingDown = true;

    try {
      await sessionRecorder.stop();
    } catch (err) {
      console.error('Failed to stop recording during shutdown:', err);
      // Mark session as incomplete if stop() fails
      const session = sessionRecorder.currentSession;
      if (session) {
        session.status = 'incomplete';
        const { sessionManager } = require('./sessions/session-manager');
        try { await sessionManager.writeMetadata(session); } catch { /* best effort */ }
      }
    }

    processTracker.killAll();

    try {
      await discordConnection.disconnect();
    } catch { /* best effort */ }

    app.quit();
    return;
  }

  // Not recording — just clean up
  processTracker.killAll();
  try {
    await discordConnection.disconnect();
  } catch { /* best effort */ }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
