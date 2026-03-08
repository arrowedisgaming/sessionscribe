/**
 * Session Scribe — Sessions Slice
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

export interface SessionSummary {
  id: string;
  campaign?: string;
  guildName: string;
  channelName: string;
  startedAt: string;
  durationSeconds?: number;
  status: string;
  transcriptCount: number;
}

interface SessionsState {
  sessions: SessionSummary[];
  selectedSessionId?: string;
  loading: boolean;
}

const initialState: SessionsState = {
  sessions: [],
  loading: false,
};

export const sessionsSlice = createSlice({
  name: 'sessions',
  initialState,
  reducers: {
    setSessions: (state, action: PayloadAction<SessionSummary[]>) => {
      state.sessions = action.payload;
    },
    setSelectedSession: (state, action: PayloadAction<string | undefined>) => {
      state.selectedSessionId = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
  },
});

export const { setSessions, setSelectedSession, setLoading } = sessionsSlice.actions;
export default sessionsSlice.reducer;
