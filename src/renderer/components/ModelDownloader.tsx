/**
 * Session Scribe — Model Downloader
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import React, { useState, useEffect } from 'react';

export interface ModelInfo {
  id: string;
  name: string;
  size: string;
  status: 'available' | 'downloading' | 'downloaded' | 'bundled';
  downloadProgress?: number;
}

interface DownloadProgress {
  modelId: string;
  progress: number;
}

export const ModelDownloader: React.FC = () => {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});

  const loadModels = async () => {
    const list = await window.electronAPI.modelsList();
    setModels(list as ModelInfo[]);
  };

  useEffect(() => {
    loadModels();
    const unsub = window.electronAPI.onModelsDownloadProgress((prog: unknown) => {
      const p = prog as DownloadProgress;
      setProgress((prev) => ({ ...prev, [p.modelId]: p.progress }));
    });
    return () => { unsub(); };
  }, []);

  const handleDownload = async (modelId: string) => {
    setDownloading(modelId);
    setProgress((prev) => ({ ...prev, [modelId]: 0 }));
    try {
      await window.electronAPI.modelsDownload(modelId);
      await loadModels();
    } catch (err) {
      console.error('Download failed:', err);
    }
    setDownloading(null);
  };

  const handleCancel = async () => {
    await window.electronAPI.modelsCancelDownload();
    setDownloading(null);
    await loadModels();
  };

  const handleDelete = async (modelId: string) => {
    await window.electronAPI.modelsDelete(modelId);
    await loadModels();
  };

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-gray-100">Whisper Models</h3>
      <div className="space-y-2">
        {models.map((model) => (
          <div key={model.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-gray-100 font-medium">{model.name}</span>
                <span className="text-gray-500 text-sm">{model.size}</span>
                {model.status === 'bundled' && (
                  <span className="text-xs px-2 py-0.5 bg-green-900 text-green-300 rounded">bundled</span>
                )}
                {model.status === 'downloaded' && (
                  <span className="text-xs px-2 py-0.5 bg-blue-900 text-blue-300 rounded">downloaded</span>
                )}
              </div>
              {downloading === model.id && (
                <div className="mt-2">
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-indigo-500 h-2 rounded-full transition-all"
                      style={{ width: `${progress[model.id] || 0}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 mt-1">{progress[model.id] || 0}%</span>
                </div>
              )}
            </div>
            <div className="flex gap-2 ml-4">
              {model.status === 'available' && downloading !== model.id && (
                <button
                  onClick={() => handleDownload(model.id)}
                  disabled={!!downloading}
                  className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50"
                >
                  Download
                </button>
              )}
              {downloading === model.id && (
                <button
                  onClick={handleCancel}
                  className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-500"
                >
                  Cancel
                </button>
              )}
              {model.status === 'downloaded' && (
                <button
                  onClick={() => handleDelete(model.id)}
                  className="px-3 py-1 text-sm bg-gray-700 text-red-400 rounded hover:bg-gray-600"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
