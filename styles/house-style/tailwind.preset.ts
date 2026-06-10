import tokens from "./tokens.json";

const split = (s: string) => s.split(",").map((x) => x.trim());

// Use as a preset:  presets: [houseStyle]  in your tailwind.config.
const houseStyle = {
  theme: {
    extend: {
      colors: {
        canvas: tokens.color.canvas,
        surface: tokens.color.surface,
        paper: tokens.color.paper,
        card: tokens.color.card,
        ink: tokens.color.ink,
        "ink-2": tokens.color["ink-2"],
        muted: tokens.color.muted,
        "muted-2": tokens.color["muted-2"],
        line: tokens.color.line,
        "line-2": tokens.color["line-2"],
        accent: {
          DEFAULT: tokens.color.accent,
          red: tokens.color["accent-red"],
          green: tokens.color["accent-green"],
          blue: tokens.color["accent-blue"],
          amber: tokens.color["accent-amber"],
          violet: tokens.color["accent-violet"],
          rose: tokens.color["accent-rose"],
        },
      },
      borderRadius: { card: tokens.radius.card, pill: tokens.radius.pill },
      boxShadow: {
        card: tokens.shadow.card,
        "card-hover": tokens.shadow["card-hover"],
        pop: tokens.shadow.pop,
        ring: tokens.shadow.ring,
      },
      fontFamily: {
        sans: split(tokens.font.sans),
        display: split(tokens.font.sans),
        mono: split(tokens.font.mono),
      },
      letterSpacing: { tight: tokens.font.tracking },
      keyframes: tokens.motion.keyframes,
      animation: tokens.motion.animation,
    },
  },
};

export default houseStyle;
