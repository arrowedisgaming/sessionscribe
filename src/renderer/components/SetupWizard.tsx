/**
 * Session Scribe — Setup Wizard
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import React, { useState, useEffect } from 'react';
import { useAppDispatch } from '../store';
import { setSetupComplete, setFirstRun } from '../store/appSlice';

type WizardStep = 'welcome' | 'token' | 'directory' | 'engine' | 'binaries';

export const SetupWizard: React.FC = () => {
  const dispatch = useAppDispatch();
  const [step, setStep] = useState<WizardStep>('welcome');
  const [token, setToken] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [engine, setEngine] = useState<'whisper-cpp' | 'transformers-js'>('whisper-cpp');
  const [testing, setTesting] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [tokenError, setTokenError] = useState('');
  const [binariesReady, setBinariesReady] = useState(false);
  const [binariesDownloading, setBinariesDownloading] = useState(false);
  const [binariesStage, setBinariesStage] = useState('');
  const [binariesPercent, setBinariesPercent] = useState(0);
  const [binariesError, setBinariesError] = useState('');

  const handleTestToken = async () => {
    if (!token.trim()) return;
    setTesting(true);
    setTokenError('');
    try {
      const result = await window.electronAPI.discordTestToken(token.trim());
      if (result.success) {
        setTokenValid(true);
        await window.electronAPI.configSet('discordToken', token.trim());
      } else {
        setTokenValid(false);
        setTokenError(result.error || 'Invalid token');
      }
    } catch (err) {
      setTokenValid(false);
      setTokenError('Failed to test token');
    }
    setTesting(false);
  };

  const handleSelectDir = async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      setOutputDir(dir);
      await window.electronAPI.configSet('outputDir', dir);
    }
  };

  useEffect(() => {
    if (step === 'binaries') {
      window.electronAPI.binariesStatus().then((s: unknown) => {
        const status = s as { ffmpeg: boolean; whisper: boolean };
        if (status.ffmpeg && status.whisper) setBinariesReady(true);
      });
      const unsub = window.electronAPI.onBinariesProgress((prog: unknown) => {
        const p = prog as { stage: string; percent: number };
        setBinariesStage(p.stage);
        setBinariesPercent(p.percent);
      });
      return () => { unsub(); };
    }
  }, [step]);

  const handleDownloadBinaries = async () => {
    setBinariesDownloading(true);
    setBinariesError('');
    const result = await window.electronAPI.binariesDownload() as { success: boolean; error?: string };
    setBinariesDownloading(false);
    if (result.success) {
      setBinariesReady(true);
    } else {
      setBinariesError(result.error || 'Download failed');
    }
  };

  const handleFinish = async () => {
    await window.electronAPI.configSet('transcriptionEngine', engine);
    await window.electronAPI.configSet('isFirstRun', false);
    dispatch(setFirstRun(false));
    dispatch(setSetupComplete(true));
  };

  const steps: WizardStep[] = ['welcome', 'token', 'directory', 'engine', 'binaries'];
  const stepIndex = steps.indexOf(step);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-8">
      <div className="w-full max-w-lg">
        <h1 className="text-3xl font-bold text-indigo-400 mb-2 text-center">
          Session Scribe Setup
        </h1>
        <p className="text-gray-400 text-center mb-8">
          Step {stepIndex + 1} of {steps.length}
        </p>

        {/* Progress bar */}
        <div className="flex gap-2 mb-8">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded ${
                i <= stepIndex ? 'bg-indigo-500' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {step === 'welcome' && (
          <div className="space-y-6 text-center">
            <h2 className="text-4xl font-bold text-indigo-400">Session Scribe</h2>
            <p className="text-lg text-gray-300">
              Record, transcribe, and archive your TTRPG sessions
            </p>
            <ul className="text-left space-y-3 text-gray-300">
              <li className="flex items-start gap-3">
                <span className="text-indigo-400 mt-0.5">&#9679;</span>
                <span>Record Discord voice channels with per-user audio tracks</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-indigo-400 mt-0.5">&#9679;</span>
                <span>AI-powered transcription with whisper.cpp or transformers.js</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-indigo-400 mt-0.5">&#9679;</span>
                <span>Everything runs locally — your audio never leaves your machine</span>
              </li>
            </ul>
            <button
              onClick={() => setStep('token')}
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 text-lg font-medium"
            >
              Get Started
            </button>
          </div>
        )}

        {step === 'token' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-100">Discord Bot Token</h2>
            <p className="text-gray-400 text-sm">
              Paste your Discord bot token. The bot needs Voice and Message Content intents enabled.
            </p>
            <input
              type="password"
              value={token}
              onChange={(e) => { setToken(e.target.value); setTokenValid(null); }}
              placeholder="Bot token..."
              className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 focus:border-indigo-500 focus:outline-none"
            />
            {tokenError && (
              <p className="text-red-400 text-sm">{tokenError}</p>
            )}
            {tokenValid && (
              <p className="text-green-400 text-sm">Token verified successfully!</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleTestToken}
                disabled={testing || !token.trim()}
                className="px-4 py-2 bg-gray-700 text-gray-100 rounded-lg hover:bg-gray-600 disabled:opacity-50"
              >
                {testing ? 'Testing...' : 'Test Token'}
              </button>
              <button
                onClick={() => setStep('directory')}
                disabled={!tokenValid}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 'directory' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-100">Output Directory</h2>
            <p className="text-gray-400 text-sm">
              Choose where session recordings and transcripts are saved.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={outputDir}
                readOnly
                placeholder="Select a directory..."
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100"
              />
              <button
                onClick={handleSelectDir}
                className="px-4 py-2 bg-gray-700 text-gray-100 rounded-lg hover:bg-gray-600"
              >
                Browse
              </button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setStep('token')}
                className="px-4 py-2 bg-gray-700 text-gray-100 rounded-lg hover:bg-gray-600"
              >
                Back
              </button>
              <button
                onClick={() => setStep('engine')}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 'engine' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-100">Transcription Engine</h2>
            <p className="text-gray-400 text-sm">
              Choose your preferred transcription engine. You can change this later.
            </p>
            <div className="space-y-3">
              <label className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer ${
                engine === 'whisper-cpp' ? 'border-indigo-500 bg-gray-800' : 'border-gray-600 bg-gray-800/50'
              }`}>
                <input
                  type="radio"
                  name="engine"
                  value="whisper-cpp"
                  checked={engine === 'whisper-cpp'}
                  onChange={() => setEngine('whisper-cpp')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-100">whisper.cpp</div>
                  <div className="text-sm text-gray-400">
                    Fast native binary. Recommended for most users.
                  </div>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer ${
                engine === 'transformers-js' ? 'border-indigo-500 bg-gray-800' : 'border-gray-600 bg-gray-800/50'
              }`}>
                <input
                  type="radio"
                  name="engine"
                  value="transformers-js"
                  checked={engine === 'transformers-js'}
                  onChange={() => setEngine('transformers-js')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-100">transformers.js</div>
                  <div className="text-sm text-gray-400">
                    Pure JavaScript ONNX inference. No external binary needed.
                  </div>
                </div>
              </label>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setStep('directory')}
                className="px-4 py-2 bg-gray-700 text-gray-100 rounded-lg hover:bg-gray-600"
              >
                Back
              </button>
              <button
                onClick={() => setStep('binaries')}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 'binaries' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-100">Download Required Tools</h2>
            <p className="text-gray-400 text-sm">
              Session Scribe needs ffmpeg (audio processing) and whisper.cpp (transcription).
              These will be downloaded to your app data folder (~100 MB total).
            </p>
            {binariesReady ? (
              <p className="text-green-400 font-medium">All tools are ready!</p>
            ) : binariesDownloading ? (
              <div className="space-y-2">
                <p className="text-gray-300">{binariesStage}</p>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${binariesPercent}%` }} />
                </div>
              </div>
            ) : (
              <button
                onClick={handleDownloadBinaries}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500"
              >
                Download Tools
              </button>
            )}
            {binariesError && <p className="text-red-400 text-sm">{binariesError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setStep('engine')}
                className="px-4 py-2 bg-gray-700 text-gray-100 rounded-lg hover:bg-gray-600"
              >
                Back
              </button>
              <button
                onClick={handleFinish}
                disabled={!binariesReady}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50"
              >
                Finish Setup
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
