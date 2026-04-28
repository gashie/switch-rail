// Locked Phase 10 design tokens. Single source of truth for every color,
// spacing, font size, shadow, radius, and transition used across the three
// apps. Pages and components consume these tokens via the Tailwind preset
// — no hardcoded values, no per-page palettes.

export const colors = Object.freeze({
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
  amber: {
    50:  '#FFFBEB',
    100: '#FEF3C7',
    200: '#FDE68A',
    600: '#D97706',
    700: '#B45309'
  },
  red: {
    50:  '#FEF2F2',
    100: '#FEE2E2',
    600: '#DC2626',
    700: '#B91C1C'
  },
  blue: {
    50:  '#EFF6FF',
    600: '#2563EB'
  },
  // Functional aliases used by status badges + chart palettes.
  success: '#059669',
  warning: '#D97706',
  danger:  '#DC2626',
  info:    '#2563EB',
  pending: '#6C757D'
});

export const spacing = Object.freeze({
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
});

export const radius = Object.freeze({
  none: '0',
  sm:   '4px',
  base: '6px',
  md:   '8px',
  lg:   '12px',
  xl:   '16px',
  full: '9999px'
});

export const shadows = Object.freeze({
  none:  'none',
  sm:    '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  base:  '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
  md:    '0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
  lg:    '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.06)',
  xl:    '0 20px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.06)'
});

export const typography = Object.freeze({
  fontFamily: {
    sans: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"JetBrains Mono", "Menlo", "Monaco", "Consolas", monospace'
  },
  fontSize: {
    xs:    '12px',
    sm:    '13px',
    base:  '14px',
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
});

export const transitions = Object.freeze({
  fast:   '120ms cubic-bezier(0.4, 0, 0.2, 1)',
  base:   '200ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow:   '300ms cubic-bezier(0.4, 0, 0.2, 1)'
});

export const zIndex = Object.freeze({
  base:    0,
  dropdown: 100,
  sticky:   200,
  modal:    300,
  popover:  400,
  toast:    500
});

export const layout = Object.freeze({
  sidebarWidth:        '240px',
  sidebarCollapsedWidth: '64px',
  topBarHeight:        '56px',
  pageMaxWidth:        '1440px',
  pagePaddingX:        '32px',
  pagePaddingY:        '24px',
  cardPadding:         '20px',
  sectionGap:          '24px'
});
