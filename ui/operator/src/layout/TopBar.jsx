import { Bell, Search } from 'lucide-react';

export const TopBar = () => (
  <header className="h-14 bg-white border-b border-graphite-200 flex items-center justify-between px-4 sticky top-0 z-sticky">
    <div className="flex items-center gap-2 text-graphite-500">
      <Search className="w-4 h-4" />
      <input
        type="search"
        placeholder="Search transaction id, alias, participant…"
        className="w-[420px] h-9 px-2 text-sm bg-transparent border-0 outline-none focus:ring-0 placeholder:text-graphite-400"
      />
    </div>
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label="Notifications"
        className="w-9 h-9 grid place-items-center rounded text-graphite-700 hover:bg-graphite-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <Bell className="w-4 h-4" />
      </button>
      <div className="flex items-center gap-2 text-sm">
        <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-xs font-semibold">OP</div>
        <span className="text-graphite-800">operator@sika.local</span>
      </div>
    </div>
  </header>
);

export default TopBar;
