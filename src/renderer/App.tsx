/**
 * Session Scribe — App Root Component
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

import React, { useEffect, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from './store';
import { setActiveTab, setFirstRun, setSetupComplete, ActiveTab } from './store/appSlice';
import { setStatus, setConnectedUsers, setGuilds, DiscordStatus, ConnectedUser } from './store/discordSlice';
import { setElapsedSeconds, setRecordingStatus, setRecordingError } from './store/recordingSlice';
import { setTranscriptionStatus, setTranscriptionProgress, setTranscriptionError, resetTranscription } from './store/transcriptionSlice';
import { SetupWizard } from './components/SetupWizard';
import { RecordPanel } from './components/RecordPanel';
import { SessionBrowser } from './components/SessionBrowser';
import { SettingsPanel } from './components/SettingsPanel';
import { RecoveryDialog } from './components/RecoveryDialog';
import { ToastContainer } from './components/ToastNotification';
import { ErrorBoundary } from './components/ErrorBoundary';

const tabs: { id: ActiveTab; label: string }[] = [
  { id: 'record', label: 'Record' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'settings', label: 'Settings' },
];

export const App: React.FC = () => {
  const dispatch = useAppDispatch();
  const { activeTab, isFirstRun, setupComplete } = useAppSelector((s) => s.app);
  const transcription = useAppSelector((s) => s.transcription);

  useEffect(() => {
    const init = async () => {
      const firstRun = await window.electronAPI.configGet('isFirstRun');
      dispatch(setFirstRun(firstRun as boolean));
      if (!firstRun) {
        dispatch(setSetupComplete(true));
      }
    };
    init();
  }, [dispatch]);

  // Discord event listeners
  useEffect(() => {
    const unsubs = [
      window.electronAPI.onDiscordStatusChanged((status: string) => {
        dispatch(setStatus(status as DiscordStatus));
        if (status === 'connected') {
          window.electronAPI.discordGetGuilds().then((guilds: unknown[]) => {
            dispatch(setGuilds(guilds as { id: string; name: string; icon?: string }[]));
          });
        }
      }),
      window.electronAPI.onDiscordUsersUpdated((users: unknown[]) => {
        dispatch(setConnectedUsers(users as ConnectedUser[]));
      }),
      window.electronAPI.onRecordingTimer((elapsed: number) => {
        dispatch(setElapsedSeconds(elapsed));
      }),
      window.electronAPI.onRecordingError((error: string) => {
        dispatch(setRecordingError(error));
      }),
      window.electronAPI.onTranscriptionProgress((progress: unknown) => {
        const p = progress as { stage: string; percent: number; currentUser?: string };
        dispatch(setTranscriptionStatus('transcribing'));
        dispatch(setTranscriptionProgress(p));
      }),
      window.electronAPI.onTranscriptionComplete(() => {
        dispatch(setTranscriptionStatus('complete'));
        setTimeout(() => dispatch(resetTranscription()), 3000);
      }),
      window.electronAPI.onTranscriptionError((error: string) => {
        dispatch(setTranscriptionError(error));
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [dispatch]);

  if (isFirstRun && !setupComplete) {
    return <SetupWizard />;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100">
      {/* Tab Bar */}
      <nav className="flex border-b border-gray-700 bg-gray-800/50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => dispatch(setActiveTab(tab.id))}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-indigo-400 border-b-2 border-indigo-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <span className="px-4 py-3 text-xs text-gray-600">Session Scribe v0.2.0-alpha</span>
      </nav>

      {/* Transcription Progress */}
      {transcription.status === 'transcribing' && (
        <div className="bg-gray-800 border-b border-gray-700 px-4 py-2">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-indigo-400 font-medium">Transcribing</span>
            <span className="text-gray-400">{transcription.progress.stage}</span>
            {transcription.progress.currentUser && (
              <span className="text-gray-500">({transcription.progress.currentUser})</span>
            )}
            <span className="text-gray-400">{transcription.progress.percent}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-1.5 mt-1">
            <div
              className="bg-indigo-500 h-1.5 rounded-full transition-all"
              style={{ width: `${transcription.progress.percent}%` }}
            />
          </div>
        </div>
      )}
      {transcription.status === 'complete' && (
        <div className="bg-green-900/30 border-b border-green-800 px-4 py-2 text-sm text-green-400 font-medium">
          Transcription complete
        </div>
      )}
      {transcription.status === 'error' && (
        <div className="bg-red-900/30 border-b border-red-800 px-4 py-2 text-sm text-red-400">
          Transcription error: {transcription.error}
        </div>
      )}

      {/* Tab Content */}
      <main className="flex-1 overflow-y-auto">
        <ErrorBoundary>
          {activeTab === 'record' && <RecordPanel />}
          {activeTab === 'sessions' && <SessionBrowser />}
          {activeTab === 'settings' && <SettingsPanel />}
        </ErrorBoundary>
      </main>
      <RecoveryDialog />
      <ToastContainer />
    </div>
  );
};
