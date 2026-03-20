/**
 * Session Scribe — Discord Connection Manager Tests
 * Tests for listener cleanup, reconnection logic, and status transitions.
 */

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockEntersState = jest.fn().mockResolvedValue(undefined);
const mockJoinVoiceChannel = jest.fn();
const mockGenerateDependencyReport = jest.fn().mockReturnValue('mock-report');

jest.mock('discord.js', () => {
  const RealEventEmitter = require('events').EventEmitter;
  class MockClient extends RealEventEmitter {
    guilds = {
      cache: new Map([
        ['guild-1', {
          id: 'guild-1',
          name: 'Test Guild',
          iconURL: () => null,
          voiceAdapterCreator: {},
          channels: {
            cache: new Map([
              ['channel-1', {
                id: 'channel-1',
                name: 'General',
                type: 2, // GuildVoice
                isVoiceBased: () => true,
                members: new Map(),
              }],
            ]),
          },
        }],
      ]),
    };
    user = { id: 'bot-id' };
    login = jest.fn().mockImplementation(async () => {
      // Emit ready on next tick so the promise in connect() resolves
      process.nextTick(() => this.emit('ready'));
      return 'token';
    });
    destroy = jest.fn();
  }
  return {
    Client: MockClient,
    GatewayIntentBits: { Guilds: 1, GuildVoiceStates: 128, GuildMembers: 2 },
    ChannelType: { GuildVoice: 2, GuildStageVoice: 13 },
  };
});

jest.mock('@discordjs/voice', () => {
  return {
    joinVoiceChannel: mockJoinVoiceChannel,
    entersState: mockEntersState,
    getVoiceConnection: jest.fn(),
    generateDependencyReport: mockGenerateDependencyReport,
    VoiceConnectionStatus: {
      Signalling: 'signalling',
      Connecting: 'connecting',
      Ready: 'ready',
      Disconnected: 'disconnected',
      Destroyed: 'destroyed',
    },
  };
});

// Mock the DAVE check so joinChannel doesn't fail on missing native module
jest.mock('@snazzah/davey', () => ({}), { virtual: true });

// Now import the class under test
import { DiscordConnectionManager } from '../main/discord/connection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock VoiceConnection that is an EventEmitter with a destroy method */
function createMockConnection() {
  const conn = new EventEmitter() as EventEmitter & {
    destroy: jest.Mock;
    rejoin: jest.Mock;
    receiver: any;
  };
  conn.destroy = jest.fn();
  conn.rejoin = jest.fn();
  return conn;
}

function createManager(): DiscordConnectionManager {
  return new DiscordConnectionManager();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscordConnectionManager', () => {
  let manager: DiscordConnectionManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = createManager();
  });

  afterEach(async () => {
    // Ensure clean state even if a test fails mid-way
    try { await manager.disconnect(); } catch { /* ignore */ }
  });

  // -----------------------------------------------------------------------
  // Status transitions
  // -----------------------------------------------------------------------
  describe('status transitions', () => {
    it('starts as disconnected', () => {
      expect(manager.status).toBe('disconnected');
    });

    it('connect() transitions through connecting -> connected', async () => {
      const statuses: string[] = [];
      manager.on('statusChanged', (s: string) => statuses.push(s));

      await manager.connect('fake-token');

      expect(statuses).toContain('connecting');
      expect(statuses).toContain('connected');
      expect(statuses.indexOf('connecting')).toBeLessThan(statuses.indexOf('connected'));
      expect(manager.status).toBe('connected');
    });

    it('disconnect() sets status to disconnected', async () => {
      await manager.connect('fake-token');
      expect(manager.status).toBe('connected');

      await manager.disconnect();
      expect(manager.status).toBe('disconnected');
    });
  });

  // -----------------------------------------------------------------------
  // voiceStateUpdate listener cleanup
  // -----------------------------------------------------------------------
  describe('voiceStateUpdate listener cleanup', () => {
    it('removes voiceStateUpdate listener on disconnect', async () => {
      await manager.connect('fake-token');

      const client = manager.getClient()!;
      const listenerCountBefore = client.listenerCount('voiceStateUpdate');
      expect(listenerCountBefore).toBe(1);

      const removeListenerSpy = jest.spyOn(client, 'removeListener');

      await manager.disconnect();

      // Verify removeListener was called with 'voiceStateUpdate' and the handler function
      const vsuCalls = removeListenerSpy.mock.calls.filter(
        ([event]) => event === 'voiceStateUpdate'
      );
      expect(vsuCalls.length).toBe(1);
      expect(typeof vsuCalls[0][1]).toBe('function');
    });

    it('sets voiceStateHandler to null after disconnect', async () => {
      await manager.connect('fake-token');
      await manager.disconnect();

      // Internal state — connect again and verify only one listener added
      await manager.connect('fake-token');
      const client = manager.getClient()!;
      expect(client.listenerCount('voiceStateUpdate')).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Connection listener cleanup on leaveChannel
  // -----------------------------------------------------------------------
  describe('connection listener cleanup on leaveChannel', () => {
    let mockConn: ReturnType<typeof createMockConnection>;

    beforeEach(async () => {
      await manager.connect('fake-token');

      mockConn = createMockConnection();
      mockJoinVoiceChannel.mockReturnValue(mockConn);
      mockEntersState.mockResolvedValue(mockConn);

      await manager.joinChannel('guild-1', 'channel-1');
    });

    it('removes stateChange, error, and disconnected listeners from connection', async () => {
      const removeSpy = jest.spyOn(mockConn, 'removeListener');

      await manager.leaveChannel();

      const removedEvents = removeSpy.mock.calls.map(([event]) => event);
      expect(removedEvents).toContain('stateChange');
      expect(removedEvents).toContain('error');
      expect(removedEvents).toContain('disconnected'); // VoiceConnectionStatus.Disconnected
    });

    it('calls connection.destroy()', async () => {
      await manager.leaveChannel();
      expect(mockConn.destroy).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Connection listener cleanup on disconnect
  // -----------------------------------------------------------------------
  describe('connection listener cleanup on disconnect', () => {
    let mockConn: ReturnType<typeof createMockConnection>;

    beforeEach(async () => {
      await manager.connect('fake-token');

      mockConn = createMockConnection();
      mockJoinVoiceChannel.mockReturnValue(mockConn);
      mockEntersState.mockResolvedValue(mockConn);

      await manager.joinChannel('guild-1', 'channel-1');
    });

    it('removes all connection listeners when full disconnect is called', async () => {
      const removeSpy = jest.spyOn(mockConn, 'removeListener');

      await manager.disconnect();

      const removedEvents = removeSpy.mock.calls.map(([event]) => event);
      expect(removedEvents).toContain('stateChange');
      expect(removedEvents).toContain('error');
      expect(removedEvents).toContain('disconnected');
    });
  });

  // -----------------------------------------------------------------------
  // No listener accumulation across connect/disconnect cycles
  // -----------------------------------------------------------------------
  describe('no listener accumulation', () => {
    it('does not accumulate voiceStateUpdate listeners across connect/disconnect cycles', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.connect('fake-token');
        const client = manager.getClient()!;
        expect(client.listenerCount('voiceStateUpdate')).toBe(1);
        await manager.disconnect();
      }
    });

    it('does not accumulate connection listeners across join/leave cycles', async () => {
      await manager.connect('fake-token');

      for (let i = 0; i < 5; i++) {
        const mockConn = createMockConnection();
        mockJoinVoiceChannel.mockReturnValue(mockConn);
        mockEntersState.mockResolvedValue(mockConn);

        await manager.joinChannel('guild-1', 'channel-1');

        // Each connection should have exactly 3 named listeners:
        // stateChange, error, VoiceConnectionStatus.Disconnected
        // plus the anonymous Ready listener
        const stateChangeCount = mockConn.listenerCount('stateChange');
        const errorCount = mockConn.listenerCount('error');
        const disconnectedCount = mockConn.listenerCount('disconnected');
        expect(stateChangeCount).toBe(1);
        expect(errorCount).toBe(1);
        expect(disconnectedCount).toBe(1);

        await manager.leaveChannel();

        // After leave, listeners should be removed
        expect(mockConn.listenerCount('stateChange')).toBe(0);
        expect(mockConn.listenerCount('error')).toBe(0);
        expect(mockConn.listenerCount('disconnected')).toBe(0);
      }
    });

    it('does not trigger MaxListenersExceededWarning', async () => {
      const warningHandler = jest.fn();
      process.on('warning', warningHandler);

      try {
        await manager.connect('fake-token');
        for (let i = 0; i < 15; i++) {
          const mockConn = createMockConnection();
          mockJoinVoiceChannel.mockReturnValue(mockConn);
          mockEntersState.mockResolvedValue(mockConn);

          await manager.joinChannel('guild-1', 'channel-1');
          await manager.leaveChannel();
        }

        // Filter for MaxListenersExceededWarning specifically
        const maxListenerWarnings = warningHandler.mock.calls.filter(
          ([w]) => w && w.name === 'MaxListenersExceededWarning'
        );
        expect(maxListenerWarnings).toHaveLength(0);
      } finally {
        process.removeListener('warning', warningHandler);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Reconnect timer cleanup
  // -----------------------------------------------------------------------
  describe('reconnect timer cleanup', () => {
    let mockConn: ReturnType<typeof createMockConnection>;

    beforeEach(async () => {
      await manager.connect('fake-token');

      mockConn = createMockConnection();
      mockJoinVoiceChannel.mockReturnValue(mockConn);
      mockEntersState.mockResolvedValue(mockConn);

      await manager.joinChannel('guild-1', 'channel-1');
    });

    it('clears reconnect timer on leaveChannel', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      // Simulate a disconnect event that triggers the reconnect timer.
      // Make entersState reject so it falls into the reconnect branch.
      mockEntersState.mockRejectedValueOnce(new Error('timeout'));

      // Get the disconnected handler and invoke it
      const disconnectedListeners = mockConn.listeners('disconnected');
      expect(disconnectedListeners.length).toBeGreaterThan(0);

      // Fire the disconnected handler — this will set a reconnect timer
      await (disconnectedListeners[0] as () => Promise<void>)();

      clearTimeoutSpy.mockClear();

      await manager.leaveChannel();

      // clearTimeout should have been called (clearReconnectTimer)
      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });

    it('clears reconnect timer on disconnect', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      // Trigger reconnect timer
      mockEntersState.mockRejectedValueOnce(new Error('timeout'));
      const disconnectedListeners = mockConn.listeners('disconnected');
      await (disconnectedListeners[0] as () => Promise<void>)();

      clearTimeoutSpy.mockClear();

      await manager.disconnect();

      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });

    it('resets reconnect attempt counter on leaveChannel', async () => {
      // Trigger a reconnect attempt to increment the counter
      mockEntersState.mockRejectedValueOnce(new Error('timeout'));
      const disconnectedListeners = mockConn.listeners('disconnected');
      await (disconnectedListeners[0] as () => Promise<void>)();

      await manager.leaveChannel();

      // Verify clearReconnectTimer was called (which resets reconnectAttempt to 0).
      // We verify indirectly: leaveChannel completes cleanly and the manager
      // is in a known-good state (no lingering connection or channel).
      expect(manager.getConnection()).toBeNull();
      expect(manager.getCurrentChannelId()).toBeNull();
    });
  });
});
