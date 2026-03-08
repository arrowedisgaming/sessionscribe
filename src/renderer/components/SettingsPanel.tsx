/**
 * Session Scribe — Settings Panel
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import React, { useState, useEffect } from 'react';
import { useConfig } from '../hooks/useConfig';
import { ModelDownloader } from './ModelDownloader';

export const SettingsPanel: React.FC = () => {
  const [token, setToken] = useConfig<string>('discordToken');
  const [outputDir, setOutputDir] = useConfig<string>('outputDir');
  const [engine, setEngine] = useConfig<string>('transcriptionEngine');
  const [maxDuration, setMaxDuration] = useConfig<number>('maxDurationMinutes');
  const [autoTranscribe, setAutoTranscribe] = useConfig<boolean>('autoTranscribe');
  const [tokenInput, setTokenInput] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (token) setTokenInput(token);
  }, [token]);

  const handleSaveToken = async () => {
    await setToken(tokenInput);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSelectDir = async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) await setOutputDir(dir);
  };

  return (
    <div className="p-6 space-y-8 max-w-2xl">
      {/* Discord Token */}
      <section>
        <h2 className="text-lg font-semibold text-gray-100 mb-3">Discord Bot Token</h2>
        <div className="flex gap-2">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={handleSaveToken}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500"
          >
            {saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </section>

      {/* Output Directory */}
      <section>
        <h2 className="text-lg font-semibold text-gray-100 mb-3">Output Directory</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={outputDir || ''}
            readOnly
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100"
          />
          <button
            onClick={handleSelectDir}
            className="px-4 py-2 bg-gray-700 text-gray-100 rounded-lg hover:bg-gray-600"
          >
            Browse
          </button>
        </div>
      </section>

      {/* Transcription Engine */}
      <section>
        <h2 className="text-lg font-semibold text-gray-100 mb-3">Transcription Engine</h2>
        <select
          value={engine || 'whisper-cpp'}
          onChange={(e) => setEngine(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100"
        >
          <option value="whisper-cpp">whisper.cpp (native binary)</option>
          <option value="transformers-js">transformers.js (ONNX)</option>
        </select>
      </section>

      {/* Max Duration */}
      <section>
        <h2 className="text-lg font-semibold text-gray-100 mb-3">Max Recording Duration</h2>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={maxDuration ?? 480}
            onChange={(e) => setMaxDuration(parseInt(e.target.value) || 480)}
            min={30}
            max={1440}
            className="w-24 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100"
          />
          <span className="text-gray-400">minutes</span>
        </div>
      </section>

      {/* Auto-transcribe */}
      <section>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoTranscribe ?? false}
            onChange={(e) => setAutoTranscribe(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 text-indigo-500 focus:ring-indigo-500"
          />
          <div>
            <span className="text-gray-100">Auto-transcribe after recording</span>
            <p className="text-sm text-gray-400">
              Automatically start transcription when recording stops
            </p>
          </div>
        </label>
      </section>

      {/* Model Management */}
      <section>
        <ModelDownloader />
      </section>
    </div>
  );
};
