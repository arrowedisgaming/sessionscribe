/**
 * Session Scribe — Session Browser
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import React, { useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '../store';
import { setSessions, setSelectedSession, setLoading } from '../store/sessionsSlice';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const statusColors: Record<string, string> = {
  recording: 'bg-red-500',
  recorded: 'bg-yellow-500',
  transcribing: 'bg-blue-500',
  complete: 'bg-green-500',
  incomplete: 'bg-orange-500',
  error: 'bg-red-600',
};

export const SessionBrowser: React.FC = () => {
  const dispatch = useAppDispatch();
  const { sessions, selectedSessionId, loading } = useAppSelector((s) => s.sessions);

  useEffect(() => {
    const loadSessions = async () => {
      dispatch(setLoading(true));
      try {
        const list = await window.electronAPI.sessionsList();
        dispatch(setSessions(list.map((s: Record<string, unknown>) => ({
          id: s.id as string,
          campaign: s.campaign as string | undefined,
          guildName: s.guildName as string,
          channelName: s.channelName as string,
          startedAt: s.startedAt as string,
          durationSeconds: s.durationSeconds as number | undefined,
          status: s.status as string,
          transcriptCount: ((s.transcripts as unknown[]) || []).length,
        }))));
      } catch (err) {
        console.error('Failed to load sessions:', err);
      }
      dispatch(setLoading(false));
    };
    loadSessions();
  }, [dispatch]);

  const handleOpenFolder = async (sessionId: string) => {
    await window.electronAPI.sessionsOpenFolder(sessionId);
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center text-gray-400">
        Loading sessions...
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center text-gray-400 gap-2">
        <p className="text-lg">No sessions yet</p>
        <p className="text-sm">Record your first session from the Record tab</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="space-y-2">
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => dispatch(setSelectedSession(session.id))}
            className={`p-4 rounded-lg border cursor-pointer transition-colors ${
              selectedSessionId === session.id
                ? 'border-indigo-500 bg-gray-800'
                : 'border-gray-700 bg-gray-800/50 hover:bg-gray-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${statusColors[session.status] || 'bg-gray-500'}`} />
                  <span className="font-medium text-gray-100">
                    {session.campaign || session.guildName}
                  </span>
                  <span className="text-sm text-gray-500">#{session.channelName}</span>
                </div>
                <div className="text-sm text-gray-400 mt-1">
                  {formatDate(session.startedAt)} &middot; {formatDuration(session.durationSeconds)}
                  {session.transcriptCount > 0 && (
                    <span className="ml-2 text-indigo-400">
                      {session.transcriptCount} transcript{session.transcriptCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleOpenFolder(session.id); }}
                  className="px-3 py-1 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
                >
                  Open Folder
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
