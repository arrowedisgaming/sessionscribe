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
import { SetupWizard } from './components/SetupWizard';
import { RecordPanel } from './components/RecordPanel';
import { SessionBrowser } from './components/SessionBrowser';
import { SettingsPanel } from './components/SettingsPanel';
import { RecoveryDialog } from './components/RecoveryDialog';
import { ToastContainer } from './components/ToastNotification';

const tabs: { id: ActiveTab; label: string }[] = [
  { id: 'record', label: 'Record' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'settings', label: 'Settings' },
];

export const App: React.FC = () => {
  const dispatch = useAppDispatch();
  const { activeTab, isFirstRun, setupComplete } = useAppSelector((s) => s.app);

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
        <span className="px-4 py-3 text-xs text-gray-600">Session Scribe</span>
      </nav>

      {/* Tab Content */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'record' && <RecordPanel />}
        {activeTab === 'sessions' && <SessionBrowser />}
        {activeTab === 'settings' && <SettingsPanel />}
      </main>
      <RecoveryDialog />
      <ToastContainer />
    </div>
  );
};
