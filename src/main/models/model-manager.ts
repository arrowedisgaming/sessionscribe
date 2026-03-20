/**
 * Session Scribe — Model Manager
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

import fs from 'fs';
import path from 'path';
import https from 'https';
import { app } from 'electron';
import { EventEmitter } from 'events';

export interface ModelInfo {
  id: string;
  name: string;
  size: string;
  sizeBytes: number;
  filename: string;
  url: string;
  status: 'available' | 'downloading' | 'downloaded' | 'bundled';
  downloadProgress?: number;
}

const WHISPER_MODELS: Omit<ModelInfo, 'status' | 'downloadProgress'>[] = [
  {
    id: 'tiny',
    name: 'Tiny',
    size: '75 MB',
    sizeBytes: 75_000_000,
    filename: 'ggml-tiny.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  },
  {
    id: 'base',
    name: 'Base',
    size: '142 MB',
    sizeBytes: 142_000_000,
    filename: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  },
  {
    id: 'small',
    name: 'Small',
    size: '466 MB',
    sizeBytes: 466_000_000,
    filename: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  },
  {
    id: 'medium',
    name: 'Medium',
    size: '1.5 GB',
    sizeBytes: 1_500_000_000,
    filename: 'ggml-medium.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
  },
  {
    id: 'large-v3',
    name: 'Large v3',
    size: '3.1 GB',
    sizeBytes: 3_100_000_000,
    filename: 'ggml-large-v3.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
  },
];

export class ModelManager extends EventEmitter {
  private downloadDir: string;
  private bundledDir: string;
  private activeDownload: { abort: () => void } | null = null;

  constructor() {
    super();
    this.downloadDir = path.join(app.getPath('userData'), 'models');
    this.bundledDir = path.join(process.resourcesPath, 'models');
    fs.mkdirSync(this.downloadDir, { recursive: true });
  }

  getModelPath(modelId: string): string | null {
    const model = WHISPER_MODELS.find((m) => m.id === modelId);
    if (!model) return null;

    // Check downloaded models first
    const downloadedPath = path.join(this.downloadDir, model.filename);
    if (fs.existsSync(downloadedPath)) return downloadedPath;

    // Check bundled models
    const bundledPath = path.join(this.bundledDir, model.filename);
    if (fs.existsSync(bundledPath)) return bundledPath;

    // Dev mode: check project resources
    const devPath = path.join(app.getAppPath(), 'resources', 'models', model.filename);
    if (fs.existsSync(devPath)) return devPath;

    return null;
  }

  listModels(): ModelInfo[] {
    return WHISPER_MODELS.map((model) => {
      const downloadedPath = path.join(this.downloadDir, model.filename);
      const bundledPath = path.join(this.bundledDir, model.filename);
      const devPath = path.join(app.getAppPath(), 'resources', 'models', model.filename);

      let status: ModelInfo['status'] = 'available';
      if (fs.existsSync(bundledPath) || fs.existsSync(devPath)) {
        status = 'bundled';
      } else if (fs.existsSync(downloadedPath)) {
        status = 'downloaded';
      }

      return { ...model, status };
    });
  }

  async downloadModel(modelId: string): Promise<void> {
    const model = WHISPER_MODELS.find((m) => m.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);

    const destPath = path.join(this.downloadDir, model.filename);
    const tempPath = destPath + '.tmp';

    return new Promise((resolve, reject) => {
      let receivedBytes = 0;
      let file: fs.WriteStream | null = null;

      const makeRequest = (url: string) => {
        const req = https.get(url, (response) => {
          if ([301, 302, 307, 308].includes(response.statusCode!)) {
            makeRequest(response.headers.location!);
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }

          file = fs.createWriteStream(tempPath);
          const totalBytes = parseInt(response.headers['content-length'] || '0', 10) || model.sizeBytes;

          response.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            const progress = Math.round((receivedBytes / totalBytes) * 100);
            this.emit('downloadProgress', { modelId, progress, receivedBytes, totalBytes });
          });

          response.pipe(file);

          file.on('finish', () => {
            file!.close();
            fs.renameSync(tempPath, destPath);
            this.emit('downloadComplete', modelId);
            resolve();
          });

          file.on('error', (err) => {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            reject(err);
          });
        });

        req.on('error', (err) => {
          if (file) file.close();
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          reject(err);
        });

        this.activeDownload = {
          abort: () => {
            req.destroy();
            if (file) file.close();
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          },
        };
      };

      makeRequest(model.url);
    });
  }

  cancelDownload(): void {
    if (this.activeDownload) {
      this.activeDownload.abort();
      this.activeDownload = null;
    }
  }

  deleteModel(modelId: string): boolean {
    const model = WHISPER_MODELS.find((m) => m.id === modelId);
    if (!model) return false;

    const downloadedPath = path.join(this.downloadDir, model.filename);
    if (fs.existsSync(downloadedPath)) {
      fs.unlinkSync(downloadedPath);
      return true;
    }
    return false;
  }
}

export const modelManager = new ModelManager();
