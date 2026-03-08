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
import path from 'path';
import { EventEmitter } from 'events';
import { VoiceConnection } from '@discordjs/voice';
import { VoiceStreamManager } from '../discord/voice-receiver';
import { AudioProcessor } from './audio-processor';
import { sessionManager, SessionMetadata, UserTrack } from '../sessions/session-manager';
import { discordConnection, ConnectedUserInfo } from '../discord/connection';

const FLUSH_INTERVAL_MS = 30_000;

export interface RecordingOptions {
  campaign?: string;
}

export class SessionRecorder extends EventEmitter {
  private voiceStreams: VoiceStreamManager | null = null;
  private audioProcessor = new AudioProcessor();
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

    const guildId = discordConnection.getCurrentGuildId();
    const guild = discordConnection.getClient()?.guilds.cache.get(guildId!);
    const channelId = discordConnection.getCurrentChannelId();
    const channel = guild?.channels.cache.get(channelId!);

    this.session = sessionManager.createSession(
      guild?.name || 'Unknown',
      channel?.name || 'Unknown',
      options.campaign
    );

    this.voiceStreams = new VoiceStreamManager();
    this.voiceStreams.start(connection);
    this.isRecording = true;
    this.startTime = Date.now();

    // Flush PCM to disk periodically
    this.flushTimer = setInterval(() => this.flushToDisk(), FLUSH_INTERVAL_MS);

    // Emit elapsed time every second
    this.elapsedTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      this.emit('timer', elapsed);
    }, 1000);

    this.emit('started', this.session);
    return this.session;
  }

  async stop(): Promise<SessionMetadata> {
    if (!this.isRecording || !this.voiceStreams || !this.session) {
      throw new Error('Not recording');
    }

    this.isRecording = false;

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

    for (const [userId, chunks] of pcmData) {
      if (chunks.length === 0) continue;

      const rawPath = path.join(audioDir, `${userId}.raw`);
      const flacPath = path.join(audioDir, `${userId}.flac`);

      // Append remaining PCM chunks (flushToDisk may have already written earlier data)
      const pcmBuffer = Buffer.concat(chunks);
      if (fs.existsSync(rawPath)) {
        fs.appendFileSync(rawPath, pcmBuffer);
      } else {
        fs.writeFileSync(rawPath, pcmBuffer);
      }

      // Convert to FLAC
      try {
        await this.audioProcessor.pcmToFlac(rawPath, flacPath);
        // Remove raw file after successful FLAC conversion
        fs.unlinkSync(rawPath);
      } catch (err) {
        console.error(`FLAC conversion failed for ${userId}:`, err);
        // Keep raw file if FLAC conversion fails
      }

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
    sessionManager.writeMetadata(this.session);

    const completedSession = { ...this.session };
    this.emit('stopped', completedSession);

    this.session = null;
    this.voiceStreams = null;
    return completedSession;
  }

  private flushToDisk(): void {
    if (!this.voiceStreams || !this.session) return;

    const audioDir = sessionManager.getAudioDir(this.session.id);
    const userIds = this.voiceStreams.getActiveUserIds();

    for (const userId of userIds) {
      const chunks = this.voiceStreams.getUserPcmChunks(userId);
      if (chunks.length === 0) continue;

      const rawPath = path.join(audioDir, `${userId}.raw`);
      const pcmBuffer = Buffer.concat(chunks);

      // Append to existing file
      fs.appendFileSync(rawPath, pcmBuffer);

      // Clear chunks after flushing (but keep array reference)
      chunks.length = 0;
    }
  }
}

export const sessionRecorder = new SessionRecorder();
