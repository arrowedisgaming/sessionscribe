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

    this.client.on('voiceStateUpdate', (oldState: VoiceState, newState: VoiceState) => {
      if (this.currentChannelId) {
        if (
          oldState.channelId === this.currentChannelId ||
          newState.channelId === this.currentChannelId
        ) {
          this.emitUsersUpdate();
        }
      }
    });

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
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
    if (this.client) {
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

      // Track close codes for diagnostics
      let lastCloseCode: number | null = null;

      // Log all state transitions for debugging
      this.connection.on('stateChange', (oldState: any, newState: any) => {
        console.log(`[Voice] ${oldState.status} → ${newState.status}`);
        if (newState.networking) {
          newState.networking.on('stateChange', (nOld: any, nNew: any) => {
            console.log(`[Voice/Net] ${nOld.code ?? '?'} → ${nNew.code ?? '?'}`);
          });
          newState.networking.on('close', (code: number) => {
            console.log(`[Voice/Net] WebSocket closed with code: ${code}`);
            lastCloseCode = code;
          });
          newState.networking.on('error', (err: Error) => {
            console.error('[Voice/Net] error:', err.message);
          });
        }
      });
      this.connection.on('error', (err: Error) => {
        console.error('[Voice] connection error:', err.message);
      });

      // Handle disconnects — try to recover instead of giving up
      this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          // Wait for the connection to attempt reconnection
          await Promise.race([
            entersState(this.connection!, VoiceConnectionStatus.Signalling, 5_000),
            entersState(this.connection!, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          // Genuine disconnect — destroy if still around
          if (this.connection) {
            this.connection.destroy();
          }
        }
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

  private emitUsersUpdate() {
    const users = this.getConnectedUsers();
    this.emit('usersUpdated', users);
  }
}

export const discordConnection = new DiscordConnectionManager();
