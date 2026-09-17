/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Product typography is explicit so the root remains 16px and the
      // spacing scale keeps its 4px rhythm across browser and desktop.
      fontSize: {
        xs: ['12px', { lineHeight: '16px', letterSpacing: '0.01em', fontWeight: '400' }],
        sm: ['14px', { lineHeight: '20px', letterSpacing: '0' }],
        base: ['17px', { lineHeight: '25px', letterSpacing: '0', fontWeight: '400' }],
        md: ['17px', { lineHeight: '25px', letterSpacing: '0', fontWeight: '400' }],
        lg: ['20px', { lineHeight: '28px', letterSpacing: '0', fontWeight: '400' }],
        xl: ['24px', { lineHeight: '30px', letterSpacing: '-0.005em', fontWeight: '600' }],
        '2xl': ['32px', { lineHeight: '38px', letterSpacing: '-0.01em', fontWeight: '600' }],
        '3xl': ['40px', { lineHeight: '46px', letterSpacing: '-0.015em', fontWeight: '600' }],
        '4xl': ['48px', { lineHeight: '52px', letterSpacing: '-0.02em', fontWeight: '600' }],
        hero: ['64px', { lineHeight: '68px', letterSpacing: '-0.025em', fontWeight: '600' }],
      },
      // Custom color palette for XRMOD Demiurge
      colors: {
        border: 'var(--border)',
        'border-subtle': 'var(--border-subtle)',
        'border-strong': 'var(--border-strong)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: 'var(--destructive)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        info: 'var(--info)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        surface: {
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          hover: 'var(--surface-hover)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          disabled: 'var(--text-disabled)',
        },
      },
      // Semantic tokens are the only product color source.
      // Custom font families
      fontFamily: {
        sans: [
          '"SF Pro Text"',
          '"PingFang SC"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        display: [
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"PingFang SC"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: [
          '"SF Mono"',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      // Custom spacing
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '100': '25rem',
        '112': '28rem',
        '128': '32rem',
      },
      // Custom border radius
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      // Keep ordinary utility transitions inside the product motion budget.
      transitionDuration: {
        DEFAULT: '120ms',
      },
    },
  },
  plugins: [],
}
