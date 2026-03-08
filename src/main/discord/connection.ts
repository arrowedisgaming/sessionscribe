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
      await testClient.login(token);
      await new Promise<void>((resolve) => {
        testClient.once('ready', () => resolve());
      });
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
      await this.client.login(token);
      await new Promise<void>((resolve) => {
        this.client!.once('ready', () => resolve());
      });
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

  async joinChannel(
    guildId: string,
    channelId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.client) return { success: false, error: 'Not connected' };

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { success: false, error: 'Guild not found' };

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return { success: false, error: 'Channel not found' };

    try {
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

      await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);

      this.currentGuildId = guildId;
      this.currentChannelId = channelId;
      this.emit('joinedChannel', { guildId, channelId });
      this.emitUsersUpdate();

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
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
