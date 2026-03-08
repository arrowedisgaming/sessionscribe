/**
 * Session Scribe — Discord Slice
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

import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type DiscordStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface Guild {
  id: string;
  name: string;
  icon?: string;
}

export interface VoiceChannel {
  id: string;
  name: string;
  userCount: number;
}

export interface ConnectedUser {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
}

interface DiscordState {
  status: DiscordStatus;
  error?: string;
  guilds: Guild[];
  selectedGuildId?: string;
  voiceChannels: VoiceChannel[];
  selectedChannelId?: string;
  connectedUsers: ConnectedUser[];
  joinedChannel: boolean;
}

const initialState: DiscordState = {
  status: 'disconnected',
  guilds: [],
  voiceChannels: [],
  connectedUsers: [],
  joinedChannel: false,
};

export const discordSlice = createSlice({
  name: 'discord',
  initialState,
  reducers: {
    setStatus: (state, action: PayloadAction<DiscordStatus>) => {
      state.status = action.payload;
      if (action.payload !== 'error') state.error = undefined;
    },
    setError: (state, action: PayloadAction<string>) => {
      state.status = 'error';
      state.error = action.payload;
    },
    setGuilds: (state, action: PayloadAction<Guild[]>) => {
      state.guilds = action.payload;
    },
    setSelectedGuild: (state, action: PayloadAction<string>) => {
      state.selectedGuildId = action.payload;
      state.selectedChannelId = undefined;
      state.voiceChannels = [];
    },
    setVoiceChannels: (state, action: PayloadAction<VoiceChannel[]>) => {
      state.voiceChannels = action.payload;
    },
    setSelectedChannel: (state, action: PayloadAction<string>) => {
      state.selectedChannelId = action.payload;
    },
    setConnectedUsers: (state, action: PayloadAction<ConnectedUser[]>) => {
      state.connectedUsers = action.payload;
    },
    setJoinedChannel: (state, action: PayloadAction<boolean>) => {
      state.joinedChannel = action.payload;
    },
    resetDiscord: () => initialState,
  },
});

export const {
  setStatus, setError, setGuilds, setSelectedGuild,
  setVoiceChannels, setSelectedChannel, setConnectedUsers,
  setJoinedChannel, resetDiscord,
} = discordSlice.actions;
export default discordSlice.reducer;
