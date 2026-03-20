/**
 * Session Scribe — Session Manager
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

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { config } from '../config';

export interface UserTrack {
  userId: string;
  username: string;
  displayName: string;
  rawFile?: string;
  flacFile?: string;
  durationSeconds?: number;
}

export type SessionStatus = 'recording' | 'recorded' | 'transcribing' | 'complete' | 'incomplete' | 'error';

export interface TranscriptInfo {
  engine: string;
  model: string;
  filename: string;
  createdAt: string;
}

export interface SessionMetadata {
  id: string;
  campaign?: string;
  guildName: string;
  channelName: string;
  startedAt: string;
  stoppedAt?: string;
  durationSeconds?: number;
  status: SessionStatus;
  users: UserTrack[];
  transcripts: TranscriptInfo[];
  error?: string;
}

export class SessionManager {
  getOutputDir(): string {
    return config.get('outputDir');
  }

  async createSession(
    guildName: string,
    channelName: string,
    campaign?: string
  ): Promise<SessionMetadata> {
    const now = new Date();
    const id = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sessionDir = path.join(this.getOutputDir(), id);

    await fsp.mkdir(sessionDir, { recursive: true });
    await fsp.mkdir(path.join(sessionDir, 'audio'), { recursive: true });

    const metadata: SessionMetadata = {
      id,
      campaign,
      guildName,
      channelName,
      startedAt: now.toISOString(),
      status: 'recording',
      users: [],
      transcripts: [],
    };

    await this.writeMetadata(metadata);
    return metadata;
  }

  private validateSessionId(sessionId: string): void {
    if (!/^[\w\-]+$/.test(sessionId)) {
      throw new Error('Invalid session ID');
    }
  }

  getSessionDir(sessionId: string): string {
    this.validateSessionId(sessionId);
    return path.join(this.getOutputDir(), sessionId);
  }

  getAudioDir(sessionId: string): string {
    return path.join(this.getSessionDir(sessionId), 'audio');
  }

  async readMetadata(sessionId: string): Promise<SessionMetadata | null> {
    const metaPath = path.join(this.getSessionDir(sessionId), 'session.json');
    try {
      const data = await fsp.readFile(metaPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async writeMetadata(metadata: SessionMetadata): Promise<void> {
    const metaPath = path.join(
      this.getSessionDir(metadata.id),
      'session.json'
    );
    const tmpPath = metaPath + '.tmp';
    await fsp.writeFile(tmpPath, JSON.stringify(metadata, null, 2), 'utf-8');
    await fsp.rename(tmpPath, metaPath);
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const outputDir = this.getOutputDir();
    try {
      const entries = await fsp.readdir(outputDir, { withFileTypes: true });
      const sessions: SessionMetadata[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = await this.readMetadata(entry.name);
        if (meta) sessions.push(meta);
      }

      return sessions.sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
    } catch {
      return [];
    }
  }

  async getIncompleteSessions(): Promise<SessionMetadata[]> {
    const sessions = await this.listSessions();
    return sessions.filter((s) => s.status === 'incomplete');
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.validateSessionId(sessionId);
    const sessionDir = this.getSessionDir(sessionId);
    try {
      await fsp.access(sessionDir);
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }
    await fsp.rm(sessionDir, { recursive: true, force: true });
  }

  async finalizeSession(sessionId: string): Promise<void> {
    this.validateSessionId(sessionId);
    const metadata = await this.readMetadata(sessionId);
    if (!metadata) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    metadata.status = 'recorded';
    if (!metadata.stoppedAt) {
      metadata.stoppedAt = new Date().toISOString();
    }
    if (metadata.startedAt && metadata.stoppedAt) {
      metadata.durationSeconds = Math.round(
        (new Date(metadata.stoppedAt).getTime() - new Date(metadata.startedAt).getTime()) / 1000
      );
    }
    await this.writeMetadata(metadata);
  }
}

export const sessionManager = new SessionManager();
