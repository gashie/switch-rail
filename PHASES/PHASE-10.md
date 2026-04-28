# PHASE 10 — Operations, Observability & Citizen Access (UI)

**Mode:** Autonomous. Single master prompt, no per-block sign-off.

**Goal at end of phase:**
- Three production-grade React apps live in the repo:
  1. **Operator Console** — rail staff. Sees everything. Transactions, fraud alerts, disputes, settlement, EOD, recon, network graph, fast-track reversals, regulatory queries, audit log streaming.
  2. **Participant Portal** — banks/fintechs/wallets. Sees only their data. Their transactions, disputes, settlement positions, KYB status, certificates, fee accruals.
  3. **Citizen Status Page** — public, no auth. Uptime, per-participant health, public dispute portal, transaction lookup by reference.
- All three share one locked design system (`design-tokens.js` + `COMPONENTS.md`).
- All three use the same shared component library (`@sika/ui`).
- Modern fintech enterprise look — graphite + emerald, Inter + JetBrains Mono, generous spacing, real charts, skeleton loading, empty states, error states.
- CC builds the design tokens and one reference page first. Every other page copies the reference page's shape. CC does not freelance layouts.

**Why this phase matters.** The backend is correct. Only beautiful, consistent, fast UI makes that correctness usable. Phase 10 is the difference between "we built a payment rail" and "we built a payment rail people want to use."

---

## What's in scope, what isn't

**In scope (Phase 10):**
- Three React apps, monorepo-style under `ui/`
- One shared design system + component library under `ui/shared/`
- Real data binding to existing Phase 1-9 backend APIs via RTK Query
- All major workflows visible: transactions, fraud, disputes, settlement, EOD, recon, network graph, cross-border, overlays
- Operator-facing onboarding + KYB review + cert suite trigger workflows
- Participant-facing self-service for KYB document upload + cert run requests
- Citizen-facing case lookup, status page, dispute filing portal
- USSD gateway routes (no UI — but the `ussd-gateway` module is a Phase 10 deliverable)

**NOT in scope (deferred to Phase 11+):**
- Mobile native apps (the citizen pages are mobile-responsive; native apps come later)
- Real-time push notifications (UI uses polling; WebSocket/SSE later)
- Full white-label theming per participant (one theme ships)
- Multi-language UI (English only ships)
- Real adjudicator queue management (the manual adjudication UI ships; queue/escalation routing is Phase 11)

---

## Locked: the stack

| Layer | Choice |
|---|---|
| Framework | React 18 |
| Build | Vite 5 |
| Language | Plain JavaScript (no TypeScript). JSDoc allowed for editor hints. |
| State (server) | RTK Query (built into Redux Toolkit) |
| State (client) | Redux Toolkit `createSlice` for any non-server state |
| Styling | Tailwind CSS 3 |
| Fonts | Inter (variable, self-hosted via @fontsource/inter) + JetBrains Mono |
| Charts | Recharts (already proven in your prior projects) |
| Icons | lucide-react |
| Tables | Hand-rolled `<Table>` component using shared tokens (no third-party data table library — too heavy) |
| Forms | Plain controlled components + `react-hook-form` for validation |
| Date/time | `date-fns` (light, tree-shakable, no `moment`) |
| Money formatting | Hand-rolled `formatMinor()` helper (BigInt-safe, ISO 4217-aware) |
| Routing | `react-router-dom` 6 |
| Testing | `vitest` + `@testing-library/react` |
| Lint | ESLint with React plugin |
| Linked to backend via | RTK Query base query targeting `http://localhost:3000` in dev, env var in prod |

No other libraries unless specified per block.

---

## Locked: the design tokens

CC builds this file in B10.1. Every color, spacing, font size, shadow comes from here. CC may not introduce new tokens during page-building blocks (B10.4 onward).

**Color palette — graphite + emerald:**

```js
// ui/shared/design-tokens.js
export const colors = {
  // graphite (neutrals — backgrounds, text, borders)
  graphite: {
    50:  '#F8F9FA',
    100: '#F1F3F5',
    200: '#E9ECEF',
    300: '#DEE2E6',
    400: '#CED4DA',
    500: '#ADB5BD',
    600: '#6C757D',
    700: '#495057',
    800: '#343A40',
    900: '#212529',
    950: '#0F1419'
  },
  // emerald (the rail's accent — primary actions, key data)
  emerald: {
    50:  '#ECFDF5',
    100: '#D1FAE5',
    200: '#A7F3D0',
    300: '#6EE7B7',
    400: '#34D399',
    500: '#10B981',
    600: '#059669',
    700: '#047857',
    800: '#065F46',
    900: '#064E3B'
  },
  // status colors (used only where status is shown)
  success: '#059669',  // emerald-600
  warning: '#D97706',  // amber-600
  danger:  '#DC2626',  // red-600
  info:    '#2563EB',  // blue-600
  pending: '#6C757D'   // graphite-600
};

export const spacing = {
  px:  '1px',
  0:   '0',
  1:   '4px',
  2:   '8px',
  3:   '12px',
  4:   '16px',
  5:   '20px',
  6:   '24px',
  8:   '32px',
  10:  '40px',
  12:  '48px',
  16:  '64px',
  20:  '80px',
  24:  '96px'
};

export const radius = {
  none: '0',
  sm:   '4px',
  base: '6px',
  md:   '8px',
  lg:   '12px',
  xl:   '16px',
  full: '9999px'
};

export const shadows = {
  none:  'none',
  sm:    '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  base:  '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
  md:    '0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
  lg:    '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.06)',
  xl:    '0 20px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.06)'
};

export const typography = {
  fontFamily: {
    sans: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"JetBrains Mono", "Menlo", "Monaco", "Consolas", monospace'
  },
  fontSize: {
    xs:    '12px',
    sm:    '13px',
    base:  '14px',  // body text
    md:    '15px',
    lg:    '16px',
    xl:    '18px',
    '2xl': '20px',
    '3xl': '24px',
    '4xl': '30px',
    '5xl': '36px'
  },
  fontWeight: {
    regular:  400,
    medium:   500,
    semibold: 600,
    bold:     700
  },
  lineHeight: {
    tight:   '1.25',
    snug:    '1.375',
    normal:  '1.5',
    relaxed: '1.625'
  }
};

export const transitions = {
  fast:   '120ms cubic-bezier(0.4, 0, 0.2, 1)',
  base:   '200ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow:   '300ms cubic-bezier(0.4, 0, 0.2, 1)'
};

export const zIndex = {
  base:    0,
  dropdown: 100,
  sticky:   200,
  modal:    300,
  popover:  400,
  toast:    500
};
```

**Typography rules (locked):**
- Body text: `text-base` (14px) regular, graphite-800 on white.
- Section headers: `text-lg` (16px) semibold, graphite-900.
- Page titles: `text-2xl` (20px) semibold, graphite-900.
- Display headings: `text-3xl` (24px) bold — used sparingly, only for dashboard hero numbers.
- Captions / metadata: `text-xs` (12px) regular, graphite-600.
- Money: monospace, `text-base`, with right-aligned tabular nums where it appears in tables.

**Layout rules (locked):**
- Sidebar width: `240px` collapsed-friendly to `64px`.
- Top bar height: `56px`.
- Page content max-width: `1440px`, centered.
- Page padding: `32px` horizontal, `24px` vertical.
- Card padding: `20px`.
- Section gap: `24px`.

---

## Locked: the component library

CC builds these in B10.2 and B10.3. Every page in every app composes from these. CC may not draw a Table from scratch, may not roll its own Button, etc.

**The 18 components:**

| Component | What it does | Required props |
|---|---|---|
| `Button` | All buttons. variant: primary/secondary/ghost/danger | `variant`, `size`, `loading`, `disabled`, `onClick`, `children` |
| `IconButton` | Icon-only button | `icon`, `label` (a11y), `onClick` |
| `Input` | Text input | `label`, `value`, `onChange`, `error`, `helper` |
| `Select` | Dropdown | `label`, `value`, `options`, `onChange`, `error` |
| `Textarea` | Multi-line input | same as Input |
| `Checkbox` / `Switch` | Boolean controls | `label`, `checked`, `onChange` |
| `Card` | The container box. Padding, shadow, radius. | `title`, `subtitle`, `actions`, `children` |
| `StatCard` | Big-number cards on dashboards | `label`, `value`, `delta`, `trend`, `icon` |
| `Table` | The one true table | `columns`, `rows`, `onRowClick`, `loading`, `empty` |
| `StatusBadge` | The small colored pill | `status` (one of CONFIRMED/PENDING/REJECTED/etc.) |
| `Money` | Renders a BigInt minor amount | `valueMinor`, `currency`, `align` |
| `Timeline` | For audit history / case status history | `entries` (array of `{at, by, label, payload}`) |
| `Tabs` | Tabbed views | `tabs`, `active`, `onChange` |
| `Modal` | Dialogs, confirms | `open`, `title`, `onClose`, `children`, `actions` |
| `Drawer` | Slide-in side panel | similar to Modal but anchored right |
| `Toast` | Transient notifications | dispatched via Redux slice |
| `Skeleton` | Loading placeholder shapes | `variant` (text/card/table-row), `width`, `height` |
| `EmptyState` | When there's no data | `icon`, `title`, `description`, `action` |

The locked spec for each one lives in `ui/shared/COMPONENTS.md` (CC writes this file in B10.2 with copy-paste exact specs).

---

## Locked: status badge → color mapping

Used by `<StatusBadge>` everywhere. CC must not invent more.

| Backend state/code | Badge label | Badge color |
|---|---|---|
| `CONFIRMED`, `ACSC`, `ACTIVE`, `SETTLED`, `RESOLVED`, `MATCH`, `PASS` | "Confirmed" / "Active" / "Settled" / etc. | emerald-600 on emerald-50 |
| `RECEIVED`, `AUTHORIZED`, `ROUTED`, `CREDIT_LEG_PENDING`, `EVIDENCE_PENDING`, `ADJUDICATING`, `INITIATED`, `OPEN`, `PENDING`, `RUNNING` | "In progress" | amber-600 on amber-50 |
| `PENDING_RECONCILIATION`, `PARTIAL`, `REVIEW` | "Needs review" | amber-700 on amber-100 |
| `REJECTED`, `DENIED`, `FAILED`, `BLOCK`, `EXPIRED`, `CLOSED`, `REVOKED`, `NO_MATCH` | "Failed" / "Closed" / etc. | red-600 on red-50 |
| `REVERSED` | "Reversed" | graphite-600 on graphite-100 |
| `AUTO_RESOLVED` | "Auto-resolved" | emerald-700 on emerald-100 |
| `UPHELD`, `PARTIAL_UPHELD` | "Upheld" / "Partial uphold" | emerald-600 on emerald-50 |
| `SUSPENDED`, `TERMINATED`, `KILLED` | "Suspended" / "Terminated" | red-700 on red-100 |
| `KYB`, `CERTIFYING` | "Onboarding" | blue-600 on blue-50 |

This table goes into `ui/shared/status-map.js`. CC imports from it. Never hardcodes status colors in pages.

---

## Locked: API contract files (the anti-drift mechanism)

Before writing any page, CC writes a one-page contract: `ui/contracts/<page-name>.md`. The contract has:
1. The page's purpose in one sentence.
2. The endpoints it calls (path, method).
3. **Real captured JSON responses** from the running backend (via curl, pasted in).
4. A bullet list of what the page displays, mapped 1:1 to JSON fields.
5. A bullet list of what user actions trigger which mutations.

Pages are built against the contract. If a field on screen has no matching backend field in the contract, ESCALATE (something's wrong — either the contract is missing the call or the page is inventing data).

---

## Locked: the reference page

The Operator Console **Transactions list page** is the reference. CC builds this with extreme care in B10.4. Every subsequent page is told: "shape it like the Transactions list page." This is the anti-freelancing mechanism.

The reference page must demonstrate:
- Sidebar nav with active-state styling
- Top bar with breadcrumbs, search, user menu
- Page title with action buttons
- Filters bar (date range, participant, state, currency)
- Sortable table with sticky header, loading state (skeleton rows), empty state, error state
- Pagination footer
- Row hover with subtle highlight, click-to-detail navigation
- Money formatted with currency, right-aligned, monospace
- Status badges
- Real-time TPS counter in the top bar (polled every 5s)

Once this page is right, every other page is a structured copy-of pattern.

---

## Repo layout for the UI

```
ui/
├── shared/                    # the design system + components
│   ├── package.json
│   ├── design-tokens.js
│   ├── tailwind.preset.js     # Tailwind config preset all 3 apps extend
│   ├── COMPONENTS.md          # the locked component spec
│   ├── status-map.js
│   ├── format.js              # money, dates, hashes
│   ├── components/
│   │   ├── Button.jsx
│   │   ├── Table.jsx
│   │   └── ...
│   ├── api/                   # RTK Query base + shared queries
│   │   ├── baseApi.js
│   │   └── slices/            # one slice per backend module's queries
│   └── index.js
├── operator/
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js     # extends shared preset
│   ├── index.html
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── store.js           # Redux store + RTK Query
│   │   ├── routes.jsx
│   │   ├── layouts/
│   │   │   └── AppLayout.jsx  # sidebar + top bar
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Transactions.jsx       # the reference page
│   │   │   ├── TransactionDetail.jsx
│   │   │   └── ...
│   │   └── slices/            # any operator-specific Redux slices
├── participant/
│   ├── (mirrors operator/ structure)
└── citizen/
    └── (mirrors operator/ structure, no auth)

ui/contracts/                  # API contract files, one per page
└── operator-transactions.md
```

Each app is a separate Vite project. They share `ui/shared/` via a workspace package. `pnpm-workspace.yaml` is updated to include `ui/*`.

---

## B10.1 — Design tokens, Tailwind preset, font loading, the contract template

**Purpose.** The non-negotiable foundation. Everything else imports from here.

**Files to create.**
- `ui/shared/package.json` — declares `@sika/shared` workspace package
- `ui/shared/design-tokens.js` — the locked tokens above, copy verbatim
- `ui/shared/tailwind.preset.js` — Tailwind config that maps tokens into utility classes
- `ui/shared/format.js` — `formatMinor(valueMinor, currency)`, `formatDate(d, fmt)`, `truncateHash(h)`, `formatPercent(n, decimals)`
- `ui/shared/status-map.js` — the locked status → label/color table
- `ui/shared/index.js` — barrel exports
- `ui/shared/fonts/` — `@fontsource/inter` and `@fontsource/jetbrains-mono` installed; CSS imports verified
- `ui/contracts/_TEMPLATE.md` — the contract template every page contract uses
- `pnpm-workspace.yaml` updated to include `ui/*`
- Root `package.json` — adds `ui` scripts: `pnpm ui:operator`, `pnpm ui:participant`, `pnpm ui:citizen`, `pnpm ui:build`

**Tailwind preset specifics.** Maps:
- `bg-graphite-{50..950}` and `text-graphite-{50..950}` from the colors table
- `bg-emerald-{50..900}` similarly
- `font-sans` → Inter, `font-mono` → JetBrains Mono
- Custom `text-{xs..5xl}` matching the typography sizes
- `shadow-{sm/base/md/lg/xl}` matching the shadows
- `rounded-{sm/base/md/lg/xl/full}` matching the radii

**Format helpers (locked specs):**
```js
// formatMinor(15042n, 'GHS') -> 'GHS 150.42'
// formatMinor(15042n, 'GHS', { symbol: false }) -> '150.42'
// formatMinor(15000000n, 'NGN') -> 'NGN 150,000.00'
// truncateHash('abc123def456...') -> 'abc1...f456'
// formatDate(new Date(), 'PP') -> 'Apr 26, 2026'
// formatDate(new Date(), 'pp') -> '12:34 PM'
```

**Exit checks (paste output):**
- `pnpm install` succeeds in the workspace.
- `node -e "import('./ui/shared/index.js').then(m => console.log(Object.keys(m).sort()))"` lists tokens, format helpers, status-map.
- A test file `ui/shared/format.test.js` runs via vitest, all green: covers BigInt money, all minor-digit currencies (GHS, USD, JPY, NGN), date formats, hash truncation.

---

## B10.2 — Component library part 1: primitives

**Purpose.** Build the smallest, most-reused components. Pages cannot start until these exist.

**Files to create.**
- `ui/shared/COMPONENTS.md` — the locked spec for all 18 components (copy from PHASE-10's table, expand each into a one-screen spec)
- `ui/shared/components/Button.jsx`
- `ui/shared/components/IconButton.jsx`
- `ui/shared/components/Input.jsx`
- `ui/shared/components/Select.jsx`
- `ui/shared/components/Textarea.jsx`
- `ui/shared/components/Checkbox.jsx`
- `ui/shared/components/Switch.jsx`
- `ui/shared/components/Card.jsx`
- `ui/shared/components/Skeleton.jsx`
- `ui/shared/components/StatusBadge.jsx`
- `ui/shared/components/Money.jsx`
- `ui/shared/components/Tabs.jsx`
- `ui/shared/components/__tests__/` — one test per component verifying render + key behavior
- `ui/shared/index.js` — re-export all

**Component spec rules (in COMPONENTS.md):**
- Each component is a function component.
- Each component takes a `className` prop merged with its base classes via `clsx` (small dependency authorized).
- Each component supports `data-testid` for tests.
- No component reads from Redux directly. Pages pass data in.
- Loading states: every interactive component has a `loading` prop that disables and shows a Skeleton.
- Disabled states: visually de-emphasized; still focusable for screen readers.
- Focus rings: all components use the same focus ring color (emerald-500 with offset).

**Button spec example (template for the others):**
```
Button
- variants: primary (emerald-600 bg, white text), secondary (graphite-100 bg, graphite-900 text), ghost (transparent, hover graphite-100), danger (red-600 bg, white text)
- sizes: sm (h-8, px-3, text-sm), base (h-10, px-4, text-base), lg (h-12, px-5, text-lg)
- props: variant, size, loading, disabled, type, onClick, children, leftIcon, rightIcon, className
- when loading=true, shows a small spinner replacing the leftIcon, button is disabled
- focus ring: ring-2 ring-emerald-500 ring-offset-2
- transitions: 120ms on bg, color, ring
```

**Exit checks:**
- `pnpm test ui/shared/components` runs all green.
- A storybook-lite page (`ui/shared/components/__demo__.html`) opens and visually demonstrates all 12 primitives — operator inspects, confirms they look fintech-grade.

---

## B10.3 — Component library part 2: composites + RTK Query base

**Purpose.** Build the higher-order components and the data layer. Pages call these.

**Files to create.**
- `ui/shared/components/Table.jsx` — sortable columns, sticky header, sticky pagination, loading skeleton rows, empty state slot, error state slot, row click handler
- `ui/shared/components/StatCard.jsx` — big number, label, delta arrow, trend sparkline slot
- `ui/shared/components/Timeline.jsx` — vertical timeline, used for audit history and case status
- `ui/shared/components/Modal.jsx`
- `ui/shared/components/Drawer.jsx`
- `ui/shared/components/Toast.jsx` + `ui/shared/components/ToastProvider.jsx` + `ui/shared/slices/toastSlice.js`
- `ui/shared/components/EmptyState.jsx`
- `ui/shared/components/PageHeader.jsx` — title + breadcrumbs + actions row
- `ui/shared/components/FiltersBar.jsx` — accepts an array of filter controls; provides debounced apply
- `ui/shared/components/Pagination.jsx`
- `ui/shared/api/baseApi.js` — RTK Query base API with credentials: 'include', error normalization, retry policy (3 retries on network errors only)
- `ui/shared/api/slices/transactionsApi.js` — RTK Query slice for `/transactions` endpoints
- `ui/shared/api/slices/disputesApi.js`
- `ui/shared/api/slices/participantsApi.js`
- `ui/shared/api/slices/settlementApi.js`
- `ui/shared/api/slices/fraudApi.js`
- `ui/shared/api/slices/crossborderApi.js`
- `ui/shared/api/slices/auditApi.js`
- `ui/shared/api/slices/eodApi.js`
- `ui/shared/api/slices/networkGraphApi.js`
- `ui/shared/api/slices/index.js` — barrel
- `ui/shared/components/__tests__/` — tests for Table (sort, pagination, empty, loading, error), StatCard, Timeline, Modal

**RTK Query base API — locked shape:**
```js
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const baseApi = createApi({
  reducerPath: 'sikaApi',
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_BASE || 'http://localhost:3000',
    credentials: 'include',
    prepareHeaders: (headers) => {
      headers.set('content-type', 'application/json');
      return headers;
    }
  }),
  tagTypes: ['Tx', 'Dispute', 'Participant', 'Settlement', 'FraudAlert', 'Cross', 'Audit', 'EOD', 'Graph'],
  endpoints: () => ({})
});
```

**Per-slice example (transactionsApi):**
```js
export const transactionsApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    listTransactions: b.query({
      query: ({ state, participant, dateFrom, dateTo, limit, offset }) =>
        ({ url: '/transactions', params: { state, participant, dateFrom, dateTo, limit, offset } }),
      providesTags: (r) => r?.data?.rows
        ? [...r.data.rows.map(t => ({ type: 'Tx', id: t.id })), { type: 'Tx', id: 'LIST' }]
        : [{ type: 'Tx', id: 'LIST' }]
    }),
    getTransaction: b.query({
      query: (id) => `/transactions/${id}`,
      providesTags: (_, __, id) => [{ type: 'Tx', id }]
    }),
    killTransaction: b.mutation({
      query: ({ id, reason }) => ({ url: `/transactions/${id}/kill`, method: 'POST', body: { reason } }),
      invalidatesTags: (_, __, { id }) => [{ type: 'Tx', id }, { type: 'Tx', id: 'LIST' }]
    })
  })
});

export const { useListTransactionsQuery, useGetTransactionQuery, useKillTransactionMutation } = transactionsApi;
```

**Exit checks:**
- All composite components tested via vitest + @testing-library/react.
- A storybook-lite demo page renders Table with mock data, StatCard with a sparkline, Timeline with 5 entries, EmptyState, Modal, Drawer, Toast.
- RTK Query base API tested against a mock fetch — auth cookie sent, error normalized, retries on network error only.

---

## B10.4 — Operator Console: app shell + reference page (Transactions list)

**Purpose.** The operator app skeleton, and **the reference page** that every other page imitates. CC writes this with extreme care.

**Files to create.**
- `ui/operator/package.json`
- `ui/operator/vite.config.js`
- `ui/operator/tailwind.config.js` (extends shared preset)
- `ui/operator/index.html`
- `ui/operator/src/main.jsx`
- `ui/operator/src/App.jsx`
- `ui/operator/src/store.js` — Redux store with shared baseApi + per-app slices
- `ui/operator/src/routes.jsx` — react-router-dom config
- `ui/operator/src/layouts/AppLayout.jsx` — sidebar (navigation list) + top bar (breadcrumbs, search, live TPS, user menu) + content area
- `ui/operator/src/layouts/SideNav.jsx`
- `ui/operator/src/layouts/TopBar.jsx`
- `ui/operator/src/layouts/UserMenu.jsx`
- `ui/operator/src/pages/Login.jsx`
- `ui/operator/src/pages/Transactions.jsx` — **THE REFERENCE PAGE**
- `ui/operator/src/pages/TransactionDetail.jsx`
- `ui/contracts/operator-transactions.md` — the contract file with real curl-captured JSON
- `ui/contracts/operator-transaction-detail.md`
- `ui/operator/src/__tests__/Transactions.test.jsx`

**The contract file workflow (locked):**
1. CC starts the Phase 9 backend: `pnpm migrate && pnpm seed && node server.js`.
2. CC logs in via curl, captures the cookie.
3. CC runs `curl -b /tmp/c http://localhost:3000/transactions?limit=10` and pastes the response into `ui/contracts/operator-transactions.md`.
4. CC writes the page's display spec, mapping every visible field to a JSON field from the captured response.
5. CC builds the page against the contract.

**The reference page must demonstrate:**
- Page header: title "Transactions", subtitle "All transactions across the rail", action button "Export CSV"
- Filters bar: date range picker, participant select (loaded from `/participants`), state multi-select, currency select
- Sortable table with columns:
  - Created at (date+time, sortable, default sort desc)
  - Transaction ID (truncated, clickable, monospace)
  - Originator → Beneficiary (two-line cell)
  - Amount (Money component, right-aligned)
  - State (StatusBadge)
  - Rail class
  - Reason code (when state is REJECTED, monospace)
- Skeleton rows during loading (5 rows)
- Empty state with helpful message + "Clear filters" action
- Error state with retry button
- Pagination (20/50/100 per page selector + prev/next + total count)
- Row click navigates to `/transactions/:id`
- Top bar: live TPS counter polled every 5s from `/ops-dashboard/tps` (Phase 10 introduces this endpoint — see B10.10)

**The TransactionDetail page demonstrates the second pattern:**
- Header with breadcrumbs (Transactions / TX-{id})
- Two-column layout: left = key-value summary card; right = stacked Cards for State History (Timeline), Authorization Signals (rule hits), Fraud Signals, Ledger Postings, Receipts
- "Operator Kill-Switch" button in the header (Modal confirms with reason)

**Exit checks:**
- Visual: the operator opens the app, logs in, navigates to /transactions, sees real data from a seeded demo, can sort, filter, paginate, click a row, see detail.
- All Redux actions captured in tests.
- 95% rendering pixel match against a committed reference screenshot (we'll commit the screenshot in this block; CC ensures the page matches).

---

## B10.5 — Operator Console: dashboard, fraud, network graph

**Purpose.** Three more operator pages. Each follows the reference shape.

**Files to create.**
- `ui/operator/src/pages/Dashboard.jsx`
- `ui/operator/src/pages/FraudAlerts.jsx`
- `ui/operator/src/pages/FraudAlertDetail.jsx`
- `ui/operator/src/pages/NetworkGraph.jsx`
- `ui/operator/src/pages/RulePacks.jsx`
- `ui/operator/src/pages/RulePackDetail.jsx`
- `ui/operator/src/pages/SanctionsScreenings.jsx`
- `ui/contracts/operator-dashboard.md`
- `ui/contracts/operator-fraud-alerts.md`
- `ui/contracts/operator-network-graph.md`
- `ui/contracts/operator-rule-packs.md`
- Test files for each

**Dashboard page:**
- 4 StatCards: TPS (24h avg), Confirmed transactions today, Disputes open, Fraud alerts open
- 2 charts (Recharts): TPS over last 24h (area chart), Volume by currency over last 7d (stacked bar)
- 1 table: Top 10 participants by volume today
- 1 Timeline: latest audit events stream (last 20)

**Fraud alerts page:**
- Filters: alert type, status, date range
- Table: alert id, type, accounts involved (count), composite score, detected at, status (badge)
- Click → FraudAlertDetail with evidence breakdown

**Network graph page:**
- Force-directed graph (visualize with `react-force-graph-2d` — small library, authorized)
- Nodes = accounts, edges = transactions
- Highlight detected mule rings
- Click a node to see its adjacency

**Rule packs page:**
- Two cards (UNIVERSAL_BASELINE_V1 and GHANA_TYPOLOGIES_V1)
- Each card lists rules with weights, hit count today, last triggered
- Maker-checker flow for rule changes (propose modal → approve modal)

**Exit checks:**
- Each page contract file includes real captured JSON.
- Each page has a test that mocks RTK Query and asserts the rendered shape.
- Dashboard's TPS chart renders with seeded demo data.

---

## B10.6 — Operator Console: settlement, EOD, reconciliation, ledger

**Files to create.**
- `ui/operator/src/pages/Settlement.jsx` — current positions, top-up flow
- `ui/operator/src/pages/SettlementCycles.jsx` — cycle history
- `ui/operator/src/pages/EodCutover.jsx` — open/close day, run cutover modal, statements list
- `ui/operator/src/pages/Reconciliation.jsx` — recon runs + breaks queue
- `ui/operator/src/pages/Ledger.jsx` — accounts, balances, journal explorer
- `ui/operator/src/pages/Liquidity.jsx` — limits, top-ups
- Contract files for each
- Tests

**Each follows the reference shape.** Filters bar at top, table or specialized layout in body, sticky pagination footer.

**EOD page is special:** has the "Run Cutover" button which opens a Modal requiring (a) a confirmation token (operator types the operating date), (b) a checkbox confirming all participants are notified. Submits to `/eod/cutover`. Shows success toast with the new operating day id.

**Ledger page is also special:** journal explorer is a tree view (one journal at top, postings below). Hash chain verification button calls `/ledger/verify/:date` and shows green check or red break with the seq.

---

## B10.7 — Operator Console: disputes, fast-track reversal, reversals

**Files to create.**
- `ui/operator/src/pages/Disputes.jsx` — case list with filters
- `ui/operator/src/pages/DisputeDetail.jsx` — case state + evidence + decision + settlement (the most complex page in the operator console)
- `ui/operator/src/pages/FastTrackReversals.jsx`
- `ui/operator/src/pages/Reversals.jsx`
- Contracts
- Tests

**DisputeDetail page layout:**
- Top: case header with state badge, case number, transaction link, SLA clock countdown
- Left column: Evidence panel — both sides' uploads with timestamps, "Upload evidence" button (operator side)
- Right column: stacked
  - Case state Timeline
  - Decision card (only if state is ADJUDICATING or beyond — shows decision form for adjudicators or the recorded decision)
  - Settlement card (post-decision; "Confirm settlement" button shown to a different operator from the decider — UI checks `current_user_id !== decided_by_user_id`)
- The Confirm-settlement button is hidden if maker-checker would block it; shows "You decided this case — another operator must confirm settlement" tooltip instead.

**Tests:**
- Maker-checker enforced at the UI level — same user cannot click both Decide and Confirm.
- SLA clock updates every second.
- Evidence uploader (multipart) works.

---

## B10.8 — Operator Console: cross-border, FX, foreign rails

**Files to create.**
- `ui/operator/src/pages/CrossBorderTransactions.jsx`
- `ui/operator/src/pages/CrossBorderDetail.jsx` — both ledger legs visualized
- `ui/operator/src/pages/ForeignRails.jsx`
- `ui/operator/src/pages/FxQuotes.jsx` — rate history, market makers
- `ui/operator/src/pages/TravelRuleRecords.jsx`
- Contracts
- Tests

**CrossBorderDetail page is the showcase page.** Shows the full PvP flow:
- A horizontal flow diagram: Originator → Rail FX Nostro → Foreign Rail Nostro → Foreign Rail
- Each step shows its journal id (clickable to ledger)
- FX quote details (locked rate, expiry, slippage check result)
- Travel rule record (hashed IDs, jurisdictions)
- Foreign rail call timeline (instruct, status checks, accepted/rejected)

---

## B10.9 — Participant Portal app

**Purpose.** Banks, fintechs, wallets see only their own data. Same shared components, restricted scope.

**Files to create.**
- `ui/participant/package.json`, `vite.config.js`, `tailwind.config.js`, `index.html`
- `ui/participant/src/main.jsx`, `App.jsx`, `store.js`, `routes.jsx`
- `ui/participant/src/layouts/` — same shape as operator but with a participant-context badge in the top bar
- `ui/participant/src/pages/Dashboard.jsx` — their own metrics
- `ui/participant/src/pages/MyTransactions.jsx` — scoped to their participant code
- `ui/participant/src/pages/MyDisputes.jsx`
- `ui/participant/src/pages/MySettlement.jsx` — their position, their statements
- `ui/participant/src/pages/MyKyb.jsx` — KYB documents, certs, status workflow trigger
- `ui/participant/src/pages/MyAccounts.jsx`
- `ui/participant/src/pages/MyAliases.jsx`
- `ui/participant/src/pages/MyFees.jsx`
- `ui/participant/src/pages/MyMandates.jsx`
- `ui/participant/src/pages/MyApiKeys.jsx` — view their signing keys, request rotation
- Contract files for each
- Tests

**Auth model:** participant users log in with their own credentials, scoped to one participant_code. The shared baseApi sends a `X-Participant-Code` header derived from the user's session.

**Visual difference from operator:** sidebar uses a slightly different icon set (more business-y, less ops-y), participant code shown prominently in the top bar.

---

## B10.10 — Citizen Status Page + USSD gateway + Ops dashboard endpoints

**Purpose.** Public-facing app (no auth) and the small backend module that ops dashboard polls. Plus the USSD gateway HTTP endpoints (no UI).

**Files to create.**
- `ui/citizen/package.json`, `vite.config.js`, `tailwind.config.js`, `index.html`
- `ui/citizen/src/main.jsx`, `App.jsx`, `store.js`, `routes.jsx`
- `ui/citizen/src/layouts/PublicLayout.jsx` — minimal: logo top-left, language picker, no auth
- `ui/citizen/src/pages/StatusPage.jsx` — uptime grid (per-participant scorecards)
- `ui/citizen/src/pages/IncidentDetail.jsx`
- `ui/citizen/src/pages/DisputePortal.jsx` — case lookup with case number + fingerprint
- `ui/citizen/src/pages/TransactionLookup.jsx` — by reference + receipt verifier
- `ui/citizen/src/pages/ReceiptVerifier.jsx` — paste a receipt JSON + signature, verify against rail's public key
- Contracts + tests

**New backend module: `modules/ops-dashboard/`**
- `migrations/0049_ops_metrics.sql` — aggregates table for live TPS, P95 latency, etc.
- `modules/ops-dashboard/aggregator-worker.js` — runs every 30s, computes rolling metrics
- `modules/ops-dashboard/service.js`
- `modules/ops-dashboard/controller.js`
- Routes: `GET /ops-dashboard/tps`, `/ops-dashboard/volumes`, `/ops-dashboard/sla-scorecards`, `/ops-dashboard/audit-stream` (long-poll)

**New backend module: `modules/regulator-console/`**
- BoG/FIC direct query API (read-only on most resources, with audit)
- Routes: `GET /regulator/transactions`, `/regulator/audit/stream`, `/regulator/sar-export`

**New backend module: `modules/public-status/`**
- `GET /public/status` — per-participant uptime
- `GET /public/incidents` — list active and recent
- `GET /public/incidents/:id`

**New backend module: `modules/ussd-gateway/`**
- USSD-shaped HTTP endpoints (request/response model that USSD aggregators speak)
- Routes: `POST /ussd/start`, `/ussd/respond`
- Decodes USSD short-codes (e.g. `*123*1#` → balance, `*123*2*<account>*<amount>#` → send)
- Translates USSD flow to existing transaction APIs

---

## B10.11 — Developer Portal + Phase 10 exit gate prep

**Purpose.** A self-service portal where new participants and fintechs can read API docs, run sandbox transactions, generate SDK keys, and submit certification runs.

**Files to create.**
- `modules/developer-portal/` backend module
  - Sandbox tokens management
  - Force-fail account fixtures listing
  - Cert-suite runner (already exists in Phase 3 onboarding; this exposes a dev-friendly UI route)
- A new app section `ui/operator/src/pages/DevPortal.jsx` — operator-side admin of dev portal accounts
- `ui/participant/src/pages/Sandbox.jsx` — participant tries the sandbox
- A static OpenAPI doc generator: `scripts/build-openapi.js` reads every module's routes.js + schema.js, generates `docs/openapi.yaml`, mounted at `GET /docs/openapi.yaml`
- A simple Swagger UI page served at `/docs/api`
- `ui/citizen/src/pages/Docs.jsx` — public-facing API docs (reads the OpenAPI yaml)

---

## B10.12 — Phase 10 exit gate

**Purpose.** Lock the phase. Three apps deployed together. Demo proves the rail looks and works like a national payment system.

**Files to create.**
- `scripts/demo-phase-10.sh`
- `tests/phase-10-ui-smoke.test.js`

**`scripts/demo-phase-10.sh`** runs:
1. Build all three apps: `pnpm ui:build`. Outputs to `ui/operator/dist`, `ui/participant/dist`, `ui/citizen/dist`.
2. Start backend: `node server.js`.
3. Serve the three apps on different ports (Vite preview): operator on 5173, participant on 5174, citizen on 5175.
4. Run `pnpm vitest run` (full backend + UI tests). Expect ~1300+ tests total.
5. Lighthouse audit on each app's main page (via `lighthouse` cli, dependency authorized): scores Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95.
6. Print `PHASE 10 OK`.

**Phase 10 exit gate (paste output):**
- `bash scripts/demo-phase-10.sh` — prints `PHASE 10 OK`
- `pnpm vitest run` — all green
- `pnpm lint` — clean (eslint covers both backend and UI)
- `pnpm check-boundaries` — clean (script extended to lint UI imports too)
- `pnpm reset && pnpm migrate && pnpm seed` — clean from empty DB
- Visual review: operator opens each of the 3 apps, walks through the major flows, confirms enterprise look and feel.

---

## What "PHASE 10 OK" unlocks

This is it. The rail is structurally complete and operationally usable.

After Phase 10:
- Three production-grade UIs covering operator, participant, and citizen needs.
- Real-time observability for ops staff.
- Self-service onboarding and management for participants.
- Public transparency for citizens.
- API docs and developer portal for fintech onboarding.
- The whole rail demoes from `git clone` through running banks, wallets, fintechs, customers, and the central operator.

The Phase 11+ roadmap (deferred items in SPEC.md) is real adapter integrations (PAPSS prod, e-Cedi, OFAC live, NIA live, BoG RTGS), real ML model training, federated learning, and white-label theming. Those are real work but they don't change the rail's shape.
