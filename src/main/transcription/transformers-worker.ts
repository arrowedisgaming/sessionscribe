/**
 * Session Scribe — transformers.js Worker Thread
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import { parentPort, workerData } from 'worker_threads';

interface WorkerMessage {
  type: 'transcribe';
  audioPath: string;
  modelId: string;
  language?: string;
  cacheDir: string;
}

interface TranscriptionResult {
  chunks: Array<{ timestamp: [number, number]; text: string }>;
}

async function run() {
  const { pipeline, env } = await import('@huggingface/transformers');

  const msg = workerData as WorkerMessage;
  env.cacheDir = msg.cacheDir;

  parentPort?.postMessage({ type: 'status', message: 'Loading model...' });

  const transcriber = await pipeline(
    'automatic-speech-recognition',
    `Xenova/whisper-${msg.modelId}`,
    { dtype: 'fp32' }
  );

  parentPort?.postMessage({ type: 'status', message: 'Transcribing...' });

  const result = await transcriber(msg.audioPath, {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    language: msg.language || 'english',
  }) as TranscriptionResult;

  const segments = (result.chunks || []).map(
    (chunk: { timestamp: [number, number]; text: string }) => ({
      start: chunk.timestamp[0],
      end: chunk.timestamp[1],
      text: chunk.text.trim(),
    })
  );

  parentPort?.postMessage({ type: 'result', segments });
}

run().catch((err) => {
  parentPort?.postMessage({ type: 'error', error: err.message });
});
