/**
 * Session Scribe — Transcript Builder
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

import fs from 'fs';
import path from 'path';
import { TranscriptionSegment } from './engine';
import { SessionMetadata } from '../sessions/session-manager';
import { config } from '../config';

interface UserSegments {
  userId: string;
  displayName: string;
  segments: TranscriptionSegment[];
}

interface MergedLine {
  timestamp: number;
  speaker: string;
  text: string;
}

export class TranscriptBuilder {
  buildTranscript(
    session: SessionMetadata,
    userSegments: UserSegments[],
    engine: string,
    model: string
  ): string {
    // Resolve display names
    const nameOverrides = config.get('displayNameOverrides');
    const resolvedSegments = userSegments.map((us) => ({
      ...us,
      displayName: nameOverrides[us.userId] || us.displayName,
    }));

    // Merge all segments chronologically
    const allLines: MergedLine[] = [];
    for (const user of resolvedSegments) {
      for (const seg of user.segments) {
        allLines.push({
          timestamp: seg.start,
          speaker: user.displayName,
          text: seg.text,
        });
      }
    }
    allLines.sort((a, b) => a.timestamp - b.timestamp);

    // Build markdown
    const lines: string[] = [];

    // YAML frontmatter
    lines.push('---');
    lines.push(`session_id: "${session.id}"`);
    lines.push(`campaign: "${session.campaign || ''}"`);
    lines.push(`guild: "${session.guildName}"`);
    lines.push(`channel: "${session.channelName}"`);
    lines.push(`date: "${session.startedAt}"`);
    lines.push(`duration: ${session.durationSeconds || 0}`);
    lines.push(`engine: "${engine}"`);
    lines.push(`model: "${model}"`);
    lines.push(`speakers:`);
    for (const user of resolvedSegments) {
      lines.push(`  - id: "${user.userId}"`);
      lines.push(`    name: "${user.displayName}"`);
    }
    lines.push('---');
    lines.push('');

    // Title
    const dateStr = new Date(session.startedAt).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    lines.push(`# ${session.campaign || session.guildName} — ${dateStr}`);
    lines.push('');

    // Transcript body
    let lastSpeaker = '';
    for (const line of allLines) {
      const ts = formatTimestamp(line.timestamp);

      if (line.speaker !== lastSpeaker) {
        lines.push('');
        lines.push(`**${line.speaker}** [${ts}]`);
        lastSpeaker = line.speaker;
      }

      lines.push(line.text);
    }

    return lines.join('\n') + '\n';
  }

  writeTranscript(
    sessionDir: string,
    content: string,
    engine: string,
    model: string
  ): string {
    const filename = `transcript_${engine}_${model}.md`;
    const filepath = path.join(sessionDir, filename);
    fs.writeFileSync(filepath, content, 'utf-8');
    return filename;
  }
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const transcriptBuilder = new TranscriptBuilder();
