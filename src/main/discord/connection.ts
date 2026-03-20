/**
 * Session Scribe — Discord Connection Manager
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

import { Client, GatewayIntentBits, ChannelType, VoiceState, VoiceBasedChannel, GuildMember, Collection } from 'discord.js';
import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  generateDependencyReport,
} from '@discordjs/voice';
import { EventEmitter } from 'events';

export interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;
}

export interface VoiceChannelInfo {
  id: string;
  name: string;
  userCount: number;
}

export interface ConnectedUserInfo {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export class DiscordConnectionManager extends EventEmitter {
  private client: Client | null = null;
  private connection: VoiceConnection | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private currentGuildId: string | null = null;
  private currentChannelId: string | null = null;
  private voiceStateHandler: ((oldState: VoiceState, newState: VoiceState) => void) | null = null;
  private connectionStateHandler: ((oldState: any, newState: any) => void) | null = null;
  private connectionErrorHandler: ((err: Error) => void) | null = null;
  private connectionDisconnectedHandler: (() => void) | null = null;
  private currentNetworking: any = null;
  private networkingStateHandler: ((nOld: any, nNew: any) => void) | null = null;
  private networkingCloseHandler: ((code: number) => void) | null = null;
  private networkingErrorHandler: ((err: Error) => void) | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private maxReconnectAttempts = 5;

  get status(): ConnectionStatus {
    return this._status;
  }

  private setStatus(status: ConnectionStatus) {
    this._status = status;
    this.emit('statusChanged', status);
  }

  async testToken(token: string): Promise<{ success: boolean; error?: string }> {
    const testClient = new Client({
      intents: [GatewayIntentBits.Guilds],
    });
    try {
      const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timed out')), 10_000);
        testClient.once('ready', () => { clearTimeout(timeout); resolve(); });
      });
      await testClient.login(token);
      await readyPromise;
      testClient.destroy();
      return { success: true };
    } catch (err) {
      testClient.destroy();
      return { success: false, error: (err as Error).message };
    }
  }

  async connect(token: string): Promise<{ success: boolean; error?: string }> {
    if (this.client) {
      this.client.destroy();
    }

    this.setStatus('connecting');

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
      ],
    });

    this.voiceStateHandler = (oldState: VoiceState, newState: VoiceState) => {
      if (this.currentChannelId) {
        if (
          oldState.channelId === this.currentChannelId ||
          newState.channelId === this.currentChannelId
        ) {
          this.emitUsersUpdate();
        }
      }
    };
    this.client.on('voiceStateUpdate', this.voiceStateHandler);

    try {
      const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timed out')), 10_000);
        this.client!.once('ready', () => { clearTimeout(timeout); resolve(); });
      });
      await this.client.login(token);
      await readyPromise;
      this.setStatus('connected');
      return { success: true };
    } catch (err) {
      this.setStatus('error');
      return { success: false, error: (err as Error).message };
    }
  }

  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.removeConnectionListeners();
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
    if (this.client) {
      if (this.voiceStateHandler) {
        this.client.removeListener('voiceStateUpdate', this.voiceStateHandler);
        this.voiceStateHandler = null;
      }
      this.client.destroy();
      this.client = null;
    }
    this.currentGuildId = null;
    this.currentChannelId = null;
    this.setStatus('disconnected');
  }

  getGuilds(): GuildInfo[] {
    if (!this.client) return [];
    return this.client.guilds.cache.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL(),
    }));
  }

  async getVoiceChannels(guildId: string): Promise<VoiceChannelInfo[]> {
    if (!this.client) return [];
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return [];

    const channels = guild.channels.cache.filter(
      (ch) => ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice
    );

    return channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      userCount: ch.isVoiceBased() ? (ch as VoiceBasedChannel).members.size : 0,
    }));
  }

  private checkDaveAvailability(): { available: boolean; error?: string } {
    try {
      require('@snazzah/davey');
      return { available: true };
    } catch (err) {
      const msg = (err as Error).message || '';
      console.error('[DAVE] Failed to load @snazzah/davey:', msg);
      if (msg.includes('native binding')) {
        return {
          available: false,
          error: 'DAVE protocol library missing native binding for this platform. '
            + 'Try: delete node_modules and package-lock.json, then run npm install',
        };
      }
      return {
        available: false,
        error: 'DAVE protocol library failed to load: ' + msg,
      };
    }
  }

  async joinChannel(
    guildId: string,
    channelId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.client) return { success: false, error: 'Not connected' };

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { success: false, error: 'Guild not found' };

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return { success: false, error: 'Channel not found' };

    // Pre-flight: verify DAVE protocol is available (mandatory since 2025)
    const daveCheck = this.checkDaveAvailability();
    if (!daveCheck.available) {
      return { success: false, error: daveCheck.error };
    }

    try {
      console.log('[Voice] Dependency report:\n' + generateDependencyReport());

      if (this.connection) {
        this.connection.destroy();
      }

      this.connection = joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
      });

      // Remove any existing connection listeners before adding new ones
      this.removeConnectionListeners();

      // Networking listener management helpers
      this.networkingStateHandler = (nOld: any, nNew: any) => {
        console.log(`[Voice/Net] ${nOld.code ?? '?'} → ${nNew.code ?? '?'}`);
      };
      this.networkingCloseHandler = (code: number) => {
        console.log(`[Voice/Net] WebSocket closed with code: ${code}`);
      };
      this.networkingErrorHandler = (err: Error) => {
        console.error('[Voice/Net] error:', err.message);
      };

      // Log all state transitions for debugging
      this.connectionStateHandler = (oldState: any, newState: any) => {
        console.log(`[Voice] ${oldState.status} → ${newState.status}`);
        if (newState.networking && newState.networking !== this.currentNetworking) {
          // Remove listeners from previous networking object
          this.removeNetworkingListeners();
          this.currentNetworking = newState.networking;
          this.currentNetworking.on('stateChange', this.networkingStateHandler!);
          this.currentNetworking.on('close', this.networkingCloseHandler!);
          this.currentNetworking.on('error', this.networkingErrorHandler!);
        }
      };
      this.connection.on('stateChange', this.connectionStateHandler);

      this.connectionErrorHandler = (err: Error) => {
        console.error('[Voice] connection error:', err.message);
      };
      this.connection.on('error', this.connectionErrorHandler);

      // Handle disconnects — try to recover with exponential backoff
      this.connectionDisconnectedHandler = async () => {
        try {
          // Wait for the connection to attempt reconnection
          await Promise.race([
            entersState(this.connection!, VoiceConnectionStatus.Signalling, 5_000),
            entersState(this.connection!, VoiceConnectionStatus.Connecting, 5_000),
          ]);
          // Reset reconnect counter on successful recovery
          this.reconnectAttempt = 0;
        } catch {
          if (this.reconnectAttempt < this.maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 60_000);
            console.log(`[Voice] Reconnect attempt ${this.reconnectAttempt + 1}/${this.maxReconnectAttempts} in ${delay}ms`);
            this.reconnectAttempt++;
            this.reconnectTimer = setTimeout(() => {
              try {
                if (this.connection) {
                  this.connection.rejoin();
                }
              } catch {
                // Connection may have been destroyed
              }
            }, delay);
          } else {
            // Exhausted reconnection attempts — destroy
            console.error('[Voice] Exhausted reconnection attempts, destroying connection');
            if (this.connection) {
              this.connection.destroy();
            }
          }
        }
      };
      this.connection.on(VoiceConnectionStatus.Disconnected, this.connectionDisconnectedHandler);

      // Reset reconnect counter when ready
      this.connection.on(VoiceConnectionStatus.Ready, () => {
        this.reconnectAttempt = 0;
      });

      await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);

      this.currentGuildId = guildId;
      this.currentChannelId = channelId;
      this.emit('joinedChannel', { guildId, channelId });
      this.emitUsersUpdate();

      return { success: true };
    } catch (err) {
      const msg = (err as Error).message || '';
      // Provide actionable error for common failure modes
      if (msg === 'The operation was aborted') {
        return {
          success: false,
          error: 'Voice connection timed out. Check that your network allows UDP traffic '
            + 'and that no firewall is blocking Electron.',
        };
      }
      return { success: false, error: msg };
    }
  }

  async leaveChannel(): Promise<void> {
    this.clearReconnectTimer();
    this.removeConnectionListeners();
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
    this.currentGuildId = null;
    this.currentChannelId = null;
    this.emit('leftChannel');
    this.emit('usersUpdated', []);
  }

  getConnectedUsers(): ConnectedUserInfo[] {
    if (!this.client || !this.currentGuildId || !this.currentChannelId) return [];

    const guild = this.client.guilds.cache.get(this.currentGuildId);
    if (!guild) return [];

    const channel = guild.channels.cache.get(this.currentChannelId);
    if (!channel || !channel.isVoiceBased()) return [];

    const voiceChannel = channel as VoiceBasedChannel;
    const members: Collection<string, GuildMember> = voiceChannel.members;

    return members
      .filter((member: GuildMember) => !member.user.bot || member.user.id === this.client!.user?.id)
      .map((member: GuildMember) => ({
        id: member.user.id,
        username: member.user.username,
        displayName: member.displayName,
        avatar: member.user.avatarURL(),
      }));
  }

  getConnection(): VoiceConnection | null {
    return this.connection;
  }

  getClient(): Client | null {
    return this.client;
  }

  getCurrentChannelId(): string | null {
    return this.currentChannelId;
  }

  getCurrentGuildId(): string | null {
    return this.currentGuildId;
  }

  private removeNetworkingListeners(): void {
    if (this.currentNetworking) {
      if (this.networkingStateHandler) this.currentNetworking.removeListener('stateChange', this.networkingStateHandler);
      if (this.networkingCloseHandler) this.currentNetworking.removeListener('close', this.networkingCloseHandler);
      if (this.networkingErrorHandler) this.currentNetworking.removeListener('error', this.networkingErrorHandler);
      this.currentNetworking = null;
    }
  }

  private removeConnectionListeners(): void {
    this.removeNetworkingListeners();
    if (this.connection) {
      if (this.connectionStateHandler) this.connection.removeListener('stateChange', this.connectionStateHandler);
      if (this.connectionErrorHandler) this.connection.removeListener('error', this.connectionErrorHandler);
      if (this.connectionDisconnectedHandler) this.connection.removeListener(VoiceConnectionStatus.Disconnected, this.connectionDisconnectedHandler);
    }
    this.connectionStateHandler = null;
    this.connectionErrorHandler = null;
    this.connectionDisconnectedHandler = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
  }

  private emitUsersUpdate() {
    const users = this.getConnectedUsers();
    this.emit('usersUpdated', users);
  }
}

export const discordConnection = new DiscordConnectionManager();
