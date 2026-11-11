/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        raised: "var(--raised)",
        "raised-2": "var(--raised-2)",
        ink: "var(--ink)",
        soft: "var(--soft)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        brass: "var(--brass)",
        rec: "var(--rec)",
        "rec-soft": "var(--rec-soft)",
        highlight: "var(--highlight)",
      },
      fontFamily: {
        sans: ['"Inter"', '"Instrument Sans"', "Segoe UI", "sans-serif"],
        serif: ['"Instrument Serif"', "Georgia", "serif"],
      },
      boxShadow: {
        dock: "var(--shadow-md)",
        float: "var(--shadow-lg)",
      },
      maxWidth: {
        prose: "44rem",
      },
    },
  },
  plugins: [],
};
