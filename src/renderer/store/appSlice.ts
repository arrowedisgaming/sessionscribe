/**
 * Session Scribe — App Slice
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

export type ActiveTab = 'record' | 'sessions' | 'settings';

interface AppState {
  activeTab: ActiveTab;
  isFirstRun: boolean;
  setupComplete: boolean;
  appVersion: string;
}

const initialState: AppState = {
  activeTab: 'record',
  isFirstRun: true,
  setupComplete: false,
  appVersion: '',
};

export const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setActiveTab: (state, action: PayloadAction<ActiveTab>) => {
      state.activeTab = action.payload;
    },
    setFirstRun: (state, action: PayloadAction<boolean>) => {
      state.isFirstRun = action.payload;
    },
    setSetupComplete: (state, action: PayloadAction<boolean>) => {
      state.setupComplete = action.payload;
    },
    setAppVersion: (state, action: PayloadAction<string>) => {
      state.appVersion = action.payload;
    },
  },
});

export const { setActiveTab, setFirstRun, setSetupComplete, setAppVersion } = appSlice.actions;
export default appSlice.reducer;
