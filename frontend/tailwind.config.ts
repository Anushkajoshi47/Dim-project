import type { Config } from 'tailwindcss';

/**
 * Dark-only mission-console theme. Colours are declared as CSS custom
 * properties in globals.css and referenced here so the palette lives in exactly
 * one place.
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces, darkest to lightest.
        void: 'var(--void)',
        panel: 'var(--panel)',
        surface: 'var(--surface)',
        raised: 'var(--raised)',

        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',

        ink: 'var(--ink)',
        'ink-dim': 'var(--ink-dim)',
        'ink-muted': 'var(--ink-muted)',

        accent: 'var(--accent)',
        nominal: 'var(--nominal)',
        warn: 'var(--warn)',
        serious: 'var(--serious)',
        critical: 'var(--critical)',

        s1: 'var(--s1)',
        s2: 'var(--s2)',
        s3: 'var(--s3)',
        s4: 'var(--s4)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Cascadia Mono',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      borderRadius: {
        panel: '3px',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.8s ease-in-out infinite',
        sweep: 'sweep 2.4s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;