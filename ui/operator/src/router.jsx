import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Transactions } from './pages/Transactions.jsx';
import { TransactionDetail } from './pages/TransactionDetail.jsx';
import { Fraud } from './pages/Fraud.jsx';
import { Network } from './pages/Network.jsx';
import { Participants } from './pages/Participants.jsx';
import { Settlement } from './pages/Settlement.jsx';
import { Eod } from './pages/Eod.jsx';
import { Audit } from './pages/Audit.jsx';
import { Disputes, Crossborder, NotFound } from './pages/stubs.jsx';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true,                       element: <Dashboard /> },
      { path: 'transactions',              element: <Transactions /> },
      { path: 'transactions/:id',          element: <TransactionDetail /> },
      { path: 'fraud',                     element: <Fraud /> },
      { path: 'network',                   element: <Network /> },
      { path: 'participants',              element: <Participants /> },
      { path: 'settlement',                element: <Settlement /> },
      { path: 'eod',                       element: <Eod /> },
      { path: 'disputes',                  element: <Disputes /> },
      { path: 'crossborder',               element: <Crossborder /> },
      { path: 'audit',                     element: <Audit /> },
      { path: '*',                         element: <NotFound /> }
    ]
  }
]);
