/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep, lawyerly ink + a confident accent.
        ink: {
          950: '#0b0f1a',
          900: '#10162a',
          800: '#1a2238',
          700: '#26304b',
          // Muted text/icon colour. Lifted from #36425f (~1.8:1 contrast,
          // illegible on the dark blue) to a readable blue-grey (~5:1, AA) that's
          // still clearly secondary to the slate-100/300 primary text.
          600: '#8a96b4'
        },
        accent: {
          DEFAULT: '#c9a24b', // brass / legal gold
          soft: '#e6cf94',
          deep: '#a07f2e'
        },
        paper: '#f7f5ef'
      },
      fontFamily: {
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}
