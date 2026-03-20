/**
 * Session Scribe — Session Recorder Tests
 * Tests for disk monitoring, parallel FLAC conversion, and recording lifecycle.
 */

import { EventEmitter } from 'events';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Mock setup — declared before imports
// ---------------------------------------------------------------------------

// VoiceStreamManager mock
const mockVoiceStreamStart = jest.fn();
const mockVoiceStreamStop = jest.fn().mockReturnValue(new Map());
jest.mock('../main/discord/voice-receiver', () => {
  return {
    VoiceStreamManager: jest.fn().mockImplementation(() => ({
      start: mockVoiceStreamStart,
      stop: mockVoiceStreamStop,
      getActiveUserIds: jest.fn().mockReturnValue([]),
      getUserPcmChunks: jest.fn().mockReturnValue([]),
    })),
  };
});

// AudioProcessor mock
const mockPcmToFlac = jest.fn().mockResolvedValue(undefined);
const mockCreateMasterMix = jest.fn().mockResolvedValue(undefined);
jest.mock('../main/recording/audio-processor', () => {
  return {
    AudioProcessor: jest.fn().mockImplementation(() => ({
      pcmToFlac: mockPcmToFlac,
      createMasterMix: mockCreateMasterMix,
    })),
  };
});

// DiskMonitor mock — real EventEmitter so we can fire events in tests
let mockDiskMonitorInstance: EventEmitter & { start: jest.Mock; stop: jest.Mock };
jest.mock('../main/recording/disk-monitor', () => {
  return {
    DiskMonitor: jest.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      (emitter as any).start = jest.fn();
      (emitter as any).stop = jest.fn();
      mockDiskMonitorInstance = emitter as any;
      return mockDiskMonitorInstance;
    }),
  };
});

// sessionManager mock
const mockCreateSession = jest.fn();
const mockWriteMetadata = jest.fn().mockResolvedValue(undefined);
const mockGetOutputDir = jest.fn().mockReturnValue('/tmp/test-sessions');
const mockGetAudioDir = jest.fn().mockReturnValue('/tmp/test-sessions/test-id/audio');
jest.mock('../main/sessions/session-manager', () => ({
  sessionManager: {
    createSession: mockCreateSession,
    writeMetadata: mockWriteMetadata,
    getOutputDir: mockGetOutputDir,
    getAudioDir: mockGetAudioDir,
  },
}));

// discordConnection mock
jest.mock('../main/discord/connection', () => ({
  discordConnection: {
    getCurrentGuildId: jest.fn().mockReturnValue('guild-1'),
    getCurrentChannelId: jest.fn().mockReturnValue('channel-1'),
    getClient: jest.fn().mockReturnValue({
      guilds: {
        cache: new Map([
          ['guild-1', {
            name: 'Test Guild',
            channels: { cache: new Map([['channel-1', { name: 'General' }]]) },
          }],
        ]),
      },
    }),
    getConnectedUsers: jest.fn().mockReturnValue([]),
  },
}));

// fs/promises mock
jest.mock('fs/promises', () => ({
  access: jest.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

// Now import the class under test
import { SessionRecorder } from '../main/recording/recorder';
import { SessionMetadata } from '../main/sessions/session-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockConnection(): any {
  return { receiver: {} };
}

function createTestSession(): SessionMetadata {
  return {
    id: 'test-session-id',
    guildName: 'Test Guild',
    channelName: 'General',
    startedAt: new Date().toISOString(),
    status: 'recording',
    users: [],
    transcripts: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionRecorder', () => {
  let recorder: SessionRecorder;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    recorder = new SessionRecorder();

    // Default: enough disk space
    jest.spyOn(fs, 'statfsSync').mockReturnValue({
      bavail: 1000,
      bsize: 1024 * 1024, // 1000 MB free
    } as any);

    // Default: existsSync returns true for FLAC files
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);

    mockCreateSession.mockResolvedValue(createTestSession());
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // start() — disk space pre-flight
  // -----------------------------------------------------------------------
  describe('start() disk space checks', () => {
    it('refuses to start when disk space is below 500MB', async () => {
      jest.spyOn(fs, 'statfsSync').mockReturnValue({
        bavail: 100,
        bsize: 1024 * 1024, // 100 MB — below threshold
      } as any);

      const conn = createMockConnection();

      await expect(recorder.start(conn)).rejects.toThrow('Insufficient disk space');
      expect(recorder.recording).toBe(false);
    });

    it('allows start when disk space is exactly 500MB', async () => {
      jest.spyOn(fs, 'statfsSync').mockReturnValue({
        bavail: 500,
        bsize: 1024 * 1024, // 500 MB — exactly at threshold
      } as any);

      const conn = createMockConnection();
      const session = await recorder.start(conn);

      expect(session).toBeDefined();
      expect(recorder.recording).toBe(true);
    });

    it('allows start when statfsSync fails (non-disk-space error)', async () => {
      jest.spyOn(fs, 'statfsSync').mockImplementation(() => {
        throw new Error('ENOSYS: function not implemented');
      });

      const conn = createMockConnection();
      const session = await recorder.start(conn);

      expect(session).toBeDefined();
      expect(recorder.recording).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // start() — DiskMonitor integration
  // -----------------------------------------------------------------------
  describe('start() DiskMonitor integration', () => {
    it('creates and starts a DiskMonitor', async () => {
      const conn = createMockConnection();
      await recorder.start(conn);

      expect(mockDiskMonitorInstance).toBeDefined();
      expect(mockDiskMonitorInstance.start).toHaveBeenCalledTimes(1);
    });

    it('passes the output directory to DiskMonitor', async () => {
      const { DiskMonitor } = require('../main/recording/disk-monitor');
      const conn = createMockConnection();
      await recorder.start(conn);

      expect(DiskMonitor).toHaveBeenCalledWith('/tmp/test-sessions');
    });
  });

  // -----------------------------------------------------------------------
  // stop() — DiskMonitor cleanup
  // -----------------------------------------------------------------------
  describe('stop() DiskMonitor cleanup', () => {
    it('stops the DiskMonitor on stop()', async () => {
      const conn = createMockConnection();
      await recorder.start(conn);

      mockVoiceStreamStop.mockReturnValue(new Map());

      await recorder.stop();

      expect(mockDiskMonitorInstance.stop).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Disk critical event — auto-stop
  // -----------------------------------------------------------------------
  describe('disk critical event', () => {
    it('stops recording when DiskMonitor emits critical', async () => {
      const conn = createMockConnection();
      await recorder.start(conn);

      mockVoiceStreamStop.mockReturnValue(new Map());

      const diskCriticalHandler = jest.fn();
      recorder.on('diskCritical', diskCriticalHandler);

      // Emit the critical event from the DiskMonitor
      mockDiskMonitorInstance.emit('critical', 100 * 1024 * 1024);

      // The stop() call inside the handler is async, so we need to flush promises
      await jest.runAllTimersAsync();

      expect(diskCriticalHandler).toHaveBeenCalledWith(100 * 1024 * 1024);
      expect(recorder.recording).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Parallel FLAC conversion — batches of 3
  // -----------------------------------------------------------------------
  describe('parallel FLAC conversion', () => {
    it('converts FLAC files in batches of 3, not all at once', async () => {
      // This test needs real timers because it tracks async concurrency
      jest.useRealTimers();

      const conn = createMockConnection();

      // Re-mock statfsSync since restoreAllMocks was not called
      jest.spyOn(fs, 'statfsSync').mockReturnValue({
        bavail: 1000, bsize: 1024 * 1024,
      } as any);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      mockCreateSession.mockResolvedValue(createTestSession());
      recorder = new SessionRecorder();
      await recorder.start(conn);

      // Simulate 6 users with PCM data
      const pcmData = new Map<string, Buffer[]>();
      for (let i = 1; i <= 6; i++) {
        pcmData.set(`user-${i}`, [Buffer.alloc(1024)]);
      }
      mockVoiceStreamStop.mockReturnValue(pcmData);

      // Track concurrency of pcmToFlac calls
      let activeCalls = 0;
      let maxConcurrency = 0;

      mockPcmToFlac.mockImplementation(async () => {
        activeCalls++;
        maxConcurrency = Math.max(maxConcurrency, activeCalls);
        // Simulate brief async work without setTimeout
        await Promise.resolve();
        await Promise.resolve();
        activeCalls--;
      });

      await recorder.stop();

      // All 6 should have been converted
      expect(mockPcmToFlac).toHaveBeenCalledTimes(6);

      // Max concurrency should be 3 (batch size), not 6
      expect(maxConcurrency).toBeLessThanOrEqual(3);

      // Restore fake timers for remaining tests
      jest.useFakeTimers();
    });

    it('calls pcmToFlac for each user with correct paths', async () => {
      // This test needs real timers for async stop()
      jest.useRealTimers();

      jest.spyOn(fs, 'statfsSync').mockReturnValue({
        bavail: 1000, bsize: 1024 * 1024,
      } as any);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      mockCreateSession.mockResolvedValue(createTestSession());
      recorder = new SessionRecorder();

      const conn = createMockConnection();
      await recorder.start(conn);

      const pcmData = new Map<string, Buffer[]>();
      pcmData.set('user-a', [Buffer.alloc(512)]);
      pcmData.set('user-b', [Buffer.alloc(512)]);
      mockVoiceStreamStop.mockReturnValue(pcmData);

      await recorder.stop();

      expect(mockPcmToFlac).toHaveBeenCalledTimes(2);

      const inputPaths = mockPcmToFlac.mock.calls.map((call: any[]) => call[0]);
      expect(inputPaths).toContain('/tmp/test-sessions/test-id/audio/user-a.raw');
      expect(inputPaths).toContain('/tmp/test-sessions/test-id/audio/user-b.raw');

      jest.useFakeTimers();
    });
  });

  // -----------------------------------------------------------------------
  // stop() — writes metadata with 'recorded' status
  // -----------------------------------------------------------------------
  describe('stop() metadata', () => {
    it('writes metadata with recorded status', async () => {
      const conn = createMockConnection();
      await recorder.start(conn);

      mockVoiceStreamStop.mockReturnValue(new Map());

      const result = await recorder.stop();

      expect(mockWriteMetadata).toHaveBeenCalledTimes(1);
      const writtenMeta = mockWriteMetadata.mock.calls[0][0];
      expect(writtenMeta.status).toBe('recorded');
      expect(writtenMeta.stoppedAt).toBeDefined();
      expect(typeof writtenMeta.durationSeconds).toBe('number');
    });

    it('returns the completed session metadata', async () => {
      const conn = createMockConnection();
      await recorder.start(conn);

      mockVoiceStreamStop.mockReturnValue(new Map());

      const result = await recorder.stop();

      expect(result.id).toBe('test-session-id');
      expect(result.status).toBe('recorded');
    });
  });

  // -----------------------------------------------------------------------
  // Double start / stop when not recording
  // -----------------------------------------------------------------------
  describe('error conditions', () => {
    it('throws "Already recording" on double start', async () => {
      const conn = createMockConnection();
      await recorder.start(conn);

      await expect(recorder.start(conn)).rejects.toThrow('Already recording');
    });

    it('throws "Not recording" when stop() called without start()', async () => {
      await expect(recorder.stop()).rejects.toThrow('Not recording');
    });

    it('throws "Not recording" when stop() called after already stopped', async () => {
      const conn = createMockConnection();
      await recorder.start(conn);

      mockVoiceStreamStop.mockReturnValue(new Map());
      await recorder.stop();

      await expect(recorder.stop()).rejects.toThrow('Not recording');
    });
  });

  // -----------------------------------------------------------------------
  // Timer interval — 5 seconds, not 1 second
  // -----------------------------------------------------------------------
  describe('timer interval', () => {
    it('emits timer event every 5 seconds', async () => {
      const conn = createMockConnection();
      await recorder.start(conn);

      const timerHandler = jest.fn();
      recorder.on('timer', timerHandler);

      // Advance 4 seconds — should NOT have fired yet
      jest.advanceTimersByTime(4000);
      expect(timerHandler).not.toHaveBeenCalled();

      // Advance to 5 seconds — should fire once
      jest.advanceTimersByTime(1000);
      expect(timerHandler).toHaveBeenCalledTimes(1);

      // Advance to 10 seconds — should fire twice total
      jest.advanceTimersByTime(5000);
      expect(timerHandler).toHaveBeenCalledTimes(2);

      // Clean up
      mockVoiceStreamStop.mockReturnValue(new Map());
      await recorder.stop();
    });

    it('stops the timer on stop()', async () => {
      const conn = createMockConnection();
      await recorder.start(conn);

      const timerHandler = jest.fn();
      recorder.on('timer', timerHandler);

      mockVoiceStreamStop.mockReturnValue(new Map());
      await recorder.stop();

      // Advance well past the interval — no more events should fire
      jest.advanceTimersByTime(20000);
      expect(timerHandler).not.toHaveBeenCalled();
    });
  });
});
