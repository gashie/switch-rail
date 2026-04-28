import { Outlet } from 'react-router-dom';
import { ToastHost } from '@sika/shared';
import { SideNav } from './SideNav.jsx';
import { TopBar } from './TopBar.jsx';

export const AppLayout = () => (
  <div className="flex min-h-screen">
    <SideNav />
    <div className="flex-1 flex flex-col min-w-0">
      <TopBar />
      <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">
        <Outlet />
      </main>
    </div>
    <ToastHost />
  </div>
);

export default AppLayout;
