import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1440px" }
    },
    extend: {
      colors: {
        cocoa: {
          950: "#15100D",
          900: "#1B130F",
          800: "#241813",
          700: "#2F211A",
          600: "#3D2B22",
          500: "#4F3A2E",
          400: "#6E5343",
          300: "#9B7A65"
        },
        cream: {
          DEFAULT: "#F5E9D7",
          dim: "#D9C8AF",
          mute: "#A8927A",
          deep: "#6E5A45"
        },
        electric: {
          DEFAULT: "#2E6CF6",
          soft: "#5A8CFF",
          deep: "#1B47B8"
        },
        jackson: {
          DEFAULT: "#3F38B5",
          soft: "#6D67D8",
          deep: "#1F1A6E"
        },
        vibrant: {
          DEFAULT: "#FFE600",
          soft: "#FFF06A",
          deep: "#C9B400"
        },
        hotpink: {
          DEFAULT: "#FF3B8A",
          soft: "#FF7BB0"
        },
        // Semantic shadcn-style aliases
        background: "#15100D",
        foreground: "#F5E9D7",
        card: "#1F1612",
        "card-foreground": "#F5E9D7",
        muted: "#2F211A",
        "muted-foreground": "#A8927A",
        border: "#3D2B22",
        ring: "#FFE600"
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      fontSize: {
        "display-2xl": ["clamp(3.5rem, 7vw, 6.5rem)", { lineHeight: "0.95", letterSpacing: "-0.04em" }],
        "display-xl": ["clamp(2.75rem, 5vw, 4.5rem)", { lineHeight: "0.98", letterSpacing: "-0.035em" }],
        "display-lg": ["clamp(2rem, 3.5vw, 3rem)", { lineHeight: "1.02", letterSpacing: "-0.03em" }]
      },
      borderRadius: {
        xl: "1.25rem",
        "2xl": "1.75rem",
        "3xl": "2.25rem"
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,230,0,0.25), 0 12px 40px -10px rgba(255,230,0,0.35)",
        card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 30px 60px -30px rgba(0,0,0,0.6)"
      },
      keyframes: {
        "ticker": {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-50%)" }
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(255,230,0,0.55)" },
          "50%": { boxShadow: "0 0 0 14px rgba(255,230,0,0)" }
        }
      },
      animation: {
        ticker: "ticker 40s linear infinite",
        "pulse-glow": "pulse-glow 2.4s ease-out infinite"
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

export default config;
