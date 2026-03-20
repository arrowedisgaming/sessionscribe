/**
 * Session Scribe — Audio Processor Tests
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import { EventEmitter } from 'events';

// --- Mock: child_process.spawn ---
const createMockProc = () => {
  const proc = new EventEmitter() as any;
  proc.stdin = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  return proc;
};

let lastSpawnedProc: ReturnType<typeof createMockProc>;
let spawnArgs: { command: string; args: string[] }[] = [];

jest.mock('child_process', () => ({
  spawn: jest.fn((command: string, args: string[]) => {
    lastSpawnedProc = createMockProc();
    spawnArgs.push({ command, args });
    return lastSpawnedProc;
  }),
}));

// --- Mock: binary-resolver ---
jest.mock('../../src/main/recording/binary-resolver', () => ({
  resolveBinaryPath: jest.fn(() => '/usr/bin/ffmpeg'),
}));

// --- Mock: process-tracker ---
const mockTrack = jest.fn();
jest.mock('../../src/main/utils/process-tracker', () => ({
  processTracker: {
    track: mockTrack,
  },
}));

// --- Mock: fs/promises (for createMasterMix single-file copy) ---
const mockCopyFile = jest.fn().mockResolvedValue(undefined);
jest.mock('fs/promises', () => ({
  copyFile: mockCopyFile,
}));

import { AudioProcessor } from '../main/recording/audio-processor';

describe('AudioProcessor', () => {
  let processor: AudioProcessor;

  beforeEach(() => {
    processor = new AudioProcessor();
    spawnArgs = [];
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('pcmToFlac()', () => {
    it('spawns ffmpeg with correct args and resolves on exit code 0', async () => {
      const promise = processor.pcmToFlac('/tmp/input.pcm', '/tmp/output.flac');

      // Verify spawn was called with expected args
      expect(spawnArgs).toHaveLength(1);
      expect(spawnArgs[0].command).toBe('/usr/bin/ffmpeg');
      expect(spawnArgs[0].args).toEqual([
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '1',
        '-i', '/tmp/input.pcm',
        '-y',
        '/tmp/output.flac',
      ]);

      // Simulate successful exit
      lastSpawnedProc.emit('close', 0);
      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects on non-zero exit code with stderr in error message', async () => {
      const promise = processor.pcmToFlac('/tmp/input.pcm', '/tmp/output.flac');

      // Simulate stderr output then failure exit
      lastSpawnedProc.stderr.emit('data', Buffer.from('Conversion failed'));
      lastSpawnedProc.emit('close', 1);

      await expect(promise).rejects.toThrow('ffmpeg exited with code 1: Conversion failed');
    });

    it('rejects on spawn error', async () => {
      const promise = processor.pcmToFlac('/tmp/input.pcm', '/tmp/output.flac');

      lastSpawnedProc.emit('error', new Error('ENOENT'));

      await expect(promise).rejects.toThrow('ffmpeg spawn error: ENOENT');
    });

    it('tracks process with processTracker', async () => {
      const promise = processor.pcmToFlac('/tmp/input.pcm', '/tmp/output.flac');

      expect(mockTrack).toHaveBeenCalledTimes(1);
      expect(mockTrack).toHaveBeenCalledWith(lastSpawnedProc);

      lastSpawnedProc.emit('close', 0);
      await promise;
    });

    it('kills process and rejects on timeout', async () => {
      jest.useFakeTimers();

      const promise = processor.pcmToFlac('/tmp/input.pcm', '/tmp/output.flac');

      // Advance past the 5-minute timeout
      jest.advanceTimersByTime(5 * 60_000 + 1);

      await expect(promise).rejects.toThrow('ffmpeg timed out after 300s');
      expect(lastSpawnedProc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('caps stderr accumulation at 10KB', async () => {
      const promise = processor.pcmToFlac('/tmp/input.pcm', '/tmp/output.flac');

      // Emit more than 10KB of stderr data
      const bigChunk = 'x'.repeat(12_000);
      lastSpawnedProc.stderr.emit('data', Buffer.from(bigChunk));

      // Emit exit with non-zero code so we can inspect the error message
      lastSpawnedProc.emit('close', 1);

      let caughtErr: Error | undefined;
      try { await promise; } catch (e) { caughtErr = e as Error; }
      expect(caughtErr).toBeDefined();
      // The stderr should be sliced to the last 10240 chars
      const stderrInMessage = caughtErr!.message.replace('ffmpeg exited with code 1: ', '');
      expect(stderrInMessage.length).toBeLessThanOrEqual(10240);
    });
  });

  describe('createMasterMix()', () => {
    it('returns early for empty input', async () => {
      await processor.createMasterMix([], '/tmp/output.flac');

      // spawn should not have been called
      expect(spawnArgs).toHaveLength(0);
    });

    it('copies single file using fs.promises.copyFile', async () => {
      await processor.createMasterMix(['/tmp/a.flac'], '/tmp/output.flac');

      expect(mockCopyFile).toHaveBeenCalledWith('/tmp/a.flac', '/tmp/output.flac');
      // spawn should not have been called
      expect(spawnArgs).toHaveLength(0);
    });

    it('spawns ffmpeg with amix filter for multiple inputs', async () => {
      const promise = processor.createMasterMix(
        ['/tmp/a.flac', '/tmp/b.flac', '/tmp/c.flac'],
        '/tmp/output.flac'
      );

      expect(spawnArgs).toHaveLength(1);
      expect(spawnArgs[0].command).toBe('/usr/bin/ffmpeg');
      expect(spawnArgs[0].args).toEqual([
        '-i', '/tmp/a.flac',
        '-i', '/tmp/b.flac',
        '-i', '/tmp/c.flac',
        '-filter_complex', 'amix=inputs=3:duration=longest',
        '-y',
        '/tmp/output.flac',
      ]);

      lastSpawnedProc.emit('close', 0);
      await expect(promise).resolves.toBeUndefined();
    });

    it('tracks process and has timeout', async () => {
      jest.useFakeTimers();

      const promise = processor.createMasterMix(
        ['/tmp/a.flac', '/tmp/b.flac'],
        '/tmp/output.flac'
      );

      // Verify process tracking
      expect(mockTrack).toHaveBeenCalledTimes(1);
      expect(mockTrack).toHaveBeenCalledWith(lastSpawnedProc);

      // Advance past the 5-minute timeout
      jest.advanceTimersByTime(5 * 60_000 + 1);

      await expect(promise).rejects.toThrow('ffmpeg mix timed out after 300s');
      expect(lastSpawnedProc.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });
});
