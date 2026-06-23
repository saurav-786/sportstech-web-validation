import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          950: '#0b174c',
          900: '#101d64',
          800: '#1e1b7a',
          700: '#3434a8',
          600: '#5a45e8',
          500: '#7657ff',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, .04), 0 8px 24px rgba(30, 27, 122, .055)',
      },
    },
  },
  plugins: [],
};

export default config;
