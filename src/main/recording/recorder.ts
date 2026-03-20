/**
 * Session Scribe — Session Recorder
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
import { EventEmitter } from 'events';
import { VoiceConnection } from '@discordjs/voice';
import { VoiceStreamManager } from '../discord/voice-receiver';
import { AudioProcessor } from './audio-processor';
import { DiskMonitor } from './disk-monitor';
import { sessionManager, SessionMetadata, UserTrack } from '../sessions/session-manager';
import { discordConnection, ConnectedUserInfo } from '../discord/connection';

const MIN_DISK_SPACE = 500 * 1024 * 1024; // 500 MB

const FLUSH_INTERVAL_MS = 30_000;

export interface RecordingOptions {
  campaign?: string;
}

export class SessionRecorder extends EventEmitter {
  private voiceStreams: VoiceStreamManager | null = null;
  private audioProcessor = new AudioProcessor();
  private diskMonitor: DiskMonitor | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private elapsedTimer: NodeJS.Timeout | null = null;
  private session: SessionMetadata | null = null;
  private isRecording = false;
  private startTime = 0;

  get recording(): boolean {
    return this.isRecording;
  }

  get currentSession(): SessionMetadata | null {
    return this.session;
  }

  async start(
    connection: VoiceConnection,
    options: RecordingOptions = {}
  ): Promise<SessionMetadata> {
    if (this.isRecording) throw new Error('Already recording');

    // Pre-flight disk space check
    const outputDir = sessionManager.getOutputDir();
    try {
      const stats = fs.statfsSync(outputDir);
      const freeBytes = stats.bavail * stats.bsize;
      if (freeBytes < MIN_DISK_SPACE) {
        throw new Error(`Insufficient disk space: ${Math.round(freeBytes / 1024 / 1024)}MB free, need at least 500MB`);
      }
    } catch (err) {
      if ((err as Error).message.includes('Insufficient disk space')) throw err;
      // statfsSync may fail on some platforms; don't block recording
    }

    const guildId = discordConnection.getCurrentGuildId();
    const guild = discordConnection.getClient()?.guilds.cache.get(guildId!);
    const channelId = discordConnection.getCurrentChannelId();
    const channel = guild?.channels.cache.get(channelId!);

    this.session = await sessionManager.createSession(
      guild?.name || 'Unknown',
      channel?.name || 'Unknown',
      options.campaign
    );

    this.voiceStreams = new VoiceStreamManager();
    const audioDir = sessionManager.getAudioDir(this.session.id);
    this.voiceStreams.start(connection, audioDir);
    this.isRecording = true;
    this.startTime = Date.now();

    // Monitor disk space during recording
    this.diskMonitor = new DiskMonitor(outputDir);
    this.diskMonitor.on('critical', (freeBytes: number) => {
      console.error(`[DiskMonitor] Critical: only ${Math.round(freeBytes / 1024 / 1024)}MB free, stopping recording`);
      this.emit('diskCritical', freeBytes);
      this.stop().catch((err) => console.error('Failed to stop recording on disk critical:', err));
    });
    this.diskMonitor.on('warning', (freeBytes: number) => {
      this.emit('diskWarning', freeBytes);
    });
    this.diskMonitor.start();

    // Flush PCM to disk periodically
    this.flushTimer = setInterval(() => this.flushToDisk(), FLUSH_INTERVAL_MS);

    // Emit elapsed time every 5 seconds (reduce IPC overhead)
    this.elapsedTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      this.emit('timer', elapsed);
    }, 5000);

    this.emit('started', this.session);
    return this.session;
  }

  async stop(): Promise<SessionMetadata> {
    if (!this.isRecording || !this.voiceStreams || !this.session) {
      throw new Error('Not recording');
    }

    this.isRecording = false;

    if (this.diskMonitor) {
      this.diskMonitor.stop();
      this.diskMonitor = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }

    const pcmData = this.voiceStreams.stop();
    const duration = Math.floor((Date.now() - this.startTime) / 1000);

    // Write raw PCM files
    const audioDir = sessionManager.getAudioDir(this.session.id);
    const userTracks: UserTrack[] = [];
    const connectedUsers = discordConnection.getConnectedUsers();
    const flacPaths: string[] = [];

    // Step 1: Write all remaining PCM data to disk
    const pendingConversions: { userId: string; rawPath: string; flacPath: string }[] = [];
    for (const [userId, chunks] of pcmData) {
      if (chunks.length === 0) continue;

      const rawPath = path.join(audioDir, `${userId}.raw`);
      const flacPath = path.join(audioDir, `${userId}.flac`);

      const pcmBuffer = Buffer.concat(chunks);
      try {
        await fsp.access(rawPath);
        await fsp.appendFile(rawPath, pcmBuffer);
      } catch {
        await fsp.writeFile(rawPath, pcmBuffer);
      }

      pendingConversions.push({ userId, rawPath, flacPath });
    }

    // Step 2: Convert PCM to FLAC in parallel batches of 3
    const BATCH_SIZE = 3;
    for (let i = 0; i < pendingConversions.length; i += BATCH_SIZE) {
      const batch = pendingConversions.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async ({ userId, rawPath, flacPath }) => {
        try {
          await this.audioProcessor.pcmToFlac(rawPath, flacPath);
          await fsp.unlink(rawPath);
        } catch (err) {
          console.error(`FLAC conversion failed for ${userId}:`, err);
        }
      }));
    }

    // Step 3: Build user tracks and collect FLAC paths
    for (const { userId, rawPath, flacPath } of pendingConversions) {
      const userInfo = connectedUsers.find((u: ConnectedUserInfo) => u.id === userId);
      userTracks.push({
        userId,
        username: userInfo?.username || userId,
        displayName: userInfo?.displayName || userId,
        rawFile: fs.existsSync(rawPath) ? `${userId}.raw` : undefined,
        flacFile: fs.existsSync(flacPath) ? `${userId}.flac` : undefined,
        durationSeconds: duration,
      });

      if (fs.existsSync(flacPath)) {
        flacPaths.push(flacPath);
      }
    }

    // Create master mix
    if (flacPaths.length > 0) {
      try {
        const masterPath = path.join(audioDir, 'master.flac');
        await this.audioProcessor.createMasterMix(flacPaths, masterPath);
      } catch (err) {
        console.error('Master mix failed:', err);
      }
    }

    // Update session metadata
    this.session.stoppedAt = new Date().toISOString();
    this.session.durationSeconds = duration;
    this.session.status = 'recorded';
    this.session.users = userTracks;
    await sessionManager.writeMetadata(this.session);

    const completedSession = { ...this.session };
    this.emit('stopped', completedSession);

    this.session = null;
    this.voiceStreams = null;
    return completedSession;
  }

  private async flushToDisk(): Promise<void> {
    if (!this.voiceStreams || !this.session) return;

    const audioDir = sessionManager.getAudioDir(this.session.id);
    const userIds = this.voiceStreams.getActiveUserIds();

    for (const userId of userIds) {
      const chunks = this.voiceStreams.getUserPcmChunks(userId);
      if (chunks.length === 0) continue;

      const rawPath = path.join(audioDir, `${userId}.raw`);
      const pcmBuffer = Buffer.concat(chunks);

      // Append to existing file
      await fsp.appendFile(rawPath, pcmBuffer);

      // Clear chunks after flushing (but keep array reference)
      chunks.length = 0;
    }
  }
}

export const sessionRecorder = new SessionRecorder();
