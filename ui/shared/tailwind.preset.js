// Tailwind preset that all three apps extend. Maps the locked design tokens
// into Tailwind's color / spacing / typography / shadow / radius scales so
// every utility class in the apps resolves to a token value.

import { colors, spacing, radius, shadows, typography, transitions } from './design-tokens.js';

/** @type {import('tailwindcss').Config} */
const preset = {
  theme: {
    extend: {
      colors: {
        graphite: colors.graphite,
        emerald: colors.emerald,
        amber: colors.amber,
        red: colors.red,
        blue: colors.blue
      },
      fontFamily: typography.fontFamily,
      fontSize: typography.fontSize,
      fontWeight: typography.fontWeight,
      lineHeight: typography.lineHeight,
      spacing,
      borderRadius: radius,
      boxShadow: shadows,
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '300ms'
      },
      transitionTimingFunction: {
        sika: 'cubic-bezier(0.4, 0, 0.2, 1)'
      }
    }
  }
};

export default preset;
export { preset, transitions };
