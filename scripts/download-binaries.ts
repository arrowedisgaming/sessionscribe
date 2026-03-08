/**
 * Session Scribe — Binary Downloader Script
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 *
 * Downloads platform-specific whisper.cpp and ffmpeg binaries
 * to resources/bin/{platform-arch}/.
 *
 * Usage: npx ts-node scripts/download-binaries.ts [--platform darwin-arm64|darwin-x64|linux-x64|win32-x64]
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PLATFORM = process.argv.find((a) => a.startsWith('--platform='))?.split('=')[1]
  || `${process.platform}-${process.arch}`;

const BIN_DIR = path.join(__dirname, '..', 'resources', 'bin', PLATFORM);

// whisper.cpp release URLs (update version as needed)
const WHISPER_VERSION = '1.7.4';
const WHISPER_URLS: Record<string, string> = {
  'darwin-arm64': `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION}/whisper-v${WHISPER_VERSION}-bin-macos-arm64.zip`,
  'darwin-x64': `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION}/whisper-v${WHISPER_VERSION}-bin-macos-x64.zip`,
  'linux-x64': `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION}/whisper-v${WHISPER_VERSION}-bin-linux-x64.zip`,
  'win32-x64': `https://github.com/ggerganov/whisper.cpp/releases/download/v${WHISPER_VERSION}/whisper-v${WHISPER_VERSION}-bin-win-x64.zip`,
};

// ffmpeg static build URLs
const FFMPEG_URLS: Record<string, string> = {
  'darwin-arm64': 'https://evermeet.cx/ffmpeg/ffmpeg-7.1.1.zip',
  'darwin-x64': 'https://evermeet.cx/ffmpeg/ffmpeg-7.1.1.zip',
  'linux-x64': 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
  'win32-x64': 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
};

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    client.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return download(response.headers.location!, dest).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function main() {
  console.log(`Downloading binaries for ${PLATFORM}...`);
  fs.mkdirSync(BIN_DIR, { recursive: true });

  // Download whisper.cpp
  const whisperUrl = WHISPER_URLS[PLATFORM];
  if (whisperUrl) {
    console.log(`  whisper.cpp: ${whisperUrl}`);
    const zipPath = path.join(BIN_DIR, 'whisper.zip');
    await download(whisperUrl, zipPath);
    execSync(`unzip -o "${zipPath}" -d "${BIN_DIR}"`, { stdio: 'inherit' });
    fs.unlinkSync(zipPath);
    // Make executable
    const whisperBin = path.join(BIN_DIR, 'whisper-cli');
    if (fs.existsSync(whisperBin)) {
      fs.chmodSync(whisperBin, 0o755);
    }
    console.log('  whisper.cpp done');
  } else {
    console.log(`  whisper.cpp: no URL for ${PLATFORM}, skipping`);
  }

  // Download ffmpeg
  const ffmpegUrl = FFMPEG_URLS[PLATFORM];
  if (ffmpegUrl) {
    console.log(`  ffmpeg: ${ffmpegUrl}`);
    const ext = ffmpegUrl.endsWith('.tar.xz') ? 'tar.xz' : 'zip';
    const archivePath = path.join(BIN_DIR, `ffmpeg.${ext}`);
    await download(ffmpegUrl, archivePath);
    if (ext === 'zip') {
      execSync(`unzip -o "${archivePath}" -d "${BIN_DIR}"`, { stdio: 'inherit' });
    } else {
      execSync(`tar xf "${archivePath}" -C "${BIN_DIR}" --strip-components=1`, { stdio: 'inherit' });
    }
    fs.unlinkSync(archivePath);
    const ffmpegBin = path.join(BIN_DIR, 'ffmpeg');
    if (fs.existsSync(ffmpegBin)) {
      fs.chmodSync(ffmpegBin, 0o755);
    }
    console.log('  ffmpeg done');
  } else {
    console.log(`  ffmpeg: no URL for ${PLATFORM}, skipping`);
  }

  console.log('Binary download complete.');
}

main().catch((err) => {
  console.error('Download failed:', err);
  process.exit(1);
});
