/** Design tokens. Logical utilities only (ms-/me-/ps-/pe-/start-/end-). */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FAF7F2',
        surface: '#FFFFFF',
        sunken: '#F1ECE3',
        line: '#E3DCCF',
        'line-strong': '#8F8575',
        ink: '#231F1A',
        'ink-soft': '#5E564B',
        accent: { DEFAULT: '#0A6B6B', strong: '#085555', soft: '#DFF0EE', ink: '#064848' },
        amber: { DEFAULT: '#C58A00', soft: '#FFF1D0', ink: '#6E4300' },
        danger: { DEFAULT: '#9B2F28', soft: '#FBE9E7' },
      },
      fontFamily: { sans: ['"Vazirmatn Variable"', 'Vazirmatn', 'system-ui', 'sans-serif'] },
      fontSize: {
        // Persian-first scale: 16px minimum, generous line height.
        xs: ['1rem', { lineHeight: '1.6' }],
        sm: ['1rem', { lineHeight: '1.65' }],
        base: ['1.0625rem', { lineHeight: '1.7' }],
        lg: ['1.1875rem', { lineHeight: '1.6' }],
        xl: ['1.375rem', { lineHeight: '1.5' }],
        '2xl': ['1.75rem', { lineHeight: '1.4' }],
      },
      borderRadius: { card: '16px', chip: '999px' },
      boxShadow: {
        card: '0 1px 2px rgba(35,31,26,0.06), 0 2px 8px rgba(35,31,26,0.04)',
        sheet: '0 -8px 32px rgba(35,31,26,0.18)',
      },
      minHeight: { touch: '48px' },
      minWidth: { touch: '48px' },
    },
  },
  plugins: [],
};
