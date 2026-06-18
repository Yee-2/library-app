/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  darkMode: false,
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        serif: ['Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        kai: ['"Kaiti SC"', '"STKaiti"', 'serif'],
        song: ['"Songti SC"', '"STSong"', 'serif'],
        hei: ['"Heiti SC"', '"STHeiti"', 'sans-serif'],
      },
      colors: {
        // 主色 - 专业靛蓝
        primary: {
          DEFAULT: '#6366f1',
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        // 强调色 - 天空蓝
        accent: {
          DEFAULT: '#0ea5e9',
          50:  '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
        },
        // 中性灰阶（正文/次级文字/边框）
        ink: {
          50:  '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#a1a1aa',
          400: '#71717a',
          500: '#52525b',
          600: '#3f3f46',
          700: '#27272a',
          800: '#18181b',
          850: '#141416',
          900: '#09090b',
          950: '#040405',
        },
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
