/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          25: "#F5F9FF",
          50: "#EEF6FF",
          100: "#DBECFF",
          200: "#B8D9FF",
          300: "#8AC2FF",
          400: "#59A7FF",
          500: "#2D8CFF",
          600: "#1E6DDB",
          700: "#1554AD",
          800: "#123F80",
          900: "#0C2A55"
        }
      },
      boxShadow: {
        soft: "0 10px 30px rgba(34, 65, 134, 0.12)",
      },
      borderRadius: {
        xl2: "1rem"
      }
    },
  },
  plugins: [],
};