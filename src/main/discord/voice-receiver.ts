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

  start(connection: VoiceConnection): void {
    this.connection = connection;
    this.sessionStartTime = Date.now();
    this.streams.clear();

    const receiver = connection.receiver;

    receiver.speaking.on('start', (userId: string) => {
      if (!this.streams.has(userId)) {
        this.setupUserStream(userId);
      }

      const userStream = this.streams.get(userId)!;

      // If an opus stream is already active, skip — listeners are already attached
      if (userStream.activeOpusStream) return;

      const now = Date.now();

      // Insert silence frames for the gap since last packet
      if (userStream.lastPacketTimestamp > 0) {
        const gapMs = now - userStream.lastPacketTimestamp;
        const silenceFrames = Math.floor(gapMs / FRAME_DURATION_MS);
        for (let i = 0; i < silenceFrames; i++) {
          userStream.pcmChunks.push(Buffer.from(SILENCE_FRAME));
        }
      } else {
        // First speech: insert silence from session start to now
        const gapMs = now - this.sessionStartTime;
        const silenceFrames = Math.floor(gapMs / FRAME_DURATION_MS);
        for (let i = 0; i < silenceFrames; i++) {
          userStream.pcmChunks.push(Buffer.from(SILENCE_FRAME));
        }
      }

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
    });
  }

  stop(): Map<string, Buffer[]> {
    const result = new Map<string, Buffer[]>();

    // Fill silence to end for all users
    const now = Date.now();
    for (const [userId, stream] of this.streams) {
      if (stream.lastPacketTimestamp > 0) {
        const gapMs = now - stream.lastPacketTimestamp;
        const silenceFrames = Math.floor(gapMs / FRAME_DURATION_MS);
        for (let i = 0; i < silenceFrames; i++) {
          stream.pcmChunks.push(Buffer.from(SILENCE_FRAME));
        }
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
