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

const SAMPLE_RATE = 48000;
const CHANNELS = 1;

export class AudioProcessor {
  private ffmpegPath: string;

  constructor() {
    this.ffmpegPath = resolveBinaryPath('ffmpeg');
  }

  async pcmToFlac(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, [
        '-f', 's16le',
        '-ar', String(SAMPLE_RATE),
        '-ac', String(CHANNELS),
        '-i', inputPath,
        '-y',
        outputPath,
      ]);

      let stderr = '';
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      });

      proc.on('error', (err) => {
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
      const fs = require('fs');
      fs.copyFileSync(inputPaths[0], outputPath);
      return;
    }

    return new Promise((resolve, reject) => {
      const inputs: string[] = [];
      inputPaths.forEach((p) => {
        inputs.push('-i', p);
      });

      const filterComplex = `amix=inputs=${inputPaths.length}:duration=longest`;

      const proc = spawn(this.ffmpegPath, [
        ...inputs,
        '-filter_complex', filterComplex,
        '-y',
        outputPath,
      ]);

      let stderr = '';
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg mix exited with code ${code}: ${stderr}`));
      });

      proc.on('error', (err) => {
        reject(new Error(`ffmpeg spawn error: ${err.message}`));
      });
    });
  }
}
