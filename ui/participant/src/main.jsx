import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router-dom';
import { AuthGate } from '@sika/shared';
import { store } from './store.js';
import { router } from './router.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <AuthGate appName="Sika Participant">
        <RouterProvider router={router} />
      </AuthGate>
    </Provider>
  </StrictMode>
);
