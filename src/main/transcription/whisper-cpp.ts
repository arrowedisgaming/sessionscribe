/**
 * Session Scribe — whisper.cpp Transcription Engine
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
import os from 'os';
import { TranscriptionEngine, TranscriptionSegment, TranscriptionOptions } from './engine';
import { detectSpeechSegments, batchSegments, SpeechSegment } from './vad';
import { resolveBinaryPath } from '../recording/binary-resolver';
import { modelManager } from '../models/model-manager';
import { config } from '../config';

export class WhisperCppEngine implements TranscriptionEngine {
  name = 'whisper-cpp';

  async isAvailable(): Promise<boolean> {
    try {
      const whisperPath = resolveBinaryPath('whisper-cli');
      const modelPath = modelManager.getModelPath(config.get('whisperModel'));
      return !!whisperPath && !!modelPath;
    } catch {
      return false;
    }
  }

  async transcribe(
    audioPath: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionSegment[]> {
    const whisperPath = resolveBinaryPath('whisper-cli');
    const modelPath = options.modelPath || modelManager.getModelPath(config.get('whisperModel'));
    if (!modelPath) throw new Error('No whisper model available');

    // Step 1: Convert to 16kHz WAV (whisper.cpp requirement)
    const wavPath = audioPath.replace(/\.[^.]+$/, '.wav');
    await this.convertToWav(audioPath, wavPath);

    // Step 2: VAD — detect speech segments
    const speechSegments = await detectSpeechSegments(wavPath);
    if (speechSegments.length === 0) {
      this.cleanup(wavPath);
      return [];
    }

    // Step 3: Batch segments into ~30s chunks
    const batches = batchSegments(speechSegments);

    // Step 4: Transcribe each batch
    const allSegments: TranscriptionSegment[] = [];

    for (const batch of batches) {
      // Extract chunk via ffmpeg
      const chunkPath = path.join(os.tmpdir(), `whisper_chunk_${Date.now()}.wav`);
      await this.extractChunk(wavPath, chunkPath, batch.start, batch.end - batch.start);

      // Run whisper.cpp
      const segments = await this.runWhisper(whisperPath, modelPath, chunkPath, {
        ...options,
        offsetSeconds: batch.start,
      });

      allSegments.push(...segments);

      // Cleanup chunk
      if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
    }

    this.cleanup(wavPath);
    return allSegments;
  }

  private async convertToWav(inputPath: string, outputPath: string): Promise<void> {
    const ffmpeg = resolveBinaryPath('ffmpeg');
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, [
        '-i', inputPath,
        '-ar', '16000', '-ac', '1', '-f', 'wav',
        '-y', outputPath,
      ]);
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
      proc.on('error', reject);
    });
  }

  private async extractChunk(
    inputPath: string,
    outputPath: string,
    startSeconds: number,
    durationSeconds: number
  ): Promise<void> {
    const ffmpeg = resolveBinaryPath('ffmpeg');
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, [
        '-i', inputPath,
        '-ss', String(startSeconds),
        '-t', String(durationSeconds),
        '-ar', '16000', '-ac', '1', '-f', 'wav',
        '-y', outputPath,
      ]);
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
      proc.on('error', reject);
    });
  }

  private async runWhisper(
    whisperPath: string,
    modelPath: string,
    audioPath: string,
    options: TranscriptionOptions & { offsetSeconds?: number }
  ): Promise<TranscriptionSegment[]> {
    const outputBase = audioPath.replace(/\.[^.]+$/, '');
    const jsonPath = outputBase + '.json';

    const args = [
      '-m', modelPath,
      '-f', audioPath,
      '--output-json',
      '-of', outputBase,
      '--no-prints',
    ];

    if (options.language) {
      args.push('-l', options.language);
    }
    if (options.prompt) {
      args.push('--prompt', options.prompt);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(whisperPath, args);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`whisper-cli exit ${code}: ${stderr}`));
          return;
        }

        try {
          const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
          const offset = options.offsetSeconds || 0;

          const segments: TranscriptionSegment[] = (json.transcription || []).map(
            (seg: { timestamps: { from: string; to: string }; text: string }) => ({
              start: parseTimestamp(seg.timestamps.from) + offset,
              end: parseTimestamp(seg.timestamps.to) + offset,
              text: seg.text.trim(),
            })
          );

          // Cleanup output files
          if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);

          resolve(segments.filter((s) => s.text.length > 0));
        } catch (err) {
          reject(new Error(`Failed to parse whisper output: ${(err as Error).message}`));
        }
      });
    });
  }

  private cleanup(wavPath: string): void {
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
  }
}

function parseTimestamp(ts: string): number {
  // Format: "00:00:00.000" or "HH:MM:SS.mmm"
  const parts = ts.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  }
  return parseFloat(ts);
}
