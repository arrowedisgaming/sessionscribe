/**
 * Session Scribe — Binary Manager
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
import http from 'http';
import { app } from 'electron';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';

const WHISPER_VERSION = '1.7.4';

interface BinaryUrls {
  whisper: string;
  ffmpeg: string;
}

const URLS: Record<string, BinaryUrls> = {
  'darwin-arm64': {
    whisper: `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION}/whisper-v${WHISPER_VERSION}-bin-macos-arm64.zip`,
    ffmpeg: 'https://evermeet.cx/ffmpeg/ffmpeg-7.1.1.zip',
  },
  'darwin-x64': {
    whisper: `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION}/whisper-v${WHISPER_VERSION}-bin-macos-x64.zip`,
    ffmpeg: 'https://evermeet.cx/ffmpeg/ffmpeg-7.1.1.zip',
  },
  'linux-x64': {
    whisper: `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION}/whisper-v${WHISPER_VERSION}-bin-linux-x64.zip`,
    ffmpeg: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
  },
  'win32-x64': {
    whisper: `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION}/whisper-v${WHISPER_VERSION}-bin-win-x64.zip`,
    ffmpeg: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  },
};

export class BinaryManager extends EventEmitter {
  private binDir: string;
  private platform: string;

  constructor() {
    super();
    this.platform = `${process.platform}-${process.arch}`;
    this.binDir = path.join(app.getPath('userData'), 'bin');
    fs.mkdirSync(this.binDir, { recursive: true });
  }

  getBinDir(): string {
    return this.binDir;
  }

  hasFFmpeg(): boolean {
    return fs.existsSync(this.getFFmpegPath());
  }

  hasWhisper(): boolean {
    return fs.existsSync(this.getWhisperPath());
  }

  areBinariesReady(): boolean {
    return this.hasFFmpeg() && this.hasWhisper();
  }

  getFFmpegPath(): string {
    const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    return path.join(this.binDir, name);
  }

  getWhisperPath(): string {
    const name = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    return path.join(this.binDir, name);
  }

  async downloadAll(): Promise<void> {
    const urls = URLS[this.platform];
    if (!urls) throw new Error(`Unsupported platform: ${this.platform}`);

    if (!this.hasFFmpeg()) {
      this.emit('progress', { binary: 'ffmpeg', stage: 'Downloading ffmpeg...', percent: 0 });
      await this.downloadAndExtract(urls.ffmpeg, 'ffmpeg');
      this.emit('progress', { binary: 'ffmpeg', stage: 'ffmpeg ready', percent: 100 });
    }

    if (!this.hasWhisper()) {
      this.emit('progress', { binary: 'whisper', stage: 'Downloading whisper.cpp...', percent: 0 });
      await this.downloadAndExtract(urls.whisper, 'whisper');
      this.emit('progress', { binary: 'whisper', stage: 'whisper.cpp ready', percent: 100 });
    }
  }

  private async downloadAndExtract(url: string, type: 'ffmpeg' | 'whisper'): Promise<void> {
    const ext = url.endsWith('.tar.xz') ? 'tar.xz' : 'zip';
    const archivePath = path.join(this.binDir, `${type}_download.${ext}`);
    const extractDir = path.join(this.binDir, `${type}_extract`);

    fs.mkdirSync(extractDir, { recursive: true });

    await this.download(url, archivePath, type);

    // Extract
    this.emit('progress', { binary: type, stage: `Extracting ${type}...`, percent: 80 });
    if (ext === 'zip') {
      execSync(`unzip -o "${archivePath}" -d "${extractDir}"`, { stdio: 'pipe' });
    } else {
      execSync(`tar xf "${archivePath}" -C "${extractDir}" --strip-components=1`, { stdio: 'pipe' });
    }

    // Find and move the binary to binDir root
    if (type === 'ffmpeg') {
      const found = this.findBinary(extractDir, 'ffmpeg');
      if (found) {
        fs.copyFileSync(found, this.getFFmpegPath());
        fs.chmodSync(this.getFFmpegPath(), 0o755);
      }
    } else {
      // whisper-cli (or main/whisper-cli in some releases)
      const found = this.findBinary(extractDir, 'whisper-cli') || this.findBinary(extractDir, 'main');
      if (found) {
        fs.copyFileSync(found, this.getWhisperPath());
        fs.chmodSync(this.getWhisperPath(), 0o755);
      }
    }

    // Cleanup
    fs.unlinkSync(archivePath);
    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  private findBinary(dir: string, name: string): string | null {
    const exeName = process.platform === 'win32' ? `${name}.exe` : name;
    // Search recursively
    const search = (d: string): string | null => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const fullPath = path.join(d, entry.name);
        if (entry.isFile() && entry.name === exeName) return fullPath;
        if (entry.isDirectory()) {
          const found = search(fullPath);
          if (found) return found;
        }
      }
      return null;
    };
    return search(dir);
  }

  private download(url: string, dest: string, type: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      const client = url.startsWith('https') ? https : http;

      const makeRequest = (reqUrl: string) => {
        client.get(reqUrl, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            file.close();
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            const newFile = fs.createWriteStream(dest);
            const redirectClient = response.headers.location!.startsWith('https') ? https : http;
            redirectClient.get(response.headers.location!, (res2) => {
              this.pipeWithProgress(res2, newFile, type, resolve, reject, dest);
            }).on('error', (err) => { newFile.close(); reject(err); });
            return;
          }
          this.pipeWithProgress(response, file, type, resolve, reject, dest);
        }).on('error', (err) => { file.close(); reject(err); });
      };

      makeRequest(url);
    });
  }

  private pipeWithProgress(
    response: http.IncomingMessage,
    file: fs.WriteStream,
    type: string,
    resolve: () => void,
    reject: (err: Error) => void,
    dest: string
  ): void {
    if (response.statusCode !== 200) {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(new Error(`HTTP ${response.statusCode}`));
      return;
    }
    const total = parseInt(response.headers['content-length'] || '0', 10);
    let received = 0;
    response.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (total > 0) {
        const pct = Math.round((received / total) * 70); // 0-70% for download, 70-100% for extract
        this.emit('progress', { binary: type, stage: `Downloading ${type}...`, percent: pct });
      }
    });
    response.pipe(file);
    file.on('finish', () => { file.close(); resolve(); });
  }
}

export const binaryManager = new BinaryManager();
