/**
 * Session Scribe — Transcription Slice
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

export type TranscriptionStatus = 'idle' | 'transcribing' | 'complete' | 'error';

interface TranscriptionProgress {
  stage: string;
  percent: number;
  currentUser?: string;
}

interface TranscriptionState {
  status: TranscriptionStatus;
  progress: TranscriptionProgress;
  error?: string;
  sessionId?: string;
}

const initialState: TranscriptionState = {
  status: 'idle',
  progress: { stage: '', percent: 0 },
};

export const transcriptionSlice = createSlice({
  name: 'transcription',
  initialState,
  reducers: {
    setTranscriptionStatus: (state, action: PayloadAction<TranscriptionStatus>) => {
      state.status = action.payload;
    },
    setTranscriptionProgress: (state, action: PayloadAction<TranscriptionProgress>) => {
      state.progress = action.payload;
    },
    setTranscriptionError: (state, action: PayloadAction<string>) => {
      state.status = 'error';
      state.error = action.payload;
    },
    setTranscriptionSessionId: (state, action: PayloadAction<string | undefined>) => {
      state.sessionId = action.payload;
    },
    resetTranscription: () => initialState,
  },
});

export const {
  setTranscriptionStatus, setTranscriptionProgress,
  setTranscriptionError, setTranscriptionSessionId, resetTranscription,
} = transcriptionSlice.actions;
export default transcriptionSlice.reducer;
