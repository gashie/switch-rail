# Sika UI — Component Library Spec

**Locked.** 18 components. Pages compose from these. New components require a phase change.

Every component:
- is a function component
- accepts a `className` prop merged via `clsx`
- supports `data-testid`
- focus rings: `ring-2 ring-emerald-500 ring-offset-2`
- transitions: 120ms cubic-bezier on bg, color, ring

## Primitives (B10.2)

### `Button`
- variants: `primary` (emerald-600 bg, white), `secondary` (graphite-100 bg, graphite-900), `ghost` (transparent, hover graphite-100), `danger` (red-600 bg, white)
- sizes: `sm` (h-8 px-3 text-sm), `base` (h-10 px-4 text-base), `lg` (h-12 px-5 text-lg)
- props: `variant`, `size`, `loading`, `disabled`, `type`, `onClick`, `children`, `leftIcon`, `rightIcon`
- `loading=true`: spinner replaces leftIcon, button disabled

### `IconButton`
- props: `icon` (ReactNode), `label` (a11y aria-label, required), `variant`, `size`, `onClick`

### `Input`
- props: `label`, `value`, `onChange`, `error`, `helper`, `type`, `placeholder`, `disabled`, `leftIcon`
- error: red-600 border, helper text turns red

### `Select`
- props: `label`, `value`, `options` (`[{value, label}]`), `onChange`, `error`, `placeholder`

### `Textarea`
- same as Input but multi-line

### `Checkbox`
- props: `label`, `checked`, `onChange`, `disabled`

### `Switch`
- visual toggle, same props as Checkbox

### `Card`
- props: `title`, `subtitle`, `actions`, `children`, `padding` (default 'lg' = 20px)
- shadow-sm border border-graphite-200 rounded-md

### `Skeleton`
- props: `variant` (`text` | `card` | `table-row`), `width`, `height`
- Animated shimmer (graphite-100 → graphite-200)

### `StatusBadge`
- props: `status` (backend code), `size` (`sm` | `base`)
- Reads from `status-map.js` for label + colors

### `Money`
- props: `valueMinor`, `currency`, `align` (`left` | `right` default), `mono` (default true)
- Uses `formatMinor`

### `Tabs`
- props: `tabs` (`[{key, label, icon?}]`), `active`, `onChange`

## Composites (B10.3)

### `Table`
- props: `columns` (`[{key, label, render?, sortable?, align?, width?}]`), `rows`, `rowKey`, `onRowClick`, `loading`, `empty` (slot), `error` (slot), `sort` (`{key, dir}`), `onSortChange`
- Sticky header, hover row highlight (graphite-50), skeleton rows when `loading`
- Renders `empty` when no rows + not loading + no error

### `StatCard`
- props: `label`, `value`, `delta` (optional `+12%`/`-3%`), `trend` (`up`/`down`/`flat`), `icon`, `loading`

### `Timeline`
- props: `entries` (`[{at, by, label, payload?}]`)
- Vertical timeline, each entry shows date+time, actor, label, expandable payload

### `Modal`
- props: `open`, `title`, `onClose`, `actions` (footer slot), `children`, `size` (`sm`/`base`/`lg`)
- Esc closes; backdrop click closes; trap focus

### `Drawer`
- like Modal but slide-in from right
- props: `open`, `title`, `onClose`, `width` (default 480px), `children`

### `Toast`
- triggered via Redux `toastSlice.actions.showToast({ kind, message, ttl })`
- variants: success (emerald), error (red), info (blue), warning (amber)
- auto-dismiss after ttl ms (default 4000)

### `EmptyState`
- props: `icon`, `title`, `description`, `action` (Button)
- Centered, full content area

### `PageHeader`
- props: `title`, `subtitle`, `breadcrumbs`, `actions`
- Page title `text-2xl semibold`, subtitle `text-sm graphite-600`, actions row right-aligned

### `FiltersBar`
- props: `filters` (`[{type, ...}]`), `value`, `onChange`, `onApply`
- Debounced apply (300ms)

### `Pagination`
- props: `total`, `page`, `pageSize`, `onPageChange`, `onPageSizeChange`
- Shows "X-Y of Z", prev/next, page-size selector
