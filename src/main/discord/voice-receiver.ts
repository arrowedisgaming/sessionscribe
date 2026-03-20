/**
 * Session Scribe — Voice Stream Manager
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
import { VoiceConnection, EndBehaviorType } from '@discordjs/voice';
import { Readable } from 'stream';
import { EventEmitter } from 'events';
import { OpusDecoder } from './opus-decoder';

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const FRAME_DURATION_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 960
const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const SILENCE_FRAME = Buffer.alloc(SAMPLES_PER_FRAME * BYTES_PER_SAMPLE);

// Max silence to keep in memory per backfill event. Beyond this, silence is
// written directly to the raw file on disk. 5 seconds = 250 frames = ~480 KB.
const MAX_MEMORY_SILENCE_MS = 5_000;
const MAX_MEMORY_SILENCE_FRAMES = MAX_MEMORY_SILENCE_MS / FRAME_DURATION_MS;

// When spilling silence to disk, write in 30-second chunks (~2.88 MB each)
// to avoid a single massive allocation.
const SPILL_CHUNK_FRAMES = 30_000 / FRAME_DURATION_MS; // 1500 frames

export interface UserStream {
  userId: string;
  decoder: OpusDecoder;
  lastPacketTimestamp: number;
  pcmChunks: Buffer[];
  activeOpusStream: Readable | null;
}

export class VoiceStreamManager extends EventEmitter {
  private streams = new Map<string, UserStream>();
  private connection: VoiceConnection | null = null;
  private sessionStartTime = 0;
  private speakingHandler: ((userId: string) => void) | null = null;
  private audioDir: string | null = null;

  start(connection: VoiceConnection, audioDir?: string): void {
    this.connection = connection;
    this.audioDir = audioDir || null;
    this.sessionStartTime = Date.now();
    this.streams.clear();

    const receiver = connection.receiver;

    this.speakingHandler = (userId: string) => {
      if (!this.streams.has(userId)) {
        this.setupUserStream(userId);
      }

      const userStream = this.streams.get(userId)!;

      // If an opus stream is already active, skip — listeners are already attached
      if (userStream.activeOpusStream) return;

      const now = Date.now();

      // Insert silence frames for the gap since last packet (or session start)
      const gapMs = userStream.lastPacketTimestamp > 0
        ? now - userStream.lastPacketTimestamp
        : now - this.sessionStartTime;
      const silenceFrames = Math.floor(gapMs / FRAME_DURATION_MS);

      this.insertSilence(userStream, silenceFrames);

      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
      });
      userStream.activeOpusStream = opusStream;

      opusStream.on('data', (chunk: Buffer) => {
        try {
          const pcm = userStream.decoder.decode(chunk);
          userStream.pcmChunks.push(pcm);
          userStream.lastPacketTimestamp = Date.now();
        } catch (err) {
          console.error(`Opus decode error for ${userId}:`, err);
        }
      });

      opusStream.on('close', () => {
        userStream.activeOpusStream = null;
        userStream.lastPacketTimestamp = Date.now();
      });
    };

    receiver.speaking.on('start', this.speakingHandler);
  }

  stop(): Map<string, Buffer[]> {
    // Remove speaking listener to prevent leaks
    if (this.speakingHandler && this.connection) {
      this.connection.receiver.speaking.removeListener('start', this.speakingHandler);
      this.speakingHandler = null;
    }

    const result = new Map<string, Buffer[]>();

    // Fill silence to end for all users
    const now = Date.now();
    for (const [userId, stream] of this.streams) {
      if (stream.lastPacketTimestamp > 0) {
        const gapMs = now - stream.lastPacketTimestamp;
        const silenceFrames = Math.floor(gapMs / FRAME_DURATION_MS);
        this.insertSilence(stream, silenceFrames);
      }
      // Destroy any active opus stream still open
      if (stream.activeOpusStream) {
        stream.activeOpusStream.destroy();
        stream.activeOpusStream = null;
      }
      result.set(userId, stream.pcmChunks);
      stream.decoder.destroy();
    }

    this.streams.clear();
    this.connection = null;
    return result;
  }

  getUserPcmChunks(userId: string): Buffer[] {
    return this.streams.get(userId)?.pcmChunks || [];
  }

  getActiveUserIds(): string[] {
    return Array.from(this.streams.keys());
  }

  getSessionDuration(): number {
    return (Date.now() - this.sessionStartTime) / 1000;
  }

  /**
   * Insert silence frames for a gap, spilling to disk if the gap is large.
   * Keeps at most MAX_MEMORY_SILENCE_FRAMES in the pcmChunks array;
   * any excess is written directly to the raw file.
   */
  private insertSilence(userStream: UserStream, totalFrames: number): void {
    if (totalFrames <= 0) return;

    if (totalFrames <= MAX_MEMORY_SILENCE_FRAMES) {
      // Small gap — keep entirely in memory
      for (let i = 0; i < totalFrames; i++) {
        userStream.pcmChunks.push(SILENCE_FRAME);
      }
      return;
    }

    // Large gap — spill excess to disk, keep only tail in memory
    const diskFrames = totalFrames - MAX_MEMORY_SILENCE_FRAMES;
    this.spillSilenceToDisk(userStream.userId, diskFrames);

    for (let i = 0; i < MAX_MEMORY_SILENCE_FRAMES; i++) {
      userStream.pcmChunks.push(SILENCE_FRAME);
    }
  }

  /**
   * Write silence frames directly to the user's raw PCM file on disk.
   * Writes in bounded chunks to avoid large single allocations.
   */
  private spillSilenceToDisk(userId: string, frameCount: number): void {
    if (!this.audioDir) {
      // No audio dir available — fall back to in-memory (shouldn't happen in practice)
      console.warn(`[VoiceStreamManager] No audioDir set, cannot spill ${frameCount} silence frames to disk for ${userId}`);
      return;
    }

    const rawPath = path.join(this.audioDir, `${userId}.raw`);
    const bytesPerFrame = SILENCE_FRAME.length;
    let remainingFrames = frameCount;

    while (remainingFrames > 0) {
      const chunkFrames = Math.min(remainingFrames, SPILL_CHUNK_FRAMES);
      const chunkBytes = chunkFrames * bytesPerFrame;
      // Buffer.alloc fills with zeros = silence
      fs.appendFileSync(rawPath, Buffer.alloc(chunkBytes));
      remainingFrames -= chunkFrames;
    }
  }

  private setupUserStream(userId: string): void {
    const stream: UserStream = {
      userId,
      decoder: new OpusDecoder(SAMPLE_RATE, CHANNELS),
      lastPacketTimestamp: 0,
      pcmChunks: [],
      activeOpusStream: null,
    };
    this.streams.set(userId, stream);
    this.emit('userStreamStarted', userId);
  }
}
