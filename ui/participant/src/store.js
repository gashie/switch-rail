import { configureStore } from '@reduxjs/toolkit';
import { sikaApi, toastSlice } from '@sika/shared';

export const store = configureStore({
  reducer: {
    [sikaApi.reducerPath]: sikaApi.reducer,
    toasts: toastSlice.reducer
  },
  middleware: (gDM) => gDM().concat(sikaApi.middleware)
});

export default store;
