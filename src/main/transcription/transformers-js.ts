/**
 * Session Scribe — transformers.js Transcription Engine
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import path from 'path';
import { Worker } from 'worker_threads';
import { app } from 'electron';
import { TranscriptionEngine, TranscriptionSegment, TranscriptionOptions } from './engine';
import { config } from '../config';

export class TransformersJsEngine implements TranscriptionEngine {
  name = 'transformers-js';

  async isAvailable(): Promise<boolean> {
    return true; // Always available — downloads models on first use
  }

  async transcribe(
    audioPath: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionSegment[]> {
    const modelId = config.get('whisperModel') || 'base';
    const cacheDir = path.join(app.getPath('userData'), 'models', 'transformers');

    return new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, 'transformers-worker.js');

      const worker = new Worker(workerPath, {
        workerData: {
          type: 'transcribe',
          audioPath,
          modelId,
          language: options.language,
          cacheDir,
        },
      });

      worker.on('message', (msg: { type: string; segments?: TranscriptionSegment[]; error?: string }) => {
        if (msg.type === 'result') {
          resolve(msg.segments || []);
          worker.terminate();
        } else if (msg.type === 'error') {
          reject(new Error(msg.error));
          worker.terminate();
        }
      });

      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
      });
    });
  }
}
