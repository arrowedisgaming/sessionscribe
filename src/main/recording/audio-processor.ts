/**
 * Session Scribe — Audio Processor
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
import path from 'path';
import { resolveBinaryPath } from './binary-resolver';
import { processTracker } from '../utils/process-tracker';

const SAMPLE_RATE = 48000;
const CHANNELS = 1;

export class AudioProcessor {
  private ffmpegPath: string | null = null;

  private getFfmpegPath(): string {
    if (!this.ffmpegPath) {
      this.ffmpegPath = resolveBinaryPath('ffmpeg');
    }
    return this.ffmpegPath;
  }

  async pcmToFlac(inputPath: string, outputPath: string): Promise<void> {
    const TIMEOUT = 5 * 60_000; // 5 minutes
    const MAX_STDERR = 10240;   // 10KB

    return new Promise((resolve, reject) => {
      const proc = spawn(this.getFfmpegPath(), [
        '-f', 's16le',
        '-ar', String(SAMPLE_RATE),
        '-ac', String(CHANNELS),
        '-i', inputPath,
        '-y',
        outputPath,
      ]);
      processTracker.track(proc);

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > MAX_STDERR) stderr = stderr.slice(-MAX_STDERR);
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`ffmpeg timed out after ${TIMEOUT / 1000}s`));
      }, TIMEOUT);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`ffmpeg spawn error: ${err.message}`));
      });
    });
  }

  async createMasterMix(
    inputPaths: string[],
    outputPath: string
  ): Promise<void> {
    if (inputPaths.length === 0) return;
    if (inputPaths.length === 1) {
      // Just copy the single file
      const fsp = require('fs/promises');
      await fsp.copyFile(inputPaths[0], outputPath);
      return;
    }

    const TIMEOUT = 5 * 60_000;
    const MAX_STDERR = 10240;

    return new Promise((resolve, reject) => {
      const inputs: string[] = [];
      inputPaths.forEach((p) => {
        inputs.push('-i', p);
      });

      const filterComplex = `amix=inputs=${inputPaths.length}:duration=longest`;

      const proc = spawn(this.getFfmpegPath(), [
        ...inputs,
        '-filter_complex', filterComplex,
        '-y',
        outputPath,
      ]);
      processTracker.track(proc);

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > MAX_STDERR) stderr = stderr.slice(-MAX_STDERR);
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`ffmpeg mix timed out after ${TIMEOUT / 1000}s`));
      }, TIMEOUT);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg mix exited with code ${code}: ${stderr}`));
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`ffmpeg spawn error: ${err.message}`));
      });
    });
  }
}
