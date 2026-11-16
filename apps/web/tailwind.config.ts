import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 50: '#EEF2F8', 100: '#D9E2EF', 200: '#B3C4DE', 700: '#16365F', 800: '#0F2A4D', 900: '#0B2040' },
        teal: { 50: '#E6F7F5', 100: '#C2EBE6', 500: '#14A89B', 600: '#0E8D82', 700: '#0B7068' },
        paper: '#F6F8FA',
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      borderRadius: { card: '14px' },
    },
  },
  plugins: [],
} satisfies Config;
