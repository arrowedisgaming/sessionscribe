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

    const TIMEOUT = 10 * 60_000; // 10 minutes

    return new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, 'transformers-worker.js');
      let settled = false;

      const worker = new Worker(workerPath, {
        workerData: {
          type: 'transcribe',
          audioPath,
          modelId,
          language: options.language,
          cacheDir,
        },
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          worker.terminate();
          reject(new Error(`transformers.js worker timed out after ${TIMEOUT / 1000}s`));
        }
      }, TIMEOUT);

      worker.on('message', (msg: { type: string; segments?: TranscriptionSegment[]; error?: string }) => {
        if (settled) return;
        if (msg.type === 'result') {
          settled = true;
          clearTimeout(timer);
          resolve(msg.segments || []);
          worker.terminate();
        } else if (msg.type === 'error') {
          settled = true;
          clearTimeout(timer);
          reject(new Error(msg.error));
          worker.terminate();
        }
      });

      worker.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
      worker.on('exit', (code) => {
        if (!settled && code !== 0) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Worker exited with code ${code}`));
        }
      });
    });
  }
}
