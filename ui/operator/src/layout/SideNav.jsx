import clsx from 'clsx';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ArrowLeftRight, ShieldAlert, Users, Coins,
  Calendar, Gavel, Globe2, ScrollText, Network, Code2
} from 'lucide-react';

const NAV = [
  { to: '/',             label: 'Dashboard',     Icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions',  Icon: ArrowLeftRight },
  { to: '/fraud',        label: 'Fraud',         Icon: ShieldAlert },
  { to: '/network',      label: 'Network graph', Icon: Network },
  { to: '/participants', label: 'Participants',  Icon: Users },
  { to: '/settlement',   label: 'Settlement',    Icon: Coins },
  { to: '/eod',          label: 'EOD',           Icon: Calendar },
  { to: '/disputes',     label: 'Disputes',      Icon: Gavel },
  { to: '/crossborder',  label: 'Cross-border',  Icon: Globe2 },
  { to: '/audit',        label: 'Audit',         Icon: ScrollText },
  { to: '/dev-portal',   label: 'Developer',     Icon: Code2 }
];

export const SideNav = () => (
  <nav
    aria-label="Primary"
    className="w-[240px] h-screen bg-graphite-900 text-graphite-100 sticky top-0 flex flex-col"
  >
    <div className="h-14 flex items-center gap-2 px-4 border-b border-graphite-800">
      <div className="w-7 h-7 rounded bg-emerald-500 grid place-items-center font-bold text-graphite-900">S</div>
      <span className="font-semibold text-base text-white">Sika</span>
      <span className="text-xs text-graphite-400 ml-1">Operator</span>
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
                  ? 'bg-graphite-800 text-white border-l-2 border-emerald-500'
                  : 'text-graphite-300 hover:bg-graphite-800 hover:text-white border-l-2 border-transparent'
              )
            }
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
    <div className="px-4 py-3 text-xs text-graphite-500 border-t border-graphite-800">
      Sika Rail · v0.10
    </div>
  </nav>
);

export default SideNav;
