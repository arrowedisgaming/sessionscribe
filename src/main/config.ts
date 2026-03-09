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

import { app, safeStorage } from 'electron';
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

const ENCRYPTED_PREFIX = 'enc:';

function encryptToken(plaintext: string): string {
  if (!plaintext || !safeStorage.isEncryptionAvailable()) return plaintext;
  const encrypted = safeStorage.encryptString(plaintext);
  return ENCRYPTED_PREFIX + encrypted.toString('base64');
}

function decryptToken(stored: string): string {
  if (!stored || !stored.startsWith(ENCRYPTED_PREFIX)) return stored;
  const buf = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64');
  return safeStorage.decryptString(buf);
}

function migrateTokenIfNeeded(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      'Token encryption unavailable — Discord token stored as plaintext.',
      process.platform === 'linux'
        ? 'Install libsecret (gnome-keyring or kwallet) to enable encryption.'
        : ''
    );
    return;
  }
  const stored = rawStore.get('discordToken') as string;
  if (stored && !stored.startsWith(ENCRYPTED_PREFIX)) {
    rawStore.set('discordToken', encryptToken(stored));
  }
}

const typedStore = rawStore as TypedStore<AppConfig>;

// Wrap config to transparently encrypt/decrypt the token
export const config: TypedStore<AppConfig> = {
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    const value = typedStore.get(key);
    if (key === 'discordToken' && typeof value === 'string') {
      return decryptToken(value) as AppConfig[K];
    }
    return value;
  },
  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    if (key === 'discordToken' && typeof value === 'string') {
      typedStore.set(key, encryptToken(value) as AppConfig[K]);
    } else {
      typedStore.set(key, value);
    }
  },
  get store(): AppConfig {
    const raw = typedStore.store;
    return {
      ...raw,
      discordToken: decryptToken(raw.discordToken),
    };
  },
  has: (key) => typedStore.has(key),
  delete: (key) => typedStore.delete(key),
  clear: () => typedStore.clear(),
};

// Migrate plaintext tokens on module load (app must be ready)
app.whenReady().then(migrateTokenIfNeeded);
