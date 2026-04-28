import { createSlice } from '@reduxjs/toolkit';

let nextId = 1;

const initialState = { items: [] };

export const toastSlice = createSlice({
  name: 'toasts',
  initialState,
  reducers: {
    showToast: {
      prepare: ({ kind = 'info', message, ttl = 4000 } = {}) => ({
        payload: { id: nextId++, kind, message, ttl }
      }),
      reducer: (state, action) => {
        state.items.push(action.payload);
      }
    },
    dismissToast: (state, action) => {
      state.items = state.items.filter((t) => t.id !== action.payload);
    },
    clearToasts: (state) => { state.items = []; }
  }
});

export const { showToast, dismissToast, clearToasts } = toastSlice.actions;
export default toastSlice.reducer;
