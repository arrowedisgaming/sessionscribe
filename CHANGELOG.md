# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0-alpha] - 2026-03-20

### Added
- Jest test infrastructure (115 tests across 7 suites) covering voice receiver, session manager, process tracker, audio processor, transcription manager, connection manager, and recorder
- Process tracker utility (`src/main/utils/process-tracker.ts`) — tracks all spawned child processes (ffmpeg, whisper-cli) for cleanup on app shutdown or cancellation
- Graceful shutdown handler (`before-quit`) — stops active recording, saves session metadata, kills tracked processes, and disconnects Discord before exit
- Disk space monitoring during recording — pre-flight 500MB check before starting, continuous monitoring with auto-stop on critical threshold
- Per-user transcription resilience — one user's corrupted audio no longer kills the entire transcription; partial results are preserved
- Exponential backoff reconnection for Discord voice (up to 5 attempts with 1s-60s delays)
- Worker thread timeout (10 min) for transformers.js engine
- IPC handler registration guard preventing double-registration crashes
- React.memo `SessionRow` component with `useCallback` handlers for session browser performance

### Changed
- All session-manager file operations converted from synchronous to async (`fs/promises`) — eliminates UI freezes during file reads/writes on large sessions
- Recorder flush-to-disk converted to async
- Transcript file reading in IPC handler converted to async
- FLAC conversions now run in parallel batches of 3 (was sequential)
- Recording elapsed timer reduced from 1s to 5s intervals (reduces IPC overhead)
- Silence frame buffer reuse — pushes shared reference instead of copying per-frame (eliminates ~1.8M unnecessary allocations per 2h session)
- Metadata writes are now atomic (write-to-tmp then rename) preventing corruption on crash
- Single-file copy in `createMasterMix` converted from sync to async

### Fixed
- **Critical**: OOM crash (`RangeError: Failed to allocate memory`) during long sessions with multiple users — silence backfill was pushing up to 219,000 individual buffer copies per user into memory. Now spills large silence gaps directly to disk in bounded 2.88 MB chunks, keeping at most 5 seconds (~480 KB) in memory per backfill event. Same fix applied to the end-of-recording silence fill in `stop()`.
- **Critical**: Speaking listener leak in `VoiceStreamManager` — listener was never removed on stop, accumulating per recording session
- **Critical**: `voiceStateUpdate` listener leak in `DiscordConnectionManager` — new listener added on every `connect()` call without cleanup
- **Critical**: Nested networking listeners leak in voice connection — `stateChange` handler registered new listeners on each networking object without removing old ones
- Active opus streams now properly destroyed on recording stop
- ffmpeg and whisper-cli processes now have timeouts (5 min / 10 min) and are tracked for cleanup
- stderr accumulation in ffmpeg and whisper-cli capped at 10KB to prevent memory growth on noisy processes
- 308 redirect code now handled in binary-manager and model-manager downloads
- `SessionManager.getOutputDir()` made public (was private but needed by recorder for disk checks)
