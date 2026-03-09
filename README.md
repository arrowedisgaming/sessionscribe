# Session Scribe

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

An Electron desktop app that records Discord voice channels, transcribes them locally with AI, and outputs versioned markdown transcripts. Built for tabletop RPG groups who want to preserve their sessions.

## Download

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [`.dmg`](https://github.com/arrowedisgaming/sessionscribe/releases/latest) |
| macOS (Intel) | [`.dmg`](https://github.com/arrowedisgaming/sessionscribe/releases/latest) |
| Windows | [`.exe`](https://github.com/arrowedisgaming/sessionscribe/releases/latest) |
| Linux (Debian/Ubuntu) | [`.deb`](https://github.com/arrowedisgaming/sessionscribe/releases/latest) |
| Linux (Fedora/RHEL) | [`.rpm`](https://github.com/arrowedisgaming/sessionscribe/releases/latest) |

See all downloads on the [Releases page](https://github.com/arrowedisgaming/sessionscribe/releases/latest).

## Features

- **Per-user audio recording** — Joins your Discord voice channel via a bot and captures each participant as a separate audio track
- **Local AI transcription** — Choose between whisper.cpp (fast native binary) or transformers.js (pure JavaScript, no external binary needed)
- **Speaker-attributed transcripts** — Output is a markdown file with speaker labels and timestamps
- **Session management** — Browse past sessions, re-transcribe with different engines/models, view transcripts in-app
- **Privacy-first** — All audio processing and transcription happens on your machine. Nothing is uploaded anywhere.

## Privacy

Session Scribe is fully local. Audio files are saved to a directory you choose, and transcription runs on your CPU using local models. No data is sent to any cloud service. The only network connection is to Discord (to join your voice channel) and optionally to download models/binaries on first setup.

## Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name
3. Go to **Bot** → click **Reset Token** → copy the token
4. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent**
   - **Message Content Intent**
5. Go to **OAuth2** → **URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Connect`, `Speak`, `Use Voice Activity`
6. Copy the generated URL and open it in your browser to invite the bot to your server

## Usage

1. **Setup Wizard** — On first launch, a welcome screen introduces the app, then guides you through:
   - Entering your Discord bot token
   - Choosing an output directory for recordings
   - Selecting a transcription engine
   - Downloading required binaries (ffmpeg + whisper.cpp) and the default whisper model

2. **Record** — Select a server and voice channel, join it, then hit Record. A timer shows elapsed time. Use **Stop** to end recording, or **Stop & Transcribe** to immediately begin transcription.

3. **Transcribe** — Transcription runs locally using your chosen engine. A progress bar shows the current stage. Completed transcripts appear as versioned markdown files in the session folder.

4. **Browse** — The Sessions tab lists all recordings grouped by campaign. Click **View Transcript** to read in-app, or **Open Folder** to access raw audio files.

## Development

### Prerequisites

- **Node.js** 18+ and npm
- **A Discord bot token** — see setup guide above

### Installation

```bash
git clone https://github.com/arrowedisgaming/sessionscribe.git
cd sessionscribe
npm install
npm start
```

### Building

Build installers for your current platform:

```bash
npm run make              # default arch
npm run make:x64          # x64 only
npm run make:arm64        # arm64 only
```

Output goes to `out/make/`.

## Tech Stack

- **Electron 40** + Electron Forge (webpack-typescript)
- **React 19** + Redux Toolkit + Tailwind CSS 3
- **discord.js 14** + @discordjs/voice + opusscript (pure JS Opus decoding)
- **whisper.cpp** (native) / **transformers.js** (ONNX) for transcription
- Energy-based VAD for speech segmentation

## Project Structure

```
src/
  main/                     # Electron main process
    discord/                # Discord connection & voice receiving
    recording/              # Session recorder, audio processing
    sessions/               # Session CRUD & metadata
    models/                 # Model & binary download management
    transcription/          # Engines, VAD, transcript builder
  preload/                  # contextBridge API
  renderer/                 # React UI
    components/             # SetupWizard, RecordPanel, SessionBrowser, etc.
    store/                  # Redux slices (app, discord, recording, sessions, transcription)
    hooks/                  # useElectronEvent, useConfig
```

## Acknowledgments

Built with the help of [Claude Code](https://claude.ai/claude-code).

## License

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

See [LICENSE](LICENSE) for the full text.
