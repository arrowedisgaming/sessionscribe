/**
 * Session Scribe — Transcription Engine Interface
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

export interface TranscriptionSegment {
  start: number;  // seconds relative to audio file
  end: number;
  text: string;
  confidence?: number;
}

export interface TranscriptionOptions {
  language?: string;
  prompt?: string;
  modelPath?: string;
}

export interface TranscriptionEngine {
  name: string;
  transcribe(audioPath: string, options?: TranscriptionOptions): Promise<TranscriptionSegment[]>;
  isAvailable(): Promise<boolean>;
}
