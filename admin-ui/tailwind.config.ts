import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f5f7ff",
          500: "#5563de",
          600: "#3f4bcc",
          700: "#333ea6",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
