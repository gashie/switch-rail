import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout.jsx';
import { Overview } from './pages/Overview.jsx';
import { Transactions } from './pages/Transactions.jsx';
import { Disputes } from './pages/Disputes.jsx';
import { Aliases } from './pages/Aliases.jsx';
import { Crossborder } from './pages/Crossborder.jsx';
import { Settings } from './pages/Settings.jsx';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true,                element: <Overview /> },
      { path: 'transactions',       element: <Transactions /> },
      { path: 'disputes',           element: <Disputes /> },
      { path: 'aliases',            element: <Aliases /> },
      { path: 'crossborder',        element: <Crossborder /> },
      { path: 'settings',           element: <Settings /> }
    ]
  }
]);
