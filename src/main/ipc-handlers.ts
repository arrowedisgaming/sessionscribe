/**
 * Session Scribe — IPC Handlers
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

import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { config, AppConfig } from './config';
import { sessionManager } from './sessions/session-manager';
import { discordConnection } from './discord/connection';
import { sessionRecorder, RecordingOptions } from './recording/recorder';
import { modelManager } from './models/model-manager';
import { binaryManager } from './models/binary-manager';
import { transcriptionManager, TranscriptionRequest } from './transcription/transcription-manager';
import * as ch from './ipc-channels';

function sendToRenderer(channel: string, ...args: unknown[]): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, ...args);
  }
}

let registered = false;

export function registerIpcHandlers(): void {
  if (registered) return;
  registered = true;
  // ── Config ──────────────────────────────────
  ipcMain.handle(ch.CONFIG_GET, (_event, key: string) => {
    return config.get(key as keyof AppConfig);
  });

  const CONFIG_ALLOWED_KEYS: Record<string, string> = {
    discordToken: 'string',
    outputDir: 'string',
    transcriptionEngine: 'string',
    whisperModel: 'string',
    campaigns: 'object',
    displayNameOverrides: 'object',
    maxDurationMinutes: 'number',
    isFirstRun: 'boolean',
    autoTranscribe: 'boolean',
  };

  ipcMain.handle(ch.CONFIG_SET, (_event, key: string, value: unknown) => {
    const expectedType = CONFIG_ALLOWED_KEYS[key];
    if (!expectedType) {
      return { success: false, error: `Unknown config key: ${key}` };
    }
    if (typeof value !== expectedType) {
      return { success: false, error: `Invalid type for ${key}: expected ${expectedType}` };
    }
    config.set(key as keyof AppConfig, value as never);
  });

  ipcMain.handle(ch.CONFIG_GET_ALL, () => {
    const { discordToken: _token, ...safeConfig } = config.store;
    return safeConfig;
  });

  // ── Discord ─────────────────────────────────
  discordConnection.on('statusChanged', (status: string) => {
    sendToRenderer(ch.DISCORD_STATUS_CHANGED, status);
  });

  discordConnection.on('usersUpdated', (users: unknown[]) => {
    sendToRenderer(ch.DISCORD_USERS_UPDATED, users);
  });

  ipcMain.handle(ch.DISCORD_TEST_TOKEN, async (_event, token: string) => {
    return discordConnection.testToken(token);
  });

  ipcMain.handle(ch.DISCORD_CONNECT, async () => {
    const token = config.get('discordToken');
    if (!token) return { success: false, error: 'No token configured' };
    return discordConnection.connect(token);
  });

  ipcMain.handle(ch.DISCORD_DISCONNECT, async () => {
    await discordConnection.disconnect();
    return { success: true };
  });

  ipcMain.handle(ch.DISCORD_GET_GUILDS, async () => {
    return discordConnection.getGuilds();
  });

  ipcMain.handle(ch.DISCORD_GET_VOICE_CHANNELS, async (_event, guildId: string) => {
    return discordConnection.getVoiceChannels(guildId);
  });

  ipcMain.handle(ch.DISCORD_JOIN_CHANNEL, async (_event, guildId: string, channelId: string) => {
    return discordConnection.joinChannel(guildId, channelId);
  });

  ipcMain.handle(ch.DISCORD_LEAVE_CHANNEL, async () => {
    await discordConnection.leaveChannel();
    return { success: true };
  });

  // ── Recording ──────────────────────────────
  sessionRecorder.on('timer', (elapsed: number) => {
    sendToRenderer(ch.RECORDING_TIMER, elapsed);
  });

  sessionRecorder.on('stopped', () => {
    sendToRenderer(ch.RECORDING_STATUS, { recording: false });
  });

  ipcMain.handle(ch.RECORDING_START, async (_event, options: RecordingOptions) => {
    try {
      const connection = discordConnection.getConnection();
      if (!connection) return { success: false, error: 'Not in a voice channel' };
      const session = await sessionRecorder.start(connection, options);
      return { success: true, sessionId: session.id };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(ch.RECORDING_STOP, async () => {
    try {
      const session = await sessionRecorder.stop();
      return { success: true, session };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(ch.RECORDING_STATUS, () => {
    return {
      recording: sessionRecorder.recording,
      sessionId: sessionRecorder.currentSession?.id,
    };
  });

  // ── Transcription ────────────────────────────
  transcriptionManager.on('progress', (progress: unknown) => {
    sendToRenderer(ch.TRANSCRIPTION_PROGRESS, progress);
  });

  transcriptionManager.on('complete', (result: unknown) => {
    sendToRenderer(ch.TRANSCRIPTION_COMPLETE, result);
  });

  ipcMain.handle(ch.TRANSCRIPTION_START, async (_event, sessionId: string, options: Partial<TranscriptionRequest>) => {
    try {
      await transcriptionManager.transcribe({ sessionId, ...options });
      return { success: true };
    } catch (err) {
      sendToRenderer(ch.TRANSCRIPTION_ERROR, (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(ch.TRANSCRIPTION_CANCEL, async () => {
    transcriptionManager.cancel();
    return { success: true };
  });

  // ── Sessions ────────────────────────────────
  ipcMain.handle(ch.SESSIONS_LIST, async () => {
    return sessionManager.listSessions();
  });

  ipcMain.handle(ch.SESSIONS_GET, async (_event, sessionId: string) => {
    return sessionManager.readMetadata(sessionId);
  });

  ipcMain.handle(ch.SESSIONS_OPEN_FOLDER, async (_event, sessionId: string) => {
    const dir = sessionManager.getSessionDir(sessionId);
    await shell.openPath(dir);
  });

  ipcMain.handle(ch.SESSIONS_GET_INCOMPLETE, async () => {
    return sessionManager.getIncompleteSessions();
  });

  ipcMain.handle(ch.SESSIONS_EXPORT, async (_event, _sessionId: string, _transcriptFile: string) => {
    return { success: false, error: 'Not implemented' };
  });

  ipcMain.handle(ch.SESSIONS_DELETE, async (_event, sessionId: string) => {
    try {
      await sessionManager.deleteSession(sessionId);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(ch.SESSIONS_FINALIZE, async (_event, sessionId: string) => {
    try {
      await sessionManager.finalizeSession(sessionId);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(ch.SESSIONS_READ_TRANSCRIPT, async (_event, sessionId: string, filename: string) => {
    try {
      const sessionDir = sessionManager.getSessionDir(sessionId);
      const basename = path.basename(filename);
      const filePath = path.join(sessionDir, basename);
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(sessionDir) + path.sep) && resolved !== path.resolve(sessionDir)) {
        return { success: false, error: 'Invalid filename' };
      }
      const content = await fs.promises.readFile(resolved, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── Models ───────────────────────────────────
  modelManager.on('downloadProgress', (progress: unknown) => {
    sendToRenderer(ch.MODELS_DOWNLOAD_PROGRESS, progress);
  });

  ipcMain.handle(ch.MODELS_LIST, async () => {
    return modelManager.listModels();
  });

  ipcMain.handle(ch.MODELS_DOWNLOAD, async (_event, modelId: string) => {
    try {
      await modelManager.downloadModel(modelId);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(ch.MODELS_CANCEL_DOWNLOAD, async () => {
    modelManager.cancelDownload();
    return { success: true };
  });

  ipcMain.handle(ch.MODELS_DELETE, async (_event, modelId: string) => {
    return { success: modelManager.deleteModel(modelId) };
  });

  // ── App ─────────────────────────────────────
  ipcMain.handle(ch.APP_SELECT_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(ch.APP_GET_VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(ch.APP_OPEN_EXTERNAL, async (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Invalid URL scheme' };
      }
      await shell.openExternal(url);
      return { success: true };
    } catch {
      return { success: false, error: 'Invalid URL' };
    }
  });

  // ── Binaries ─────────────────────────────────
  binaryManager.on('progress', (progress: unknown) => {
    sendToRenderer(ch.BINARIES_PROGRESS, progress);
  });

  ipcMain.handle(ch.BINARIES_STATUS, () => {
    return { ffmpeg: binaryManager.hasFFmpeg(), whisper: binaryManager.hasWhisper() };
  });

  ipcMain.handle(ch.BINARIES_DOWNLOAD, async () => {
    try {
      await binaryManager.downloadAll();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ── Auto-connect on startup ─────────────────
  const token = config.get('discordToken');
  if (token) {
    discordConnection.connect(token).catch((err) => {
      console.error('Auto-connect failed:', err);
    });
  }
}
