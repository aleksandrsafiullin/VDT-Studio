import type { Config } from "tailwindcss";

const config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#f7f8fa",
        ink: "#17202a",
        muted: "#667085",
        line: "#d8dee8",
        accent: "#2f6fed",
        teal: "#0f9f8f",
        graphite: "#2f3642"
      },
      boxShadow: {
        panel: "0 14px 40px rgba(26, 35, 52, 0.08)",
        node: "0 8px 24px rgba(30, 42, 60, 0.10)"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"]
      }
    }
  },
  plugins: []
} satisfies Config;

export default config;
