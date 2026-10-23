/**
 * Design tokens — red / white / green (see docs/DESIGN.md).
 * Red for action, green for good news, white for calm. Logical utilities only (ms-/me-/ps-/pe-/start-/end-).
 * Token names used by every screen stay stable: `accent` is the brand red, `night` the deep-red hero surface.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // touch screens keep no sticky «hover» tint after a tap
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        // white-dominant neutrals, a cool clean grey
        canvas: '#FBFBFB',
        surface: '#FFFFFF',
        sunken: '#F2F2F4',
        line: '#E7E7EA',
        'line-strong': '#8A8A93',
        ink: '#1B1B1F',
        'ink-soft': '#5B5B66',
        // brand red: primary actions, the brand mark, selection
        accent: { DEFAULT: '#D91E2B', strong: '#B71822', soft: '#FDECEE', ink: '#7A0F16' },
        // green: good news (open, available, covered, savings, check-marks, the recommended mall)
        good: { DEFAULT: '#1B8A4B', strong: '#14703B', soft: '#E3F4EA', ink: '#0E4A27', bright: '#6BD49A' },
        // deep-red hero surfaces (Home hero, brand tile, assistant avatar)
        night: { DEFAULT: '#7E0F18', 2: '#9A1520', 3: '#B71822', ink: '#FFFFFF', soft: '#FFD6D9', line: 'rgba(255,255,255,0.16)' },
        // warm charcoal for dense dark surfaces (toasts, the market dock, the map recommendation)
        coal: { DEFAULT: '#1B1B1F', 2: '#2B2B32', ink: '#FFFFFF', soft: '#C8C8CE' },
        // semantic «needs attention / pending / conflict»: a muted yellow-amber, the only other hue
        amber: { DEFAULT: '#D9A514', soft: '#FBF3DC', ink: '#5E4600' },
        // destructive actions and errors only; darker and more crimson than the brand red
        danger: { DEFAULT: '#A3121B', soft: '#FBE9EA' },
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
        // neutral-tinted, always offset + blurred
        card: '0 1px 1px rgba(27,27,31,0.04), 0 2px 8px rgba(27,27,31,0.06)',
        raised: '0 2px 4px rgba(27,27,31,0.05), 0 12px 28px -8px rgba(27,27,31,0.16)',
        hero: '0 18px 40px -16px rgba(126,15,24,0.5), 0 2px 6px rgba(27,27,31,0.16)',
        float: '0 14px 32px -10px rgba(183,24,34,0.55), 0 3px 8px rgba(27,27,31,0.2)',
        sheet: '0 -12px 40px rgba(27,27,31,0.2)',
        // input focus on white: a red ring; on the red hero: a white ring
        focus: '0 0 0 3px rgba(217,30,43,0.3), 0 6px 20px -6px rgba(217,30,43,0.35)',
        'focus-light': '0 0 0 3px rgba(255,255,255,0.75), 0 12px 28px -8px rgba(40,4,8,0.45)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      minHeight: { touch: '48px' },
      minWidth: { touch: '48px' },
    },
  },
  plugins: [],
};
