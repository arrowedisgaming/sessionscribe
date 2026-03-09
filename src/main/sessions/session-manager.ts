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
  private getOutputDir(): string {
    return config.get('outputDir');
  }

  createSession(
    guildName: string,
    channelName: string,
    campaign?: string
  ): SessionMetadata {
    const now = new Date();
    const id = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sessionDir = path.join(this.getOutputDir(), id);

    fs.mkdirSync(sessionDir, { recursive: true });
    fs.mkdirSync(path.join(sessionDir, 'audio'), { recursive: true });

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

    this.writeMetadata(metadata);
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

  readMetadata(sessionId: string): SessionMetadata | null {
    const metaPath = path.join(this.getSessionDir(sessionId), 'session.json');
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }

  writeMetadata(metadata: SessionMetadata): void {
    const metaPath = path.join(
      this.getSessionDir(metadata.id),
      'session.json'
    );
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  listSessions(): SessionMetadata[] {
    const outputDir = this.getOutputDir();
    if (!fs.existsSync(outputDir)) return [];

    const entries = fs.readdirSync(outputDir, { withFileTypes: true });
    const sessions: SessionMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = this.readMetadata(entry.name);
      if (meta) sessions.push(meta);
    }

    return sessions.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  getIncompleteSessions(): SessionMetadata[] {
    return this.listSessions().filter((s) => s.status === 'incomplete');
  }

  deleteSession(sessionId: string): void {
    this.validateSessionId(sessionId);
    const sessionDir = this.getSessionDir(sessionId);
    if (!fs.existsSync(sessionDir)) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  finalizeSession(sessionId: string): void {
    this.validateSessionId(sessionId);
    const metadata = this.readMetadata(sessionId);
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
    this.writeMetadata(metadata);
  }
}

export const sessionManager = new SessionManager();
