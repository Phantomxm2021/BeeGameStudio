/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Custom color palette for XRMOD Demiurge
      colors: {
        // Primary brand colors
        primary: {
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
        // Agent-specific colors
        agent: {
          logos: '#3b82f6',      // Blue
          metis: '#a855f7',      // Purple
          tecton: '#10b981',     // Green
          hephaestus: '#f97316', // Orange
          morphe: '#ec4899',     // Pink
          harmonia: '#06b6d4',   // Cyan
          mnemosyne: '#6366f1',  // Indigo
          sophia: '#eab308',     // Yellow
          prometheus: '#ef4444', // Red
          athena: '#14b8a6',     // Teal
        },
        // Status colors
        status: {
          idle: '#6b7280',       // Gray
          working: '#10b981',    // Green
          error: '#ef4444',      // Red
          warning: '#f59e0b',    // Amber
          success: '#10b981',    // Green
        },
        // Dark theme colors
        dark: {
          bg: {
            primary: '#0f172a',   // slate-900
            secondary: '#1e293b', // slate-800
            tertiary: '#334155',  // slate-700
          },
          text: {
            primary: '#f1f5f9',   // slate-100
            secondary: '#cbd5e1', // slate-300
            tertiary: '#94a3b8',  // slate-400
          },
          border: '#334155',      // slate-700
        },
      },
      // Custom font families
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: [
          '"Fira Code"',
          '"JetBrains Mono"',
          'Menlo',
          'Monaco',
          'Consolas',
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
        '4xl': '2rem',
      },
      // Custom box shadows
      boxShadow: {
        'glow': '0 0 20px rgba(59, 130, 246, 0.5)',
        'glow-lg': '0 0 30px rgba(59, 130, 246, 0.6)',
        'agent': '0 4px 20px rgba(0, 0, 0, 0.15)',
        'card': '0 2px 8px rgba(0, 0, 0, 0.1)',
      },
      // Custom animations
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 3s linear infinite',
        'bounce-slow': 'bounce 2s infinite',
        'fade-in': 'fadeIn 0.3s ease-in',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      // Custom backdrop blur
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
