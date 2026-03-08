/**
 * Session Scribe — Configuration Store
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

import { app } from 'electron';
import path from 'path';

export interface Campaign {
  id: string;
  name: string;
  vocabularyHints: string[];
}

export interface AppConfig {
  discordToken: string;
  outputDir: string;
  transcriptionEngine: 'whisper-cpp' | 'transformers-js';
  whisperModel: string;
  campaigns: Campaign[];
  displayNameOverrides: Record<string, string>;
  maxDurationMinutes: number;
  isFirstRun: boolean;
  autoTranscribe: boolean;
}

// electron-store v11 is ESM-only; require() wraps it with __esModule flag
// eslint-disable-next-line @typescript-eslint/no-var-requires
const StoreModule = require('electron-store');
const Store = StoreModule.default || StoreModule;

const defaults: AppConfig = {
  discordToken: '',
  outputDir: path.join(app.getPath('documents'), 'SessionScribe'),
  transcriptionEngine: 'whisper-cpp',
  whisperModel: 'base',
  campaigns: [],
  displayNameOverrides: {},
  maxDurationMinutes: 480,
  isFirstRun: true,
  autoTranscribe: false,
};

interface TypedStore<T> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  store: T;
  has(key: keyof T): boolean;
  delete(key: keyof T): void;
  clear(): void;
}

const rawStore = new Store({
  name: 'session-scribe-config',
  defaults,
});

export const config = rawStore as TypedStore<AppConfig>;
