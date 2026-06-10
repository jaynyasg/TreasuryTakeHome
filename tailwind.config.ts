import type { Config } from "tailwindcss";
import houseStyle from "./styles/house-style/tailwind.preset";

const config: Config = {
  presets: [houseStyle as unknown as Config],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: { extend: {} },
  plugins: [],
};

export default config;
