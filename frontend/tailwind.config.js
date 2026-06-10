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
      },
    },
  },
  plugins: [],
}
