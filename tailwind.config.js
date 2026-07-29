/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F6F4EC",
        paperLine: "#E4E9DE",
        paperStripe: "#EEF2E6",
        ink: "#1E3A2C",
        inkSoft: "#4C6357",
        inkFaint: "#8A9A8F",
        gold: "#A9793F",
        goldDeep: "#7C5626",
        greenStamp: "#2F6E4E",
        redStamp: "#A63A2E",
        cardBorder: "#D8DECF",
      },
      fontFamily: {
        serif: ["Fraunces", "serif"],
        sans: ["Inter", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
