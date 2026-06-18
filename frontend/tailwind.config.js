/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      fontFamily: {
        // 内置几款可切换的字体，可在阅读器里切换
        sans: ['system-ui', 'sans-serif'],
        serif: ['Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        kai: ['"Kaiti SC"', '"STKaiti"', 'serif'],
        song: ['"Songti SC"', '"STSong"', 'serif'],
        hei: ['"Heiti SC"', '"STHeiti"', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc',
          400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1',
          800: '#075985', 900: '#0c4a6e',
        },
        // 霓虹紫粉 - 暗色主题主色
        neon: {
          purple:  '#a855f7',
          violet:  '#8b5cf6',
          pink:    '#ec4899',
          fuchsia: '#d946ef',
          cyan:    '#06b6d4',
        },
        // 深色主题色阶（背景/文字）
        ink: {
          50:  '#f5f3ff',
          100: '#e9e5ff',
          200: '#c4b5fd',
          300: '#a78bfa',
          400: '#8b5cf6',
          500: '#7c3aed',
          600: '#6d28d9',
          700: '#5b21b6',
          800: '#3b1d6e',
          850: '#27164a',
          900: '#1a0f33',
          950: '#0f0820',
        },
      },
      backgroundImage: {
        'gradient-cosmic': 'linear-gradient(135deg, #0f0820 0%, #1a0f33 50%, #27164a 100%)',
      },
      keyframes: {
        'pulse-neon': {
          '0%, 100%': { boxShadow: '0 0 12px rgba(168,85,247,0.4)' },
          '50%':      { boxShadow: '0 0 28px rgba(168,85,247,0.85)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        'pulse-neon': 'pulse-neon 2.4s ease-in-out infinite',
        shimmer: 'shimmer 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
