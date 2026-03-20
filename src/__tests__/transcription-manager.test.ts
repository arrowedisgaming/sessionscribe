/**
 * Session Scribe — Transcription Manager Tests
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 *
 * Tests the per-user resilience: one user's transcription failure
 * must not kill the entire session transcription.
 */

import { SessionMetadata, UserTrack } from '../main/sessions/session-manager';
import { TranscriptionSegment } from '../main/transcription/engine';

// --- Mock: session-manager ---
const mockReadMetadata = jest.fn();
const mockWriteMetadata = jest.fn().mockResolvedValue(undefined);
const mockGetAudioDir = jest.fn();
const mockGetSessionDir = jest.fn();

jest.mock('../../src/main/sessions/session-manager', () => ({
  sessionManager: {
    readMetadata: mockReadMetadata,
    writeMetadata: mockWriteMetadata,
    getAudioDir: mockGetAudioDir,
    getSessionDir: mockGetSessionDir,
  },
}));

// --- Mock: whisper-cpp engine ---
const mockWhisperTranscribe = jest.fn();
const mockWhisperIsAvailable = jest.fn().mockResolvedValue(true);

jest.mock('../../src/main/transcription/whisper-cpp', () => ({
  WhisperCppEngine: jest.fn().mockImplementation(() => ({
    name: 'whisper-cpp',
    transcribe: mockWhisperTranscribe,
    isAvailable: mockWhisperIsAvailable,
  })),
}));

// --- Mock: transformers-js engine ---
const mockTransformersTranscribe = jest.fn();
const mockTransformersIsAvailable = jest.fn().mockResolvedValue(true);

jest.mock('../../src/main/transcription/transformers-js', () => ({
  TransformersJsEngine: jest.fn().mockImplementation(() => ({
    name: 'transformers-js',
    transcribe: mockTransformersTranscribe,
    isAvailable: mockTransformersIsAvailable,
  })),
}));

// --- Mock: transcript-builder ---
const mockBuildTranscript = jest.fn().mockReturnValue('# Transcript content');
const mockWriteTranscript = jest.fn().mockReturnValue('transcript_whisper-cpp_base.md');

jest.mock('../../src/main/transcription/transcript-builder', () => ({
  transcriptBuilder: {
    buildTranscript: mockBuildTranscript,
    writeTranscript: mockWriteTranscript,
  },
}));

// --- Mock: config ---
jest.mock('../../src/main/config', () => ({
  config: {
    get: jest.fn((key: string) => {
      if (key === 'transcriptionEngine') return 'whisper-cpp';
      if (key === 'whisperModel') return 'base';
      return undefined;
    }),
  },
}));

import { TranscriptionManager } from '../main/transcription/transcription-manager';

// --- Helpers ---

function makeUser(id: string, name: string, hasFlac = true): UserTrack {
  return {
    userId: id,
    username: name.toLowerCase(),
    displayName: name,
    flacFile: hasFlac ? `${id}.flac` : undefined,
  };
}

function makeSession(users: UserTrack[], overrides?: Partial<SessionMetadata>): SessionMetadata {
  return {
    id: 'test-session-001',
    guildName: 'Test Guild',
    channelName: 'Voice',
    startedAt: '2026-03-20T10:00:00.000Z',
    status: 'recorded',
    users,
    transcripts: [],
    ...overrides,
  };
}

function makeSegments(count: number): TranscriptionSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 9,
    text: `Segment ${i + 1}`,
  }));
}

describe('TranscriptionManager', () => {
  let manager: TranscriptionManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new TranscriptionManager();
    mockGetAudioDir.mockReturnValue('/sessions/test-session-001/audio');
    mockGetSessionDir.mockReturnValue('/sessions/test-session-001');
    mockWhisperIsAvailable.mockResolvedValue(true);
    mockTransformersIsAvailable.mockResolvedValue(true);
    mockWriteMetadata.mockResolvedValue(undefined);
    mockBuildTranscript.mockReturnValue('# Transcript content');
    mockWriteTranscript.mockReturnValue('transcript_whisper-cpp_base.md');
  });

  describe('successful transcription', () => {
    it('transcribes all users and builds transcript with all segments', async () => {
      const users = [makeUser('u1', 'Alice'), makeUser('u2', 'Bob')];
      const session = makeSession(users);
      mockReadMetadata.mockResolvedValue(session);

      const aliceSegments = makeSegments(3);
      const bobSegments = makeSegments(2);
      mockWhisperTranscribe
        .mockResolvedValueOnce(aliceSegments)
        .mockResolvedValueOnce(bobSegments);

      await manager.transcribe({ sessionId: 'test-session-001' });

      // Verify buildTranscript was called with segments from both users
      expect(mockBuildTranscript).toHaveBeenCalledTimes(1);
      const userSegmentsArg = mockBuildTranscript.mock.calls[0][1];
      expect(userSegmentsArg).toHaveLength(2);
      expect(userSegmentsArg[0]).toEqual({
        userId: 'u1',
        displayName: 'Alice',
        segments: aliceSegments,
      });
      expect(userSegmentsArg[1]).toEqual({
        userId: 'u2',
        displayName: 'Bob',
        segments: bobSegments,
      });

      // Verify writeTranscript was called
      expect(mockWriteTranscript).toHaveBeenCalledWith(
        '/sessions/test-session-001',
        '# Transcript content',
        'whisper-cpp',
        'base'
      );

      // Verify session status set to 'complete'
      const finalWriteCall = mockWriteMetadata.mock.calls[mockWriteMetadata.mock.calls.length - 1][0];
      expect(finalWriteCall.status).toBe('complete');
      expect(finalWriteCall.transcripts).toHaveLength(1);
      expect(finalWriteCall.transcripts[0].engine).toBe('whisper-cpp');
      expect(finalWriteCall.transcripts[0].model).toBe('base');
    });
  });

  describe('per-user resilience', () => {
    it('succeeds when one user fails but others succeed', async () => {
      const users = [makeUser('u1', 'Alice'), makeUser('u2', 'Bob'), makeUser('u3', 'Charlie')];
      const session = makeSession(users);
      mockReadMetadata.mockResolvedValue(session);

      const aliceSegments = makeSegments(3);
      const charlieSegments = makeSegments(2);
      mockWhisperTranscribe
        .mockResolvedValueOnce(aliceSegments)
        .mockRejectedValueOnce(new Error('Audio file corrupted'))
        .mockResolvedValueOnce(charlieSegments);

      // Should NOT throw
      await expect(
        manager.transcribe({ sessionId: 'test-session-001' })
      ).resolves.toBeUndefined();

      // Session status should be 'complete', not 'error'
      const finalWriteCall = mockWriteMetadata.mock.calls[mockWriteMetadata.mock.calls.length - 1][0];
      expect(finalWriteCall.status).toBe('complete');

      // Transcript should be built with only the successful users' segments
      expect(mockBuildTranscript).toHaveBeenCalledTimes(1);
      const userSegmentsArg = mockBuildTranscript.mock.calls[0][1];
      expect(userSegmentsArg).toHaveLength(2);
      expect(userSegmentsArg[0].userId).toBe('u1');
      expect(userSegmentsArg[0].displayName).toBe('Alice');
      expect(userSegmentsArg[1].userId).toBe('u3');
      expect(userSegmentsArg[1].displayName).toBe('Charlie');
      // Bob's segments must not be present
      expect(userSegmentsArg.find((u: any) => u.userId === 'u2')).toBeUndefined();
    });

    it('emits a progress warning for the failed user', async () => {
      const users = [makeUser('u1', 'Alice'), makeUser('u2', 'Bob')];
      const session = makeSession(users);
      mockReadMetadata.mockResolvedValue(session);

      mockWhisperTranscribe
        .mockResolvedValueOnce(makeSegments(1))
        .mockRejectedValueOnce(new Error('Decode error'));

      const progressEvents: any[] = [];
      manager.on('progress', (data) => progressEvents.push(data));

      await manager.transcribe({ sessionId: 'test-session-001' });

      // Find the warning event for Bob
      const warningEvent = progressEvents.find(
        (e) => e.warning && e.stage.includes('Bob')
      );
      expect(warningEvent).toBeDefined();
      expect(warningEvent.warning).toBe('Decode error');
      expect(warningEvent.stage).toContain('Warning');
    });

    it('throws when ALL users fail with combined error message', async () => {
      const users = [makeUser('u1', 'Alice'), makeUser('u2', 'Bob')];
      const session = makeSession(users);
      mockReadMetadata.mockResolvedValue(session);

      mockWhisperTranscribe
        .mockRejectedValueOnce(new Error('Alice audio corrupt'))
        .mockRejectedValueOnce(new Error('Bob audio missing'));

      let caughtErr: Error | undefined;
      try {
        await manager.transcribe({ sessionId: 'test-session-001' });
      } catch (err) {
        caughtErr = err as Error;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr!.message).toContain('All user transcriptions failed');
      expect(caughtErr!.message).toContain('u1');
      expect(caughtErr!.message).toContain('u2');

      // Session status should be set to 'error'
      const errorWriteCall = mockWriteMetadata.mock.calls.find(
        (call: any[]) => call[0].status === 'error'
      );
      expect(errorWriteCall).toBeDefined();
    });
  });

  describe('cancellation', () => {
    it('stops processing when cancelled flag is set', async () => {
      const users = [makeUser('u1', 'Alice'), makeUser('u2', 'Bob')];
      const session = makeSession(users);
      mockReadMetadata.mockResolvedValue(session);

      // First transcribe call will succeed, but we cancel before the second
      mockWhisperTranscribe.mockImplementation(async () => {
        // Cancel after first user starts processing
        manager.cancel();
        return makeSegments(1);
      });

      await expect(
        manager.transcribe({ sessionId: 'test-session-001' })
      ).rejects.toThrow('Transcription cancelled');

      // Only the first user should have been attempted
      // (cancel is checked at the top of the loop before the second user)
      expect(mockWhisperTranscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('throws when session is not found', async () => {
      mockReadMetadata.mockResolvedValue(null);

      await expect(
        manager.transcribe({ sessionId: 'nonexistent' })
      ).rejects.toThrow('Session not found: nonexistent');
    });

    it('throws when engine is not available', async () => {
      const session = makeSession([makeUser('u1', 'Alice')]);
      mockReadMetadata.mockResolvedValue(session);
      mockWhisperIsAvailable.mockResolvedValue(false);

      await expect(
        manager.transcribe({ sessionId: 'test-session-001' })
      ).rejects.toThrow('Engine whisper-cpp is not available');
    });

    it('throws for unknown engine name', async () => {
      const session = makeSession([makeUser('u1', 'Alice')]);
      mockReadMetadata.mockResolvedValue(session);

      await expect(
        manager.transcribe({ sessionId: 'test-session-001', engine: 'nonexistent-engine' })
      ).rejects.toThrow('Unknown engine: nonexistent-engine');
    });
  });

  describe('progress events', () => {
    it('emits progress with user names and percentages', async () => {
      const users = [makeUser('u1', 'Alice'), makeUser('u2', 'Bob')];
      const session = makeSession(users);
      mockReadMetadata.mockResolvedValue(session);

      mockWhisperTranscribe
        .mockResolvedValueOnce(makeSegments(1))
        .mockResolvedValueOnce(makeSegments(1));

      const progressEvents: any[] = [];
      manager.on('progress', (data) => progressEvents.push(data));

      await manager.transcribe({ sessionId: 'test-session-001' });

      // Should have: Transcribing Alice (0%), Transcribing Bob (50%), Building transcript (90%), Complete (100%)
      expect(progressEvents.length).toBeGreaterThanOrEqual(4);

      const aliceStart = progressEvents.find(
        (e) => e.stage === 'Transcribing Alice'
      );
      expect(aliceStart).toBeDefined();
      expect(aliceStart.percent).toBe(0);
      expect(aliceStart.currentUser).toBe('Alice');

      const bobStart = progressEvents.find(
        (e) => e.stage === 'Transcribing Bob'
      );
      expect(bobStart).toBeDefined();
      expect(bobStart.percent).toBe(50);
      expect(bobStart.currentUser).toBe('Bob');

      const buildStage = progressEvents.find(
        (e) => e.stage === 'Building transcript'
      );
      expect(buildStage).toBeDefined();
      expect(buildStage.percent).toBe(90);

      const completeStage = progressEvents.find(
        (e) => e.stage === 'Complete'
      );
      expect(completeStage).toBeDefined();
      expect(completeStage.percent).toBe(100);
    });

    it('emits complete event with sessionId and filename', async () => {
      const users = [makeUser('u1', 'Alice')];
      const session = makeSession(users);
      mockReadMetadata.mockResolvedValue(session);
      mockWhisperTranscribe.mockResolvedValue(makeSegments(1));

      const completeEvents: any[] = [];
      manager.on('complete', (data) => completeEvents.push(data));

      await manager.transcribe({ sessionId: 'test-session-001' });

      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0].sessionId).toBe('test-session-001');
      expect(completeEvents[0].filename).toBe('transcript_whisper-cpp_base.md');
    });

    it('skips users without flacFile and does not count them', async () => {
      const users = [
        makeUser('u1', 'Alice', true),
        makeUser('u2', 'Bob', false),  // no audio recorded
        makeUser('u3', 'Charlie', true),
      ];
      const session = makeSession(users);
      mockReadMetadata.mockResolvedValue(session);

      mockWhisperTranscribe
        .mockResolvedValueOnce(makeSegments(1))
        .mockResolvedValueOnce(makeSegments(1));

      const progressEvents: any[] = [];
      manager.on('progress', (data) => progressEvents.push(data));

      await manager.transcribe({ sessionId: 'test-session-001' });

      // Only Alice and Charlie should be transcribed (2 users with flac)
      expect(mockWhisperTranscribe).toHaveBeenCalledTimes(2);

      // Percentages based on 2 total users: 0% and 50%
      const aliceProgress = progressEvents.find((e) => e.currentUser === 'Alice');
      expect(aliceProgress.percent).toBe(0);
      const charlieProgress = progressEvents.find((e) => e.currentUser === 'Charlie');
      expect(charlieProgress.percent).toBe(50);
    });
  });
});
