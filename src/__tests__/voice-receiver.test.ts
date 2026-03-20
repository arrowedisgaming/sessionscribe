/**
 * Session Scribe — VoiceStreamManager Tests
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 *
 * Critical test suite covering the OOM crash fix: silence gaps > 5s are
 * spilled to disk instead of being held in memory as Buffer objects.
 */

import { EventEmitter } from 'events';

// ---- Mocks ----

// Mock fs — track appendFileSync calls without real I/O
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  appendFileSync: jest.fn(),
}));

// Mock opus-decoder — decode returns a 1920-byte PCM buffer, destroy is a no-op
jest.mock('../main/discord/opus-decoder', () => ({
  OpusDecoder: jest.fn().mockImplementation(() => ({
    decode: jest.fn(() => Buffer.alloc(1920)),
    destroy: jest.fn(),
  })),
}));

// Mock @discordjs/voice — only need EndBehaviorType for subscribe() options
jest.mock('@discordjs/voice', () => ({
  EndBehaviorType: { AfterSilence: 1 },
}));

import fs from 'fs';
import { VoiceStreamManager } from '../main/discord/voice-receiver';

// ---- Test helpers ----

const FRAME_DURATION_MS = 20;
const BYTES_PER_FRAME = 1920; // 960 samples * 2 bytes
const MAX_MEMORY_SILENCE_FRAMES = 250; // 5000ms / 20ms
const SPILL_CHUNK_FRAMES = 1500; // 30_000ms / 20ms

class MockOpusStream extends EventEmitter {
  destroy = jest.fn();
}

function createMockConnection() {
  const speaking = new EventEmitter();
  const subscribe = jest.fn(() => new MockOpusStream());
  return {
    receiver: { speaking, subscribe },
    destroy: jest.fn(),
  };
}

// ---- Tests ----

describe('VoiceStreamManager', () => {
  let manager: VoiceStreamManager;
  let mockConn: ReturnType<typeof createMockConnection>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    manager = new VoiceStreamManager();
    mockConn = createMockConnection();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -- Helpers --

  /** Start the manager with a mock connection and optional audioDir */
  function startManager(audioDir?: string) {
    manager.start(mockConn as any, audioDir);
  }

  /** Emit a speaking 'start' event for the given userId */
  function fireSpeaking(userId: string) {
    mockConn.receiver.speaking.emit('start', userId);
  }

  /** Get the MockOpusStream returned by the most recent subscribe() call */
  function getLastOpusStream(): MockOpusStream {
    const calls = mockConn.receiver.subscribe.mock.results;
    return calls[calls.length - 1].value as MockOpusStream;
  }

  // =========================================================================
  // 1. Small silence gap (< 5s) — all frames stay in memory, no disk spill
  // =========================================================================
  describe('small silence gap (< 5s)', () => {
    it('keeps all silence frames in memory when gap is under MAX_MEMORY_SILENCE_MS', () => {
      startManager('/tmp/audio');

      // Advance 3 seconds after session start, then first speak
      jest.advanceTimersByTime(3_000);
      fireSpeaking('user-1');

      // 3000ms / 20ms = 150 frames should be in memory
      const chunks = manager.getUserPcmChunks('user-1');
      expect(chunks.length).toBe(150);

      // No disk spill
      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    it('keeps exactly MAX_MEMORY_SILENCE_FRAMES in memory at the boundary', () => {
      startManager('/tmp/audio');

      // 5000ms exactly = 250 frames, still within the limit
      jest.advanceTimersByTime(5_000);
      fireSpeaking('user-1');

      const chunks = manager.getUserPcmChunks('user-1');
      expect(chunks.length).toBe(250);
      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. Large silence gap (73-minute real user OOM scenario)
  // =========================================================================
  describe('large silence gap — OOM crash prevention', () => {
    it('spills silence to disk and caps in-memory frames at 250', () => {
      startManager('/tmp/audio');

      // 73 minutes = 4,380,000 ms
      const gapMs = 73 * 60 * 1_000;
      jest.advanceTimersByTime(gapMs);
      fireSpeaking('user-1');

      // In-memory chunks should be capped at MAX_MEMORY_SILENCE_FRAMES
      const chunks = manager.getUserPcmChunks('user-1');
      expect(chunks.length).toBe(MAX_MEMORY_SILENCE_FRAMES);

      // Disk spill must have been called
      expect(fs.appendFileSync).toHaveBeenCalled();
    });

    it('writes correct total bytes to disk for a 73-minute gap', () => {
      startManager('/tmp/audio');

      const gapMs = 73 * 60 * 1_000;
      const totalFrames = Math.floor(gapMs / FRAME_DURATION_MS); // 219,000
      const diskFrames = totalFrames - MAX_MEMORY_SILENCE_FRAMES; // 218,750

      jest.advanceTimersByTime(gapMs);
      fireSpeaking('user-1');

      // Sum all bytes written via appendFileSync
      const calls = (fs.appendFileSync as jest.Mock).mock.calls;
      let totalBytesWritten = 0;
      for (const call of calls) {
        const buf = call[1] as Buffer;
        totalBytesWritten += buf.length;
      }

      const expectedBytes = diskFrames * BYTES_PER_FRAME;
      expect(totalBytesWritten).toBe(expectedBytes);
    });

    it('writes to the correct file path for the user', () => {
      startManager('/tmp/audio');

      jest.advanceTimersByTime(10_000);
      fireSpeaking('user-42');

      const calls = (fs.appendFileSync as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      // Every call should target user-42.raw in the audioDir
      for (const call of calls) {
        expect(call[0]).toBe('/tmp/audio/user-42.raw');
      }
    });

    it('chunks spill writes so no single allocation exceeds ~2.88 MB', () => {
      startManager('/tmp/audio');

      // 73-minute gap
      const gapMs = 73 * 60 * 1_000;
      jest.advanceTimersByTime(gapMs);
      fireSpeaking('user-1');

      const maxChunkBytes = SPILL_CHUNK_FRAMES * BYTES_PER_FRAME; // 1500 * 1920 = 2,880,000

      const calls = (fs.appendFileSync as jest.Mock).mock.calls;
      for (const call of calls) {
        const buf = call[1] as Buffer;
        expect(buf.length).toBeLessThanOrEqual(maxChunkBytes);
      }
    });

    it('produces the correct number of spill chunks for a 73-minute gap', () => {
      startManager('/tmp/audio');

      const gapMs = 73 * 60 * 1_000;
      const totalFrames = Math.floor(gapMs / FRAME_DURATION_MS);
      const diskFrames = totalFrames - MAX_MEMORY_SILENCE_FRAMES;
      const expectedChunks = Math.ceil(diskFrames / SPILL_CHUNK_FRAMES);

      jest.advanceTimersByTime(gapMs);
      fireSpeaking('user-1');

      expect((fs.appendFileSync as jest.Mock).mock.calls.length).toBe(expectedChunks);
    });
  });

  // =========================================================================
  // 3. Multiple users with staggered first-speak times
  // =========================================================================
  describe('multiple users with staggered first-speak', () => {
    it('handles silence independently per user', () => {
      startManager('/tmp/audio');

      // User A speaks at +2s (small gap, in-memory)
      jest.advanceTimersByTime(2_000);
      fireSpeaking('user-a');
      expect(manager.getUserPcmChunks('user-a').length).toBe(100); // 2000/20

      // User B speaks at +30s (large gap, needs spill)
      jest.advanceTimersByTime(28_000); // total now 30s
      fireSpeaking('user-b');
      expect(manager.getUserPcmChunks('user-b').length).toBe(MAX_MEMORY_SILENCE_FRAMES);

      // User A should NOT have been affected by user B's spill
      // User A still has exactly 100 frames (no new silence added yet)
      expect(manager.getUserPcmChunks('user-a').length).toBe(100);

      // Disk spill should only be for user-b
      const spillCalls = (fs.appendFileSync as jest.Mock).mock.calls;
      for (const call of spillCalls) {
        expect(call[0]).toBe('/tmp/audio/user-b.raw');
      }
    });

    it('tracks active user IDs correctly', () => {
      startManager('/tmp/audio');

      jest.advanceTimersByTime(1_000);
      fireSpeaking('user-x');

      jest.advanceTimersByTime(1_000);
      fireSpeaking('user-y');

      const ids = manager.getActiveUserIds().sort();
      expect(ids).toEqual(['user-x', 'user-y']);
    });

    it('emits userStreamStarted for each new user', () => {
      const emitted: string[] = [];
      manager.on('userStreamStarted', (id: string) => emitted.push(id));

      startManager('/tmp/audio');
      jest.advanceTimersByTime(100);
      fireSpeaking('user-1');
      fireSpeaking('user-2');

      expect(emitted).toEqual(['user-1', 'user-2']);
    });

    it('does not duplicate user stream on repeated speaking events', () => {
      const emitted: string[] = [];
      manager.on('userStreamStarted', (id: string) => emitted.push(id));

      startManager('/tmp/audio');
      jest.advanceTimersByTime(100);
      fireSpeaking('user-1');

      // Close the opus stream, then re-fire speaking
      const stream1 = getLastOpusStream();
      stream1.emit('close');

      jest.advanceTimersByTime(100);
      fireSpeaking('user-1');

      // Should only emit once — the user already exists
      expect(emitted).toEqual(['user-1']);
    });
  });

  // =========================================================================
  // 4. stop() silence fill — end-of-recording uses bounded insertion
  // =========================================================================
  describe('stop() end-of-recording silence fill', () => {
    it('inserts bounded silence when stop() is called after a long gap', () => {
      startManager('/tmp/audio');

      jest.advanceTimersByTime(1_000);
      fireSpeaking('user-1');

      // Simulate some audio data coming in
      const opusStream = getLastOpusStream();
      opusStream.emit('data', Buffer.alloc(100));

      // Close the opus stream to set lastPacketTimestamp
      opusStream.emit('close');

      // Advance 10 minutes before stopping
      jest.advanceTimersByTime(10 * 60 * 1_000);
      jest.clearAllMocks(); // Clear spill calls from the initial gap

      const result = manager.stop();

      // The result should contain user-1's chunks
      expect(result.has('user-1')).toBe(true);

      // Verify disk spill happened during stop() for the 10-minute gap
      expect(fs.appendFileSync).toHaveBeenCalled();

      // All spill writes should target user-1.raw
      const spillCalls = (fs.appendFileSync as jest.Mock).mock.calls;
      for (const call of spillCalls) {
        expect(call[0]).toBe('/tmp/audio/user-1.raw');
      }
    });

    it('does not spill to disk on stop() if gap is small', () => {
      startManager('/tmp/audio');

      jest.advanceTimersByTime(100);
      fireSpeaking('user-1');

      const opusStream = getLastOpusStream();
      opusStream.emit('data', Buffer.alloc(100));
      opusStream.emit('close');

      // Only 500ms gap before stop
      jest.advanceTimersByTime(500);
      jest.clearAllMocks();

      manager.stop();

      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    it('returns pcmChunks map keyed by userId', () => {
      startManager('/tmp/audio');

      jest.advanceTimersByTime(100);
      fireSpeaking('user-a');
      fireSpeaking('user-b');

      const result = manager.stop();
      expect(result.size).toBe(2);
      expect(result.has('user-a')).toBe(true);
      expect(result.has('user-b')).toBe(true);
    });
  });

  // =========================================================================
  // 5. Speaking listener cleanup on stop()
  // =========================================================================
  describe('speaking listener cleanup', () => {
    it('removes the speaking listener on stop()', () => {
      startManager('/tmp/audio');

      const listenerCount = () =>
        mockConn.receiver.speaking.listenerCount('start');

      expect(listenerCount()).toBe(1);
      manager.stop();
      expect(listenerCount()).toBe(0);
    });

    it('does not respond to speaking events after stop()', () => {
      startManager('/tmp/audio');
      manager.stop();

      jest.advanceTimersByTime(1_000);
      fireSpeaking('user-late');

      // subscribe should not have been called after stop
      // It may have been called 0 times total (if nobody spoke before stop)
      expect(mockConn.receiver.subscribe).not.toHaveBeenCalled();
      expect(manager.getActiveUserIds()).toEqual([]);
    });
  });

  // =========================================================================
  // 6. Active opus stream destroyed on stop()
  // =========================================================================
  describe('active opus stream cleanup', () => {
    it('destroys active opus streams on stop()', () => {
      startManager('/tmp/audio');

      jest.advanceTimersByTime(100);
      fireSpeaking('user-1');

      const opusStream = getLastOpusStream();
      // Stream is still active (no 'close' emitted)

      manager.stop();
      expect(opusStream.destroy).toHaveBeenCalled();
    });

    it('calls decoder.destroy() for all user streams on stop()', () => {
      const { OpusDecoder } = require('../main/discord/opus-decoder');
      startManager('/tmp/audio');

      jest.advanceTimersByTime(100);
      fireSpeaking('user-1');
      fireSpeaking('user-2');

      manager.stop();

      // Each OpusDecoder instance should have had destroy() called
      const instances = OpusDecoder.mock.results;
      for (const result of instances) {
        expect(result.value.destroy).toHaveBeenCalled();
      }
    });
  });

  // =========================================================================
  // 7. Repeated start/stop cycles — no listener accumulation
  // =========================================================================
  describe('repeated start/stop cycles', () => {
    it('does not accumulate speaking listeners across cycles', () => {
      const listenerCount = () =>
        mockConn.receiver.speaking.listenerCount('start');

      for (let i = 0; i < 5; i++) {
        startManager('/tmp/audio');
        expect(listenerCount()).toBe(1);
        manager.stop();
        expect(listenerCount()).toBe(0);
      }
    });

    it('clears internal streams map on each start()', () => {
      startManager('/tmp/audio');
      jest.advanceTimersByTime(100);
      fireSpeaking('user-old');
      expect(manager.getActiveUserIds()).toEqual(['user-old']);

      manager.stop();

      // Re-create connection for the next cycle since stop() nulls it
      mockConn = createMockConnection();
      startManager('/tmp/audio');
      expect(manager.getActiveUserIds()).toEqual([]);
    });

    it('handles speaking events correctly in a second cycle', () => {
      startManager('/tmp/audio');
      jest.advanceTimersByTime(100);
      fireSpeaking('user-1');
      manager.stop();

      mockConn = createMockConnection();
      startManager('/tmp/audio');
      jest.advanceTimersByTime(200);
      fireSpeaking('user-2');

      expect(manager.getActiveUserIds()).toEqual(['user-2']);
      expect(manager.getUserPcmChunks('user-2').length).toBe(10); // 200ms / 20ms
    });
  });

  // =========================================================================
  // 8. No audioDir provided — graceful fallback
  // =========================================================================
  describe('no audioDir provided', () => {
    it('warns and does not crash when large silence gap occurs without audioDir', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      startManager(); // no audioDir

      jest.advanceTimersByTime(60_000); // 1 minute gap — needs spill
      fireSpeaking('user-1');

      // Should have logged a warning about missing audioDir
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No audioDir set')
      );

      // Should NOT have called appendFileSync (no dir to write to)
      expect(fs.appendFileSync).not.toHaveBeenCalled();

      // Manager should still be functional — only in-memory frames are kept
      const chunks = manager.getUserPcmChunks('user-1');
      expect(chunks.length).toBe(MAX_MEMORY_SILENCE_FRAMES);

      warnSpy.mockRestore();
    });

    it('does not crash on stop() without audioDir after large gap', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      startManager(); // no audioDir

      jest.advanceTimersByTime(1_000);
      fireSpeaking('user-1');

      const opusStream = getLastOpusStream();
      opusStream.emit('data', Buffer.alloc(100));
      opusStream.emit('close');

      jest.advanceTimersByTime(60_000);

      // stop() should not throw
      expect(() => manager.stop()).not.toThrow();

      warnSpy.mockRestore();
    });
  });

  // =========================================================================
  // Opus stream data handling
  // =========================================================================
  describe('opus stream data handling', () => {
    it('pushes decoded PCM to pcmChunks on data event', () => {
      startManager('/tmp/audio');

      jest.advanceTimersByTime(100);
      fireSpeaking('user-1');

      const opusStream = getLastOpusStream();
      const silenceFramesBefore = manager.getUserPcmChunks('user-1').length;

      // Simulate 5 opus packets
      for (let i = 0; i < 5; i++) {
        opusStream.emit('data', Buffer.alloc(80));
      }

      const chunks = manager.getUserPcmChunks('user-1');
      expect(chunks.length).toBe(silenceFramesBefore + 5);
    });

    it('handles opus decode errors without crashing', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { OpusDecoder } = require('../main/discord/opus-decoder');

      startManager('/tmp/audio');
      jest.advanceTimersByTime(100);
      fireSpeaking('user-1');

      // Make the decoder throw on the next decode
      const lastInstance = OpusDecoder.mock.results[OpusDecoder.mock.results.length - 1].value;
      lastInstance.decode.mockImplementationOnce(() => {
        throw new Error('Decode failed');
      });

      const opusStream = getLastOpusStream();
      const chunksBefore = manager.getUserPcmChunks('user-1').length;

      // Should not throw
      opusStream.emit('data', Buffer.alloc(80));

      // Chunk count should not increase (the failed decode is skipped)
      expect(manager.getUserPcmChunks('user-1').length).toBe(chunksBefore);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Opus decode error'),
        expect.any(Error)
      );

      errorSpy.mockRestore();
    });

    it('skips re-subscribe when an opus stream is already active', () => {
      startManager('/tmp/audio');

      jest.advanceTimersByTime(100);
      fireSpeaking('user-1');

      const subscribeCount = mockConn.receiver.subscribe.mock.calls.length;

      // Fire speaking again while stream is still active
      fireSpeaking('user-1');

      expect(mockConn.receiver.subscribe.mock.calls.length).toBe(subscribeCount);
    });

    it('re-subscribes after opus stream closes', () => {
      startManager('/tmp/audio');

      jest.advanceTimersByTime(100);
      fireSpeaking('user-1');

      const opusStream = getLastOpusStream();
      opusStream.emit('close');

      jest.advanceTimersByTime(500);
      fireSpeaking('user-1');

      // Should have subscribed twice
      expect(mockConn.receiver.subscribe.mock.calls.length).toBe(2);
    });
  });

  // =========================================================================
  // getSessionDuration
  // =========================================================================
  describe('getSessionDuration', () => {
    it('returns elapsed time in seconds', () => {
      startManager('/tmp/audio');

      jest.advanceTimersByTime(45_000);
      expect(manager.getSessionDuration()).toBe(45);
    });
  });
});
