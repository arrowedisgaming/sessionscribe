/**
 * Session Scribe — Transcript Viewer
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import React from 'react';

interface TranscriptViewerProps {
  content?: string;
}

export const TranscriptViewer: React.FC<TranscriptViewerProps> = ({ content }) => {
  if (!content) {
    return (
      <div className="p-6 text-center text-gray-400">
        No transcript selected
      </div>
    );
  }

  // Simple markdown-like rendering (full implementation in Phase 9)
  const lines = content.split('\n');
  let inFrontmatter = false;
  const rendered: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    if (line.trim() === '---') {
      inFrontmatter = !inFrontmatter;
      return;
    }
    if (inFrontmatter) return;

    if (line.startsWith('# ')) {
      rendered.push(<h1 key={i} className="text-2xl font-bold text-gray-100 mb-4">{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      rendered.push(<h2 key={i} className="text-xl font-semibold text-gray-200 mt-4 mb-2">{line.slice(3)}</h2>);
    } else if (line.startsWith('**')) {
      const match = line.match(/^\*\*(.+?)\*\*\s*(.*)$/);
      if (match) {
        rendered.push(
          <p key={i} className="mb-1">
            <span className="font-bold text-indigo-400">{match[1]}</span>
            <span className="text-gray-300"> {match[2]}</span>
          </p>
        );
      } else {
        rendered.push(<p key={i} className="text-gray-300 mb-1">{line}</p>);
      }
    } else if (line.trim()) {
      rendered.push(<p key={i} className="text-gray-300 mb-1">{line}</p>);
    } else {
      rendered.push(<div key={i} className="h-2" />);
    }
  });

  return (
    <div className="p-6 max-w-3xl mx-auto font-mono text-sm">
      {rendered}
    </div>
  );
};
