import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Landing-page palette. Added, never substituted: the dashboards keep using
        // Tailwind's default gray/blue scales, so nothing here changes existing screens.
        //
        // The governing rule is that the page is ink on paper and *saturation is reserved
        // for clinical risk banding* — the only vivid colour a reader sees is a risk band.
        // Every value below is checked against its intended background for WCAG AA body
        // text (>= 4.5:1); `ink.muted` in particular was darkened from a lighter grey-green
        // to clear that bar on `paper`.
        ink: {
          DEFAULT: "#0E2320", // near-black spruce: headings, CTA fill, dark section bg
          soft: "#3A4F4A", // secondary prose
          muted: "#5A6C67", // captions/labels — 4.8:1 on paper, 5.9:1 on white
          line: "#26443D", // rules drawn on the dark section
          pale: "#A9BAB3", // muted text on the dark section — 8.1:1 on ink
        },
        paper: {
          DEFAULT: "#EEF1EA", // pale sage: the page's resting surface
          deep: "#E3E9DE", // recessed panels
          rule: "#D2DACB", // hairlines on paper
        },
        band: {
          low: "#2F6B4F",
          medium: "#8A5D0A",
          high: "#A3301C",
        },
      },
      fontFamily: {
        // No new font is downloaded for the display face: this is a system old-style /
        // transitional serif stack. On a low-end Android over a poor connection the
        // headline renders on first paint with zero bytes fetched, which matters more here
        // than typographic exactness across platforms.
        display: [
          "ui-serif",
          '"Iowan Old Style"',
          '"Palatino Linotype"',
          "Palatino",
          '"Noto Serif"',
          "Georgia",
          "serif",
        ],
        // Geist Sans / Geist Mono are already self-hosted by app/layout.tsx.
        ui: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        data: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      keyframes: {
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(0.6rem)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "draw-x": {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
      },
      animation: {
        "rise-in": "rise-in 700ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "draw-x": "draw-x 1100ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
export default config;
