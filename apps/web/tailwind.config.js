/**
 * Design tokens — «Bazaar at dusk» (see docs/DESIGN.md).
 * Logical utilities only (ms-/me-/ps-/pe-/start-/end-). Token names used by every screen stay stable;
 * new families (night, saffron, terracotta) are additive.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // touch screens keep no sticky «hover» tint after a tap
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        // warm paper neutrals (kahgel plaster, not grey)
        canvas: '#F8F3EB',
        surface: '#FFFFFF',
        sunken: '#F0E8DB',
        line: '#E5DBCB',
        'line-strong': '#8C8172',
        ink: '#1E1A15',
        'ink-soft': '#5A5146',
        // brand: Persian-tile teal
        accent: { DEFAULT: '#0A6B6B', strong: '#075555', soft: '#DDEFEC', ink: '#064848' },
        // hero surfaces: the vaulted bazaar ceiling after dusk
        night: { DEFAULT: '#0B2422', 2: '#0F3A37', 3: '#165A55', ink: '#F7EFE2', soft: '#BCD2CD', line: 'rgba(247,239,226,0.14)' },
        // warm accents: saffron (attention, delight) and terracotta (brick, secondary warmth)
        saffron: { DEFAULT: '#E8A317', bright: '#F4C155', soft: '#FCEFD0', ink: '#6B4300' },
        terracotta: { DEFAULT: '#B4532F', soft: '#F8E5DA', ink: '#8A3818' },
        // semantic «needs attention» keeps its name; it now lives in the saffron family
        amber: { DEFAULT: '#D69410', soft: '#FCEFD0', ink: '#6B4300' },
        danger: { DEFAULT: '#9B2F28', soft: '#FBE9E7' },
      },
      fontFamily: { sans: ['"Vazirmatn Variable"', 'Vazirmatn', 'system-ui', 'sans-serif'] },
      fontSize: {
        // Persian-first scale: 16px minimum, generous line height. No letter-spacing on Persian (it breaks joining).
        xs: ['1rem', { lineHeight: '1.6' }],
        sm: ['1rem', { lineHeight: '1.65' }],
        base: ['1.0625rem', { lineHeight: '1.7' }],
        lg: ['1.1875rem', { lineHeight: '1.6' }],
        xl: ['1.375rem', { lineHeight: '1.5' }],
        '2xl': ['1.75rem', { lineHeight: '1.4' }],
        display: ['2.125rem', { lineHeight: '1.3' }],
      },
      borderRadius: { card: '20px', control: '14px', chip: '999px', sheet: '28px', hero: '28px' },
      boxShadow: {
        // warm-tinted, always offset + blurred
        card: '0 1px 1px rgba(64,44,20,0.04), 0 2px 8px rgba(64,44,20,0.06)',
        raised: '0 2px 4px rgba(64,44,20,0.05), 0 12px 28px -8px rgba(64,44,20,0.18)',
        hero: '0 18px 40px -16px rgba(11,36,34,0.55), 0 2px 6px rgba(11,36,34,0.18)',
        float: '0 14px 32px -10px rgba(7,85,85,0.55), 0 3px 8px rgba(11,36,34,0.22)',
        sheet: '0 -12px 40px rgba(30,26,21,0.22)',
        focus: '0 0 0 3px rgba(10,107,107,0.38), 0 6px 22px -4px rgba(232,163,23,0.45)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      minHeight: { touch: '48px' },
      minWidth: { touch: '48px' },
    },
  },
  plugins: [],
};
