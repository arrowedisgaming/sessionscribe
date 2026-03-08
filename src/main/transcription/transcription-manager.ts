/**
 * Session Scribe — Transcription Manager
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

import path from 'path';
import { EventEmitter } from 'events';
import { TranscriptionEngine, TranscriptionSegment } from './engine';
import { WhisperCppEngine } from './whisper-cpp';
import { TransformersJsEngine } from './transformers-js';
import { transcriptBuilder } from './transcript-builder';
import { sessionManager, TranscriptInfo } from '../sessions/session-manager';
import { config } from '../config';

export interface TranscriptionRequest {
  sessionId: string;
  engine?: string;
  model?: string;
  language?: string;
  vocabularyHints?: string[];
}

export class TranscriptionManager extends EventEmitter {
  private engines: Map<string, TranscriptionEngine> = new Map();
  private cancelled = false;

  constructor() {
    super();
    this.engines.set('whisper-cpp', new WhisperCppEngine());
    this.engines.set('transformers-js', new TransformersJsEngine());
  }

  registerEngine(engine: TranscriptionEngine): void {
    this.engines.set(engine.name, engine);
  }

  async transcribe(request: TranscriptionRequest): Promise<void> {
    this.cancelled = false;
    const session = sessionManager.readMetadata(request.sessionId);
    if (!session) throw new Error(`Session not found: ${request.sessionId}`);

    const engineName = request.engine || config.get('transcriptionEngine');
    const model = request.model || config.get('whisperModel');
    const engine = this.engines.get(engineName);
    if (!engine) throw new Error(`Unknown engine: ${engineName}`);

    const isAvailable = await engine.isAvailable();
    if (!isAvailable) throw new Error(`Engine ${engineName} is not available`);

    // Update session status
    session.status = 'transcribing';
    sessionManager.writeMetadata(session);

    const userSegments: { userId: string; displayName: string; segments: TranscriptionSegment[] }[] = [];
    const totalUsers = session.users.filter((u) => u.flacFile).length;
    let processedUsers = 0;

    try {
      for (const user of session.users) {
        if (this.cancelled) throw new Error('Transcription cancelled');
        if (!user.flacFile) continue;

        const audioPath = path.join(
          sessionManager.getAudioDir(session.id),
          user.flacFile
        );

        this.emit('progress', {
          stage: `Transcribing ${user.displayName}`,
          percent: Math.round((processedUsers / totalUsers) * 100),
          currentUser: user.displayName,
        });

        const prompt = request.vocabularyHints?.join(', ') || undefined;
        const segments = await engine.transcribe(audioPath, {
          language: request.language,
          prompt,
        });

        userSegments.push({
          userId: user.userId,
          displayName: user.displayName,
          segments,
        });

        processedUsers++;
      }

      this.emit('progress', {
        stage: 'Building transcript',
        percent: 90,
      });

      // Build and write transcript
      const content = transcriptBuilder.buildTranscript(session, userSegments, engineName, model);
      const sessionDir = sessionManager.getSessionDir(session.id);
      const filename = transcriptBuilder.writeTranscript(sessionDir, content, engineName, model);

      // Update session metadata
      const transcriptInfo: TranscriptInfo = {
        engine: engineName,
        model,
        filename,
        createdAt: new Date().toISOString(),
      };

      // Remove existing transcript with same engine/model if re-transcribing
      session.transcripts = session.transcripts.filter(
        (t) => !(t.engine === engineName && t.model === model)
      );
      session.transcripts.push(transcriptInfo);
      session.status = 'complete';
      sessionManager.writeMetadata(session);

      this.emit('progress', { stage: 'Complete', percent: 100 });
      this.emit('complete', { sessionId: session.id, filename });
    } catch (err) {
      session.status = 'error';
      session.error = (err as Error).message;
      sessionManager.writeMetadata(session);
      throw err;
    }
  }

  cancel(): void {
    this.cancelled = true;
  }
}

export const transcriptionManager = new TranscriptionManager();
