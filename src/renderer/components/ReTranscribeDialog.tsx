/**
 * Session Scribe — Re-Transcribe Dialog
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import React, { useState, useEffect } from 'react';

interface ReTranscribeDialogProps {
  sessionId: string;
  onClose: () => void;
}

interface ModelInfo {
  id: string;
  name: string;
  status: string;
}

export const ReTranscribeDialog: React.FC<ReTranscribeDialogProps> = ({ sessionId, onClose }) => {
  const [engine, setEngine] = useState<string>('whisper-cpp');
  const [model, setModel] = useState<string>('base');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; percent: number }>({ stage: '', percent: 0 });

  useEffect(() => {
    window.electronAPI.modelsList().then((list: unknown) => {
      setModels((list as ModelInfo[]).filter((m) => m.status === 'downloaded' || m.status === 'bundled'));
    });
    const unsub = window.electronAPI.onTranscriptionProgress((prog: unknown) => {
      setProgress(prog as { stage: string; percent: number });
    });
    const unsubComplete = window.electronAPI.onTranscriptionComplete(() => {
      setTranscribing(false);
      onClose();
    });
    return () => { unsub(); unsubComplete(); };
  }, [onClose]);

  const handleStart = async () => {
    setTranscribing(true);
    await window.electronAPI.transcriptionStart(sessionId, { engine, model });
  };

  const handleCancel = async () => {
    await window.electronAPI.transcriptionCancel();
    setTranscribing(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md shadow-xl">
        <h2 className="text-xl font-bold text-gray-100 mb-4">Re-Transcribe Session</h2>

        {!transcribing ? (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Engine</label>
                <select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100"
                >
                  <option value="whisper-cpp">whisper.cpp</option>
                  <option value="transformers-js">transformers.js</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={onClose} className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600">
                Cancel
              </button>
              <button
                onClick={handleStart}
                disabled={models.length === 0}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50"
              >
                Start Transcription
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <p className="text-gray-300">{progress.stage}</p>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="text-sm text-gray-400">{progress.percent}%</p>
            <button onClick={handleCancel} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
