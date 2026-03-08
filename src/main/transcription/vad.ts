/**
 * Session Scribe — Silero VAD (Voice Activity Detection)
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

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolveBinaryPath } from '../recording/binary-resolver';

export interface SpeechSegment {
  start: number; // seconds
  end: number;   // seconds
}

const MIN_SPEECH_DURATION = 0.5;  // seconds
const MERGE_GAP = 0.3;           // seconds
const CHUNK_TARGET = 30;         // seconds — batch segments into ~30s chunks

/**
 * Simple energy-based VAD as a fallback when Silero ONNX isn't available.
 * Reads raw PCM (s16le, mono) and identifies speech segments based on RMS energy.
 */
export async function detectSpeechSegments(audioPath: string): Promise<SpeechSegment[]> {
  // Read audio file and compute RMS energy per frame
  const SAMPLE_RATE = 48000;
  const FRAME_SIZE = SAMPLE_RATE * 0.02; // 20ms frames
  const FRAME_BYTES = FRAME_SIZE * 2;    // 16-bit samples

  let buffer: Buffer;
  try {
    // If FLAC, convert to raw PCM first via ffmpeg
    if (audioPath.endsWith('.flac') || audioPath.endsWith('.wav')) {
      const rawPath = audioPath + '.vad.raw';
      const ffmpeg = resolveBinaryPath('ffmpeg');
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpeg, [
          '-i', audioPath,
          '-f', 's16le', '-ar', '16000', '-ac', '1',
          '-y', rawPath,
        ]);
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
        proc.on('error', reject);
      });
      buffer = fs.readFileSync(rawPath);
      fs.unlinkSync(rawPath);
      // Adjust for 16kHz
      const frameSize16k = 16000 * 0.02;
      const frameBytes16k = frameSize16k * 2;
      return computeSegments(buffer, frameBytes16k, 16000);
    } else {
      buffer = fs.readFileSync(audioPath);
      return computeSegments(buffer, FRAME_BYTES, SAMPLE_RATE);
    }
  } catch (err) {
    console.error('VAD failed, returning whole file as single segment:', err);
    // Fallback: treat entire file as speech
    const stats = fs.statSync(audioPath);
    const durationSeconds = stats.size / (48000 * 2); // rough estimate
    return [{ start: 0, end: durationSeconds }];
  }
}

function computeSegments(buffer: Buffer, frameBytes: number, sampleRate: number): SpeechSegment[] {
  const frameDuration = frameBytes / (sampleRate * 2);
  const totalFrames = Math.floor(buffer.length / frameBytes);
  const energies: number[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const offset = i * frameBytes;
    let sumSquares = 0;
    const numSamples = frameBytes / 2;
    for (let j = 0; j < numSamples; j++) {
      const sample = buffer.readInt16LE(offset + j * 2);
      sumSquares += sample * sample;
    }
    energies.push(Math.sqrt(sumSquares / numSamples));
  }

  // Dynamic threshold: mean energy * 0.3
  const meanEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
  const threshold = meanEnergy * 0.3;

  // Find speech frames
  const speechFrames = energies.map((e) => e > threshold);

  // Convert to segments
  const rawSegments: SpeechSegment[] = [];
  let inSpeech = false;
  let segStart = 0;

  for (let i = 0; i < speechFrames.length; i++) {
    if (speechFrames[i] && !inSpeech) {
      inSpeech = true;
      segStart = i * frameDuration;
    } else if (!speechFrames[i] && inSpeech) {
      inSpeech = false;
      const segEnd = i * frameDuration;
      rawSegments.push({ start: segStart, end: segEnd });
    }
  }
  if (inSpeech) {
    rawSegments.push({ start: segStart, end: totalFrames * frameDuration });
  }

  // Merge close segments and filter short ones
  const merged: SpeechSegment[] = [];
  for (const seg of rawSegments) {
    if (merged.length > 0 && seg.start - merged[merged.length - 1].end < MERGE_GAP) {
      merged[merged.length - 1].end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.filter((s) => s.end - s.start >= MIN_SPEECH_DURATION);
}

/**
 * Batch speech segments into ~30s chunks for efficient whisper.cpp processing.
 */
export function batchSegments(segments: SpeechSegment[]): SpeechSegment[] {
  if (segments.length === 0) return [];

  const batches: SpeechSegment[] = [];
  let currentBatch: SpeechSegment = { start: segments[0].start, end: segments[0].end };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const currentDuration = currentBatch.end - currentBatch.start;

    if (currentDuration + (seg.end - seg.start) <= CHUNK_TARGET) {
      // Extend current batch (including the gap)
      currentBatch.end = seg.end;
    } else {
      batches.push(currentBatch);
      currentBatch = { start: seg.start, end: seg.end };
    }
  }
  batches.push(currentBatch);

  return batches;
}
