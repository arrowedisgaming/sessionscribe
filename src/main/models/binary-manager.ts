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
import os from 'os';
import { app } from 'electron';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';

// Whisper versions per platform:
// - Windows: v1.7.6 (has prebuilt release binaries)
// - macOS/Linux: v1.6.2 (has pure-make build, no cmake dependency)
// Both versions use the same GGML model format.
const WHISPER_VERSION_PREBUILT = '1.7.6';
const WHISPER_VERSION_SOURCE = '1.6.2';

interface PlatformUrls {
  ffmpeg: string;
  whisper?: string; // undefined = build from source
}

// Third-party download sources:
// - ffmpeg (macOS): evermeet.cx — maintained macOS ffmpeg builds
// - ffmpeg (Linux): johnvansickle.com — static Linux ffmpeg builds
// - ffmpeg (Windows): BtbN GitHub — automated Windows ffmpeg builds
// - whisper (Windows): official ggerganov/whisper.cpp GitHub releases
// - whisper (macOS/Linux): built from source (no prebuilt binaries published)
const PLATFORM_URLS: Record<string, PlatformUrls> = {
  'darwin-arm64': {
    ffmpeg: 'https://evermeet.cx/ffmpeg/ffmpeg-8.0.1.zip',
  },
  'darwin-x64': {
    ffmpeg: 'https://evermeet.cx/ffmpeg/ffmpeg-8.0.1.zip',
  },
  'linux-x64': {
    ffmpeg: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
  },
  'win32-x64': {
    whisper: `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION_PREBUILT}/whisper-bin-x64.zip`,
    ffmpeg: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  },
};

const WHISPER_SOURCE_URL =
  `https://github.com/ggerganov/whisper.cpp/archive/refs/tags/v${WHISPER_VERSION_SOURCE}.tar.gz`;

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
    const urls = PLATFORM_URLS[this.platform];
    if (!urls) throw new Error(`Unsupported platform: ${this.platform}`);

    if (!this.hasFFmpeg()) {
      this.emit('progress', { binary: 'ffmpeg', stage: 'Downloading ffmpeg...', percent: 0 });
      await this.downloadAndExtract(urls.ffmpeg, 'ffmpeg');
      this.emit('progress', { binary: 'ffmpeg', stage: 'ffmpeg ready', percent: 100 });
    }

    if (!this.hasWhisper()) {
      if (urls.whisper) {
        this.emit('progress', { binary: 'whisper', stage: 'Downloading whisper-cli...', percent: 0 });
        await this.downloadAndExtract(urls.whisper, 'whisper');
        this.emit('progress', { binary: 'whisper', stage: 'whisper-cli ready', percent: 100 });
      } else {
        await this.buildWhisperFromSource();
      }
    }
  }

  private async buildWhisperFromSource(): Promise<void> {
    // Verify build tools are available
    try {
      execSync('which cc', { stdio: 'pipe' });
      execSync('which make', { stdio: 'pipe' });
    } catch {
      const hint = process.platform === 'darwin'
        ? 'Install Xcode Command Line Tools by running: xcode-select --install'
        : 'Install build tools: sudo apt install build-essential';
      throw new Error(
        `whisper.cpp must be compiled from source on this platform, ` +
        `but no C compiler was found.\n${hint}`
      );
    }

    const tarPath = path.join(this.binDir, 'whisper-src.tar.gz');
    const srcDir = path.join(this.binDir, 'whisper-src');

    try {
      // 1. Download source tarball
      this.emit('progress', {
        binary: 'whisper',
        stage: 'Downloading whisper.cpp source...',
        percent: 5,
      });
      await this.download(WHISPER_SOURCE_URL, tarPath, 'whisper');

      // 2. Extract
      this.emit('progress', {
        binary: 'whisper',
        stage: 'Extracting source...',
        percent: 30,
      });
      fs.mkdirSync(srcDir, { recursive: true });
      execSync(`tar xf "${tarPath}" -C "${srcDir}" --strip-components=1`, {
        stdio: 'pipe',
      });

      // 3. Compile (v1.6.2 uses plain make, no cmake)
      this.emit('progress', {
        binary: 'whisper',
        stage: 'Compiling whisper-cli (this may take a minute)...',
        percent: 40,
      });
      const cpuCount = os.cpus().length;
      execSync(`make -j${cpuCount} main`, {
        cwd: srcDir,
        stdio: 'pipe',
        timeout: 300_000,
      });

      // 4. Install — v1.6.2 produces ./main, we save it as whisper-cli
      this.emit('progress', {
        binary: 'whisper',
        stage: 'Installing whisper-cli...',
        percent: 90,
      });
      const found =
        this.findBinary(srcDir, 'whisper-cli') ||
        this.findBinary(srcDir, 'main');
      if (!found) {
        throw new Error('Build completed but whisper-cli binary not found');
      }
      fs.copyFileSync(found, this.getWhisperPath());
      fs.chmodSync(this.getWhisperPath(), 0o755);

      this.emit('progress', {
        binary: 'whisper',
        stage: 'whisper-cli ready',
        percent: 100,
      });
    } finally {
      // Cleanup build artifacts regardless of success/failure
      if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
      if (fs.existsSync(srcDir)) fs.rmSync(srcDir, { recursive: true, force: true });
    }
  }

  private async downloadAndExtract(
    url: string,
    type: 'ffmpeg' | 'whisper'
  ): Promise<void> {
    const ext = url.endsWith('.tar.xz') ? 'tar.xz' : 'zip';
    const archivePath = path.join(this.binDir, `${type}_download.${ext}`);
    const extractDir = path.join(this.binDir, `${type}_extract`);

    fs.mkdirSync(extractDir, { recursive: true });

    await this.download(url, archivePath, type);

    // Extract
    this.emit('progress', {
      binary: type,
      stage: `Extracting ${type}...`,
      percent: 80,
    });
    if (ext === 'zip') {
      execSync(`unzip -o "${archivePath}" -d "${extractDir}"`, {
        stdio: 'pipe',
      });
    } else {
      execSync(
        `tar xf "${archivePath}" -C "${extractDir}" --strip-components=1`,
        { stdio: 'pipe' }
      );
    }

    // Find and move the binary to binDir root
    if (type === 'ffmpeg') {
      const found = this.findBinary(extractDir, 'ffmpeg');
      if (found) {
        fs.copyFileSync(found, this.getFFmpegPath());
        fs.chmodSync(this.getFFmpegPath(), 0o755);
      }
    } else {
      const found =
        this.findBinary(extractDir, 'whisper-cli') ||
        this.findBinary(extractDir, 'main');
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

      const followRedirects = (reqUrl: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          file.close();
          reject(new Error('Too many redirects'));
          return;
        }

        const client = reqUrl.startsWith('https') ? https : http;
        client
          .get(reqUrl, (response) => {
            if (
              response.statusCode === 301 ||
              response.statusCode === 302 ||
              response.statusCode === 307
            ) {
              const location = response.headers.location;
              if (!location) {
                file.close();
                reject(new Error('Redirect without location header'));
                return;
              }
              response.resume(); // drain response so socket is freed
              followRedirects(location, redirectCount + 1);
              return;
            }

            if (response.statusCode !== 200) {
              file.close();
              if (fs.existsSync(dest)) fs.unlinkSync(dest);
              reject(new Error(`HTTP ${response.statusCode} from ${reqUrl}`));
              return;
            }

            const total = parseInt(
              response.headers['content-length'] || '0',
              10
            );
            let received = 0;
            response.on('data', (chunk: Buffer) => {
              received += chunk.length;
              if (total > 0) {
                const pct = Math.round((received / total) * 70);
                this.emit('progress', {
                  binary: type,
                  stage: `Downloading ${type}...`,
                  percent: pct,
                });
              }
            });
            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
            file.on('error', (err) => {
              file.close();
              reject(err);
            });
          })
          .on('error', (err) => {
            file.close();
            reject(err);
          });
      };

      followRedirects(url);
    });
  }
}

export const binaryManager = new BinaryManager();
