/**
 * Session Scribe — Recording Slice
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

export type RecordingStatus = 'idle' | 'recording' | 'stopping' | 'finalizing';

interface RecordingState {
  status: RecordingStatus;
  elapsedSeconds: number;
  sessionId?: string;
  campaign?: string;
  error?: string;
}

const initialState: RecordingState = {
  status: 'idle',
  elapsedSeconds: 0,
};

export const recordingSlice = createSlice({
  name: 'recording',
  initialState,
  reducers: {
    setRecordingStatus: (state, action: PayloadAction<RecordingStatus>) => {
      state.status = action.payload;
    },
    setElapsedSeconds: (state, action: PayloadAction<number>) => {
      state.elapsedSeconds = action.payload;
    },
    setSessionId: (state, action: PayloadAction<string | undefined>) => {
      state.sessionId = action.payload;
    },
    setCampaign: (state, action: PayloadAction<string | undefined>) => {
      state.campaign = action.payload;
    },
    setRecordingError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
    },
    resetRecording: () => initialState,
  },
});

export const {
  setRecordingStatus, setElapsedSeconds, setSessionId,
  setCampaign, setRecordingError, resetRecording,
} = recordingSlice.actions;
export default recordingSlice.reducer;
