/**
 * Session Scribe — Preload Script
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

import { contextBridge, ipcRenderer } from 'electron';
import * as ch from '../main/ipc-channels';

const electronAPI = {
  // Config
  configGet: (key: string) => ipcRenderer.invoke(ch.CONFIG_GET, key),
  configSet: (key: string, value: unknown) => ipcRenderer.invoke(ch.CONFIG_SET, key, value),
  configGetAll: () => ipcRenderer.invoke(ch.CONFIG_GET_ALL),

  // Discord
  discordTestToken: (token: string) => ipcRenderer.invoke(ch.DISCORD_TEST_TOKEN, token),
  discordConnect: () => ipcRenderer.invoke(ch.DISCORD_CONNECT),
  discordDisconnect: () => ipcRenderer.invoke(ch.DISCORD_DISCONNECT),
  discordGetGuilds: () => ipcRenderer.invoke(ch.DISCORD_GET_GUILDS),
  discordGetVoiceChannels: (guildId: string) => ipcRenderer.invoke(ch.DISCORD_GET_VOICE_CHANNELS, guildId),
  discordJoinChannel: (guildId: string, channelId: string) => ipcRenderer.invoke(ch.DISCORD_JOIN_CHANNEL, guildId, channelId),
  discordLeaveChannel: () => ipcRenderer.invoke(ch.DISCORD_LEAVE_CHANNEL),

  // Discord events (main → renderer)
  onDiscordStatusChanged: (callback: (status: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
    ipcRenderer.on(ch.DISCORD_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(ch.DISCORD_STATUS_CHANGED, handler);
  },
  onDiscordUsersUpdated: (callback: (users: unknown[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, users: unknown[]) => callback(users);
    ipcRenderer.on(ch.DISCORD_USERS_UPDATED, handler);
    return () => ipcRenderer.removeListener(ch.DISCORD_USERS_UPDATED, handler);
  },

  // Recording
  recordingStart: (options: unknown) => ipcRenderer.invoke(ch.RECORDING_START, options),
  recordingStop: () => ipcRenderer.invoke(ch.RECORDING_STOP),
  recordingStatus: () => ipcRenderer.invoke(ch.RECORDING_STATUS),

  onRecordingTimer: (callback: (elapsed: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, elapsed: number) => callback(elapsed);
    ipcRenderer.on(ch.RECORDING_TIMER, handler);
    return () => ipcRenderer.removeListener(ch.RECORDING_TIMER, handler);
  },
  onRecordingError: (callback: (error: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on(ch.RECORDING_ERROR, handler);
    return () => ipcRenderer.removeListener(ch.RECORDING_ERROR, handler);
  },

  // Transcription
  transcriptionStart: (sessionId: string, options: unknown) => ipcRenderer.invoke(ch.TRANSCRIPTION_START, sessionId, options),
  transcriptionCancel: () => ipcRenderer.invoke(ch.TRANSCRIPTION_CANCEL),

  onTranscriptionProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
    ipcRenderer.on(ch.TRANSCRIPTION_PROGRESS, handler);
    return () => ipcRenderer.removeListener(ch.TRANSCRIPTION_PROGRESS, handler);
  },
  onTranscriptionComplete: (callback: (result: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: unknown) => callback(result);
    ipcRenderer.on(ch.TRANSCRIPTION_COMPLETE, handler);
    return () => ipcRenderer.removeListener(ch.TRANSCRIPTION_COMPLETE, handler);
  },
  onTranscriptionError: (callback: (error: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on(ch.TRANSCRIPTION_ERROR, handler);
    return () => ipcRenderer.removeListener(ch.TRANSCRIPTION_ERROR, handler);
  },

  // Sessions
  sessionsList: () => ipcRenderer.invoke(ch.SESSIONS_LIST),
  sessionsGet: (sessionId: string) => ipcRenderer.invoke(ch.SESSIONS_GET, sessionId),
  sessionsExport: (sessionId: string, transcriptFile: string) => ipcRenderer.invoke(ch.SESSIONS_EXPORT, sessionId, transcriptFile),
  sessionsOpenFolder: (sessionId: string) => ipcRenderer.invoke(ch.SESSIONS_OPEN_FOLDER, sessionId),
  sessionsDelete: (sessionId: string) => ipcRenderer.invoke(ch.SESSIONS_DELETE, sessionId),
  sessionsGetIncomplete: () => ipcRenderer.invoke(ch.SESSIONS_GET_INCOMPLETE),
  sessionsFinalize: (sessionId: string) => ipcRenderer.invoke(ch.SESSIONS_FINALIZE, sessionId),
  sessionsReadTranscript: (sessionId: string, filename: string) => ipcRenderer.invoke(ch.SESSIONS_READ_TRANSCRIPT, sessionId, filename),

  // Models
  modelsList: () => ipcRenderer.invoke(ch.MODELS_LIST),
  modelsDownload: (modelId: string) => ipcRenderer.invoke(ch.MODELS_DOWNLOAD, modelId),
  modelsCancelDownload: () => ipcRenderer.invoke(ch.MODELS_CANCEL_DOWNLOAD),
  modelsDelete: (modelId: string) => ipcRenderer.invoke(ch.MODELS_DELETE, modelId),

  onModelsDownloadProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
    ipcRenderer.on(ch.MODELS_DOWNLOAD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(ch.MODELS_DOWNLOAD_PROGRESS, handler);
  },

  // Binaries
  binariesStatus: () => ipcRenderer.invoke(ch.BINARIES_STATUS),
  binariesDownload: () => ipcRenderer.invoke(ch.BINARIES_DOWNLOAD),
  onBinariesProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
    ipcRenderer.on(ch.BINARIES_PROGRESS, handler);
    return () => ipcRenderer.removeListener(ch.BINARIES_PROGRESS, handler);
  },

  // App
  selectDirectory: () => ipcRenderer.invoke(ch.APP_SELECT_DIRECTORY),
  getVersion: () => ipcRenderer.invoke(ch.APP_GET_VERSION),
  openExternal: (url: string) => ipcRenderer.invoke(ch.APP_OPEN_EXTERNAL, url),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
