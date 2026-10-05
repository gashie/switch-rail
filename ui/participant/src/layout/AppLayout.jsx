import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { ToastHost } from '@sika/shared';
import {
  LayoutDashboard, ArrowLeftRight, Gavel, Tags, Globe2, Settings as Cog
} from 'lucide-react';

const NAV = [
  { to: '/',            label: 'Overview',     Icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', Icon: ArrowLeftRight },
  { to: '/disputes',    label: 'Disputes',     Icon: Gavel },
  { to: '/aliases',     label: 'Aliases',      Icon: Tags },
  { to: '/crossborder', label: 'Cross-border', Icon: Globe2 },
  { to: '/settings',    label: 'Settings',     Icon: Cog }
];

export const AppLayout = () => (
  <div className="flex min-h-screen">
    <nav className="w-[240px] h-screen bg-white border-r border-graphite-200 sticky top-0 flex flex-col">
      <div className="h-14 flex items-center gap-2 px-4 border-b border-graphite-200">
        <div className="w-7 h-7 rounded bg-emerald-500 grid place-items-center font-bold text-graphite-900">S</div>
        <div>
          <div className="font-semibold text-base text-graphite-900 leading-tight">Sika</div>
          <div className="text-xs text-graphite-500 leading-tight">Participant</div>
        </div>
      </div>
      <ul className="flex-1 overflow-auto py-2">
        {NAV.map(({ to, label, Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-4 h-10 text-sm transition-colors duration-fast',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                  isActive
                    ? 'bg-emerald-50 text-emerald-800 border-l-2 border-emerald-500'
                    : 'text-graphite-700 hover:bg-graphite-50 border-l-2 border-transparent'
                )
              }
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="px-4 py-3 text-xs text-graphite-500 border-t border-graphite-200">
        BANK-001 · v0.10
      </div>
    </nav>
    <main className="flex-1 p-6 max-w-[1280px] w-full mx-auto">
      <Outlet />
    </main>
    <ToastHost />
  </div>
);

export default AppLayout;
