// som-portal-v2/postcss.config.mjs
// Tailwind v4 uses a dedicated PostCSS plugin. Without this file, Tailwind
// never processes `app/globals.css` and the page renders unstyled.

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
