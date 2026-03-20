/**
 * Session Scribe — Session Manager Tests
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock ../config before importing the module under test.
// SessionManager only uses config.get('outputDir'), so that's all we mock.
let testOutputDir: string;

jest.mock('../main/config', () => ({
  config: {
    get: (key: string) => {
      if (key === 'outputDir') return testOutputDir;
      return undefined;
    },
  },
}));

import { SessionManager, SessionMetadata } from '../main/sessions/session-manager';

describe('SessionManager', () => {
  let manager: SessionManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-scribe-test-'));
    testOutputDir = tmpDir;
    manager = new SessionManager();
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  describe('getOutputDir()', () => {
    it('returns the config outputDir value', () => {
      expect(manager.getOutputDir()).toBe(tmpDir);
    });
  });

  describe('createSession()', () => {
    it('creates directory structure with audio subdirectory', async () => {
      const meta = await manager.createSession('Test Guild', 'voice-chat');

      const sessionDir = path.join(tmpDir, meta.id);
      const audioDir = path.join(sessionDir, 'audio');

      expect(fs.existsSync(sessionDir)).toBe(true);
      expect(fs.existsSync(audioDir)).toBe(true);
    });

    it('writes session.json with correct metadata', async () => {
      const meta = await manager.createSession('Test Guild', 'voice-chat', 'My Campaign');

      const sessionJsonPath = path.join(tmpDir, meta.id, 'session.json');
      expect(fs.existsSync(sessionJsonPath)).toBe(true);

      const written = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));
      expect(written.guildName).toBe('Test Guild');
      expect(written.channelName).toBe('voice-chat');
      expect(written.campaign).toBe('My Campaign');
      expect(written.status).toBe('recording');
      expect(written.users).toEqual([]);
      expect(written.transcripts).toEqual([]);
    });

    it('returns correct metadata shape', async () => {
      const meta = await manager.createSession('Guild', 'Channel');

      expect(meta).toMatchObject({
        guildName: 'Guild',
        channelName: 'Channel',
        status: 'recording',
        users: [],
        transcripts: [],
      });
      expect(meta.id).toBeDefined();
      expect(meta.startedAt).toBeDefined();
      // The ID is an ISO timestamp with colons/dots replaced
      expect(meta.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    });

    it('sets campaign to undefined when not provided', async () => {
      const meta = await manager.createSession('Guild', 'Channel');
      expect(meta.campaign).toBeUndefined();
    });
  });

  describe('readMetadata()', () => {
    it('reads back what was written by createSession', async () => {
      const created = await manager.createSession('Guild', 'Channel', 'Campaign');
      const read = await manager.readMetadata(created.id);

      expect(read).toEqual(created);
    });

    it('returns null for a non-existent session', async () => {
      const result = await manager.readMetadata('2099-01-01T00-00-00');
      expect(result).toBeNull();
    });
  });

  describe('writeMetadata()', () => {
    it('performs atomic write (no .tmp file left behind)', async () => {
      const created = await manager.createSession('Guild', 'Channel');

      // Modify and write again
      const updated: SessionMetadata = { ...created, status: 'complete' };
      await manager.writeMetadata(updated);

      const sessionDir = path.join(tmpDir, created.id);
      const files = fs.readdirSync(sessionDir);

      expect(files).toContain('session.json');
      expect(files).not.toContain('session.json.tmp');
    });

    it('persists updated data correctly', async () => {
      const created = await manager.createSession('Guild', 'Channel');

      const updated: SessionMetadata = {
        ...created,
        status: 'complete',
        stoppedAt: new Date().toISOString(),
        durationSeconds: 300,
      };
      await manager.writeMetadata(updated);

      const read = await manager.readMetadata(created.id);
      expect(read).toEqual(updated);
      expect(read!.status).toBe('complete');
      expect(read!.durationSeconds).toBe(300);
    });
  });

  describe('listSessions()', () => {
    it('returns sessions sorted by startedAt descending', async () => {
      // Create sessions with known ordering — IDs are based on timestamp
      const s1 = await manager.createSession('Guild', 'Channel-1');

      // Manually create a session with an earlier timestamp
      const earlierId = '2020-01-01T00-00-00';
      const earlierDir = path.join(tmpDir, earlierId);
      await fsp.mkdir(earlierDir, { recursive: true });
      const earlierMeta: SessionMetadata = {
        id: earlierId,
        guildName: 'Guild',
        channelName: 'Channel-0',
        startedAt: '2020-01-01T00:00:00.000Z',
        status: 'complete',
        users: [],
        transcripts: [],
      };
      await fsp.writeFile(
        path.join(earlierDir, 'session.json'),
        JSON.stringify(earlierMeta, null, 2),
        'utf-8'
      );

      const sessions = await manager.listSessions();
      expect(sessions.length).toBe(2);
      // Most recent first
      expect(sessions[0].id).toBe(s1.id);
      expect(sessions[1].id).toBe(earlierId);
    });

    it('returns empty array when output dir does not exist', async () => {
      // Point to a non-existent directory
      testOutputDir = path.join(tmpDir, 'nonexistent');
      const sessions = await manager.listSessions();
      expect(sessions).toEqual([]);
    });

    it('skips directories without session.json', async () => {
      await manager.createSession('Guild', 'Channel');
      // Create a stray directory with no session.json
      await fsp.mkdir(path.join(tmpDir, 'random-dir'), { recursive: true });

      const sessions = await manager.listSessions();
      expect(sessions.length).toBe(1);
    });
  });

  describe('deleteSession()', () => {
    it('removes the session directory', async () => {
      const meta = await manager.createSession('Guild', 'Channel');
      const sessionDir = path.join(tmpDir, meta.id);

      expect(fs.existsSync(sessionDir)).toBe(true);
      await manager.deleteSession(meta.id);
      expect(fs.existsSync(sessionDir)).toBe(false);
    });

    it('throws for a non-existent session', async () => {
      await expect(
        manager.deleteSession('2099-01-01T00-00-00')
      ).rejects.toThrow('Session not found: 2099-01-01T00-00-00');
    });
  });

  describe('finalizeSession()', () => {
    it('sets status to "recorded" and calculates duration', async () => {
      const created = await manager.createSession('Guild', 'Channel');

      // Simulate some time passing by writing a known startedAt
      const startTime = new Date('2026-01-01T12:00:00.000Z');
      const updatedMeta: SessionMetadata = {
        ...created,
        startedAt: startTime.toISOString(),
        status: 'incomplete',
      };
      await manager.writeMetadata(updatedMeta);

      const beforeFinalize = Date.now();
      await manager.finalizeSession(created.id);
      const afterFinalize = Date.now();

      const finalized = await manager.readMetadata(created.id);
      expect(finalized).not.toBeNull();
      expect(finalized!.status).toBe('recorded');
      expect(finalized!.stoppedAt).toBeDefined();
      expect(finalized!.durationSeconds).toBeDefined();
      expect(finalized!.durationSeconds).toBeGreaterThan(0);

      // stoppedAt should be between beforeFinalize and afterFinalize
      const stoppedAtMs = new Date(finalized!.stoppedAt!).getTime();
      expect(stoppedAtMs).toBeGreaterThanOrEqual(beforeFinalize - 1000);
      expect(stoppedAtMs).toBeLessThanOrEqual(afterFinalize + 1000);
    });

    it('preserves existing stoppedAt if already set', async () => {
      const created = await manager.createSession('Guild', 'Channel');
      const knownStop = '2026-01-01T13:00:00.000Z';
      const updatedMeta: SessionMetadata = {
        ...created,
        startedAt: '2026-01-01T12:00:00.000Z',
        stoppedAt: knownStop,
        status: 'incomplete',
      };
      await manager.writeMetadata(updatedMeta);

      await manager.finalizeSession(created.id);

      const finalized = await manager.readMetadata(created.id);
      expect(finalized!.stoppedAt).toBe(knownStop);
      expect(finalized!.durationSeconds).toBe(3600); // 1 hour
    });

    it('throws for a non-existent session', async () => {
      await expect(
        manager.finalizeSession('2099-01-01T00-00-00')
      ).rejects.toThrow('Session not found: 2099-01-01T00-00-00');
    });
  });

  describe('getIncompleteSessions()', () => {
    it('returns only sessions with status "incomplete"', async () => {
      // Create sessions with distinct IDs to avoid timestamp collisions
      const baseMeta: SessionMetadata = {
        id: '',
        guildName: 'Guild',
        channelName: 'Ch',
        startedAt: new Date().toISOString(),
        status: 'recording',
        users: [],
        transcripts: [],
      };

      const ids = ['test-sess-1', 'test-sess-2', 'test-sess-3'];
      for (const id of ids) {
        await fsp.mkdir(path.join(tmpDir, id, 'audio'), { recursive: true });
      }

      const s1 = { ...baseMeta, id: ids[0] };
      const s2 = { ...baseMeta, id: ids[1] };
      const s3 = { ...baseMeta, id: ids[2] };

      await manager.writeMetadata({ ...s1, status: 'incomplete' });
      await manager.writeMetadata({ ...s2, status: 'complete' });
      await manager.writeMetadata({ ...s3, status: 'incomplete' });

      const incomplete = await manager.getIncompleteSessions();
      expect(incomplete.length).toBe(2);
      const incompleteIds = incomplete.map((s) => s.id);
      expect(incompleteIds).toContain(s1.id);
      expect(incompleteIds).toContain(s3.id);
    });

    it('returns empty array when no sessions are incomplete', async () => {
      const id = 'test-complete-only';
      await fsp.mkdir(path.join(tmpDir, id, 'audio'), { recursive: true });
      const meta: SessionMetadata = {
        id,
        guildName: 'Guild',
        channelName: 'Ch1',
        startedAt: new Date().toISOString(),
        status: 'complete',
        users: [],
        transcripts: [],
      };
      await manager.writeMetadata(meta);

      const incomplete = await manager.getIncompleteSessions();
      expect(incomplete).toEqual([]);
    });
  });

  describe('validateSessionId()', () => {
    it('rejects path traversal attempts via getSessionDir', () => {
      expect(() => manager.getSessionDir('../../etc')).toThrow('Invalid session ID');
      expect(() => manager.getSessionDir('../passwd')).toThrow('Invalid session ID');
      expect(() => manager.getSessionDir('foo/bar')).toThrow('Invalid session ID');
      expect(() => manager.getSessionDir('foo\\bar')).toThrow('Invalid session ID');
      expect(() => manager.getSessionDir('')).toThrow('Invalid session ID');
    });

    it('accepts valid session IDs', () => {
      expect(() => manager.getSessionDir('2026-01-01T12-00-00')).not.toThrow();
      expect(() => manager.getSessionDir('my_session-123')).not.toThrow();
    });

    it('rejects path traversal via deleteSession', async () => {
      await expect(
        manager.deleteSession('../../etc/passwd')
      ).rejects.toThrow('Invalid session ID');
    });
  });
});
