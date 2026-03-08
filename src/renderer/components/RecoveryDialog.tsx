/**
 * Session Scribe — Recovery Dialog
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import React, { useState, useEffect } from 'react';

interface IncompleteSession {
  id: string;
  startedAt: string;
  guildName: string;
  channelName: string;
}

export const RecoveryDialog: React.FC = () => {
  const [sessions, setSessions] = useState<IncompleteSession[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    window.electronAPI.sessionsGetIncomplete().then((list: unknown) => {
      const incomplete = list as IncompleteSession[];
      if (incomplete.length > 0) {
        setSessions(incomplete);
        setVisible(true);
      }
    });
  }, []);

  const handleFinalize = async (sessionId: string) => {
    await window.electronAPI.sessionsFinalize(sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (sessions.length <= 1) setVisible(false);
  };

  const handleDismiss = () => setVisible(false);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md shadow-xl">
        <h2 className="text-xl font-bold text-gray-100 mb-2">Incomplete Sessions Found</h2>
        <p className="text-gray-400 text-sm mb-4">
          The app was closed during recording. Would you like to finalize these sessions?
        </p>
        <div className="space-y-2 mb-4">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
              <div>
                <span className="text-gray-100">{s.guildName}</span>
                <span className="text-gray-500 text-sm ml-2">
                  {new Date(s.startedAt).toLocaleDateString()}
                </span>
              </div>
              <button
                onClick={() => handleFinalize(s.id)}
                className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-500"
              >
                Finalize
              </button>
            </div>
          ))}
        </div>
        <button onClick={handleDismiss} className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600">
          Dismiss
        </button>
      </div>
    </div>
  );
};
