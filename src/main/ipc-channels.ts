/**
 * Session Scribe — IPC Channel Constants
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

// Config
export const CONFIG_GET = 'config:get';
export const CONFIG_SET = 'config:set';
export const CONFIG_GET_ALL = 'config:get-all';

// Discord
export const DISCORD_TEST_TOKEN = 'discord:test-token';
export const DISCORD_CONNECT = 'discord:connect';
export const DISCORD_DISCONNECT = 'discord:disconnect';
export const DISCORD_GET_GUILDS = 'discord:get-guilds';
export const DISCORD_GET_VOICE_CHANNELS = 'discord:get-voice-channels';
export const DISCORD_JOIN_CHANNEL = 'discord:join-channel';
export const DISCORD_LEAVE_CHANNEL = 'discord:leave-channel';
export const DISCORD_STATUS_CHANGED = 'discord:status-changed';
export const DISCORD_USER_JOINED = 'discord:user-joined';
export const DISCORD_USER_LEFT = 'discord:user-left';
export const DISCORD_USERS_UPDATED = 'discord:users-updated';

// Recording
export const RECORDING_START = 'recording:start';
export const RECORDING_STOP = 'recording:stop';
export const RECORDING_STATUS = 'recording:status';
export const RECORDING_TIMER = 'recording:timer';
export const RECORDING_ERROR = 'recording:error';

// Transcription
export const TRANSCRIPTION_START = 'transcription:start';
export const TRANSCRIPTION_CANCEL = 'transcription:cancel';
export const TRANSCRIPTION_PROGRESS = 'transcription:progress';
export const TRANSCRIPTION_COMPLETE = 'transcription:complete';
export const TRANSCRIPTION_ERROR = 'transcription:error';

// Sessions
export const SESSIONS_LIST = 'sessions:list';
export const SESSIONS_GET = 'sessions:get';
export const SESSIONS_EXPORT = 'sessions:export';
export const SESSIONS_OPEN_FOLDER = 'sessions:open-folder';
export const SESSIONS_DELETE = 'sessions:delete';
export const SESSIONS_GET_INCOMPLETE = 'sessions:get-incomplete';
export const SESSIONS_FINALIZE = 'sessions:finalize';
export const SESSIONS_READ_TRANSCRIPT = 'sessions:read-transcript';

// Models
export const MODELS_LIST = 'models:list';
export const MODELS_DOWNLOAD = 'models:download';
export const MODELS_CANCEL_DOWNLOAD = 'models:cancel-download';
export const MODELS_DELETE = 'models:delete';
export const MODELS_DOWNLOAD_PROGRESS = 'models:download-progress';

// App
export const APP_SELECT_DIRECTORY = 'app:select-directory';
export const APP_GET_VERSION = 'app:get-version';
export const APP_OPEN_EXTERNAL = 'app:open-external';

// Binaries
export const BINARIES_STATUS = 'binaries:status';
export const BINARIES_DOWNLOAD = 'binaries:download';
export const BINARIES_PROGRESS = 'binaries:progress';
