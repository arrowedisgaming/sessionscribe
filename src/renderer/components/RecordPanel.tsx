/**
 * Session Scribe — Record Panel
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import React from 'react';
import { useAppSelector, useAppDispatch } from '../store';
import { setSelectedGuild, setSelectedChannel, setVoiceChannels, setJoinedChannel, setError, VoiceChannel } from '../store/discordSlice';
import { setRecordingStatus, setSessionId, resetRecording } from '../store/recordingSlice';
import { setActiveTab } from '../store/appSlice';
import { showToast } from './ToastNotification';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const RecordPanel: React.FC = () => {
  const dispatch = useAppDispatch();
  const discord = useAppSelector((s) => s.discord);
  const recording = useAppSelector((s) => s.recording);

  const isConnected = discord.status === 'connected';
  const isRecording = recording.status === 'recording';
  const canRecord = isConnected && discord.joinedChannel && !isRecording;

  const handleGuildChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch(setSelectedGuild(e.target.value));
    if (e.target.value) {
      const channels = await window.electronAPI.discordGetVoiceChannels(e.target.value);
      dispatch(setVoiceChannels(channels as VoiceChannel[]));
    }
  };

  const handleChannelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch(setSelectedChannel(e.target.value));
  };

  const handleJoinChannel = async () => {
    if (discord.selectedGuildId && discord.selectedChannelId) {
      const result = await window.electronAPI.discordJoinChannel(discord.selectedGuildId, discord.selectedChannelId) as { success: boolean; error?: string };
      if (result.success) {
        dispatch(setJoinedChannel(true));
      } else {
        console.error('Join channel failed:', result.error);
        dispatch(setError(result.error || 'Failed to join voice channel'));
      }
    }
  };

  const handleLeaveChannel = async () => {
    await window.electronAPI.discordLeaveChannel();
    dispatch(setJoinedChannel(false));
  };

  const handleStartRecording = async () => {
    const result = await window.electronAPI.recordingStart({
      campaign: recording.campaign,
    }) as { success: boolean; sessionId?: string; error?: string };
    if (result.success) {
      dispatch(setRecordingStatus('recording'));
      dispatch(setSessionId(result.sessionId));
    }
  };

  const handleStopRecording = async () => {
    dispatch(setRecordingStatus('stopping'));
    await window.electronAPI.recordingStop();
    dispatch(resetRecording());
  };

  const handleStopAndTranscribe = async () => {
    dispatch(setRecordingStatus('stopping'));
    const result = await window.electronAPI.recordingStop() as { success: boolean; session?: { id: string }; error?: string };
    dispatch(resetRecording());
    if (result.success && result.session) {
      const engine = await window.electronAPI.configGet('transcriptionEngine') as string;
      const model = await window.electronAPI.configGet('whisperModel') as string;

      if (engine === 'whisper-cpp') {
        const models = await window.electronAPI.modelsList() as { id: string; status: string }[];
        const target = models.find((m) => m.id === model);
        if (!target || (target.status !== 'downloaded' && target.status !== 'bundled')) {
          showToast(`No whisper model "${model}" downloaded. Go to Settings to download one.`, 'error');
          dispatch(setActiveTab('sessions'));
          return;
        }
      }

      window.electronAPI.transcriptionStart(result.session.id, { engine, model });
      dispatch(setActiveTab('sessions'));
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Connection Status */}
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${
          discord.status === 'connected' ? 'bg-green-500' :
          discord.status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
          discord.status === 'error' ? 'bg-red-500' :
          'bg-gray-500'
        }`} />
        <span className="text-gray-300 capitalize">{discord.status}</span>
        {discord.error && (
          <span className="text-red-400 text-sm ml-2">{discord.error}</span>
        )}
      </div>

      {/* Server & Channel Selection */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Server</label>
          <select
            value={discord.selectedGuildId || ''}
            onChange={handleGuildChange}
            disabled={!isConnected}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 disabled:opacity-50"
          >
            <option value="">Select server...</option>
            {discord.guilds.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Voice Channel</label>
          <select
            value={discord.selectedChannelId || ''}
            onChange={handleChannelChange}
            disabled={!discord.selectedGuildId}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 disabled:opacity-50"
          >
            <option value="">Select channel...</option>
            {discord.voiceChannels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Join/Leave Button */}
      <div>
        {!discord.joinedChannel ? (
          <button
            onClick={handleJoinChannel}
            disabled={!discord.selectedChannelId}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50"
          >
            Join Channel
          </button>
        ) : (
          <button
            onClick={handleLeaveChannel}
            disabled={isRecording}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 disabled:opacity-50"
          >
            Leave Channel
          </button>
        )}
      </div>

      {/* Connected Users */}
      {discord.connectedUsers.length > 0 && (
        <div>
          <h3 className="text-sm text-gray-400 mb-2">Connected Users</h3>
          <div className="flex flex-wrap gap-2">
            {discord.connectedUsers.map((user) => (
              <span key={user.id} className="px-3 py-1 bg-gray-800 rounded-full text-sm text-gray-200">
                {user.displayName}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recording Controls */}
      <div className="border-t border-gray-700 pt-6">
        <div className="flex items-center gap-6">
          {!isRecording ? (
            <button
              onClick={handleStartRecording}
              disabled={!canRecord}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-500 disabled:opacity-50 text-lg font-medium"
            >
              <span className="w-4 h-4 rounded-full bg-white" />
              Record
            </button>
          ) : (
            <>
              <button
                onClick={handleStopRecording}
                className="flex items-center gap-2 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-500 text-lg font-medium"
              >
                <span className="w-4 h-4 bg-white" />
                Stop
              </button>
              <button
                onClick={handleStopAndTranscribe}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 text-lg font-medium"
              >
                Stop &amp; Transcribe
              </button>
            </>
          )}
          <span className="text-2xl font-mono text-gray-300">
            {formatTime(recording.elapsedSeconds)}
          </span>
        </div>
        {recording.error && (
          <p className="text-red-400 text-sm mt-2">{recording.error}</p>
        )}
      </div>
    </div>
  );
};
