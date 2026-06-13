import { BeverageType, ExtractedLabel, GeneratedCase } from "@/lib/contract";

/**
 * Render a generated label spec as a printable label image (SVG). Generated
 * cases go through the REAL vision pipeline: SVG -> PNG/PDF -> GPT-4o -> engine.
 */

const W = 480;
const H = 660;

type Palette = {
  paper: string;
  panel: string;
  ink: string;
  muted: string;
  accent: string;
  accentDark: string;
  accentSoft: string;
  border: string;
};

const PALETTES: Record<BeverageType, Palette[]> = {
  wine: [
    {
      paper: "#f8f3e7",
      panel: "#fffdf5",
      ink: "#182519",
      muted: "#667260",
      accent: "#b58b36",
      accentDark: "#31523a",
      accentSoft: "#e6d3a5",
      border: "#2e3d2e",
    },
    {
      paper: "#f5ece4",
      panel: "#fffaf1",
      ink: "#2b1516",
      muted: "#7d6259",
      accent: "#aa5b42",
      accentDark: "#6b1f2a",
      accentSoft: "#e8c5ad",
      border: "#5b302f",
    },
  ],
  distilled_spirits: [
    {
      paper: "#efe2c3",
      panel: "#f9f0d8",
      ink: "#241b13",
      muted: "#715f49",
      accent: "#b17b34",
      accentDark: "#5f2d1f",
      accentSoft: "#d9ba78",
      border: "#3b2b1e",
    },
    {
      paper: "#e8ded1",
      panel: "#fbf5e9",
      ink: "#171817",
      muted: "#5f625c",
      accent: "#8f6b3d",
      accentDark: "#253b36",
      accentSoft: "#c9b488",
      border: "#2c2d29",
    },
  ],
  malt_beverage: [
    {
      paper: "#102937",
      panel: "#fff4d8",
      ink: "#fdf8e9",
      muted: "#d4e3df",
      accent: "#e2b24c",
      accentDark: "#bf5131",
      accentSoft: "#6fb0a6",
      border: "#071821",
    },
    {
      paper: "#301923",
      panel: "#fff0dc",
      ink: "#fff8ed",
      muted: "#ead8c1",
      accent: "#f0b955",
      accentDark: "#7fb5aa",
      accentSoft: "#b55445",
      border: "#1b0c12",
    },
  ],
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrap(text: string, charsPerLine: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > charsPerLine) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitFontSize(line: string, base: number, maxChars: number, min = 12): number {
  if (line.length <= maxChars) return base;
  return Math.max(min, Math.round((base * maxChars) / line.length));
}

function paletteFor(type: BeverageType, seed: number): Palette {
  const list = PALETTES[type];
  return list[Math.abs(seed) % list.length];
}

function producerLocation(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(", ");
  return value;
}

function splitWarning(gw: ExtractedLabel["governmentWarning"]): { heading: string; body: string } | null {
  if (!gw.present || !gw.text) return null;
  const match = gw.text.match(/^(government warning:)\s*/i);
  if (!match) return { heading: "", body: gw.text };
  return { heading: match[1], body: gw.text.slice(match[0].length) };
}

function addCenteredLines(
  parts: string[],
  lines: string[],
  opts: {
    x?: number;
    y: number;
    baseSize: number;
    maxChars: number;
    lineGap: number;
    fill: string;
    family?: string;
    weight?: string;
    style?: string;
    letterSpacing?: number;
    minSize?: number;
  }
): number {
  let y = opts.y;
  const x = opts.x ?? W / 2;
  const family = opts.family ?? "Georgia, 'Times New Roman', serif";
  const weight = opts.weight ? ` font-weight="${opts.weight}"` : "";
  const style = opts.style ? ` font-style="${opts.style}"` : "";
  const spacing =
    opts.letterSpacing !== undefined ? ` letter-spacing="${opts.letterSpacing}"` : "";

  for (const line of lines) {
    const size = fitFontSize(line, opts.baseSize, opts.maxChars, opts.minSize ?? 12);
    parts.push(
      `<text x="${x}" y="${y}" text-anchor="middle" font-family="${family}" font-size="${size}"${weight}${style} fill="${opts.fill}"${spacing}>${esc(line)}</text>`
    );
    y += opts.lineGap;
  }
  return y;
}

function addProducer(parts: string[], label: ExtractedLabel, x: number, y: number, widthChars: number, fill: string): number {
  if (!label.producerNameAddress) return y;
  let cursor = y;
  for (const line of wrap(label.producerNameAddress.toUpperCase(), widthChars)) {
    parts.push(
      `<text x="${x}" y="${cursor}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="10.5" fill="${fill}" letter-spacing="0.6">${esc(line)}</text>`
    );
    cursor += 14;
  }
  return cursor;
}

function addHorizontalWarning(
  parts: string[],
  gw: ExtractedLabel["governmentWarning"],
  opts: {
    x: number;
    y: number;
    width: number;
    chars: number;
    fill?: string;
    boxFill?: string;
    boxStroke?: string;
  }
): void {
  const warning = splitWarning(gw);
  if (!warning) return;

  const fill = opts.fill ?? "#111";
  const bodyLines = wrap(warning.body, opts.chars);
  let y = opts.y;
  if (opts.boxFill || opts.boxStroke) {
    parts.push(
      `<rect x="${opts.x - 10}" y="${opts.y - 17}" width="${opts.width + 20}" height="92" rx="3" fill="${opts.boxFill ?? "none"}" stroke="${opts.boxStroke ?? "none"}" stroke-width="1"/>`
    );
  }
  if (warning.heading) {
    const first = bodyLines.shift() ?? "";
    parts.push(
      `<text x="${opts.x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="10.5" fill="${fill}"><tspan font-weight="700">${esc(warning.heading)}</tspan>${first ? ` ${esc(first)}` : ""}</text>`
    );
    y += 14;
  }
  for (const line of bodyLines.slice(0, 5)) {
    parts.push(
      `<text x="${opts.x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="10.5" fill="${fill}">${esc(line)}</text>`
    );
    y += 14;
  }
}

function addRotatedWarning(
  parts: string[],
  gw: ExtractedLabel["governmentWarning"],
  x: number,
  y: number,
  chars: number,
  fill: string
): void {
  const warning = splitWarning(gw);
  if (!warning) return;

  const bodyLines = wrap(warning.body, chars);
  let lineY = 0;
  parts.push(`<g transform="translate(${x} ${y}) rotate(-90)">`);
  if (warning.heading) {
    const first = bodyLines.shift() ?? "";
    parts.push(
      `<text x="0" y="${lineY}" font-family="Helvetica, Arial, sans-serif" font-size="10.5" fill="${fill}"><tspan font-weight="700">${esc(warning.heading)}</tspan>${first ? ` ${esc(first)}` : ""}</text>`
    );
    lineY += 12;
  }
  for (const line of bodyLines.slice(0, 5)) {
    parts.push(
      `<text x="0" y="${lineY}" font-family="Helvetica, Arial, sans-serif" font-size="10.5" fill="${fill}">${esc(line)}</text>`
    );
    lineY += 12;
  }
  parts.push("</g>");
}

function complianceFooter(parts: string[], label: ExtractedLabel, p: Palette, fill = p.ink): void {
  if (label.alcoholContent) {
    parts.push(
      `<text x="34" y="${H - 38}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${fill}">${esc(label.alcoholContent)}</text>`
    );
  }
  if (label.netContents) {
    parts.push(
      `<text x="${W - 34}" y="${H - 38}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${fill}">${esc(label.netContents)}</text>`
    );
  }
}

function renderWineEstate(label: ExtractedLabel, p: Palette, seed: number): string {
  const parts: string[] = [];
  const location = producerLocation(label.producerNameAddress);

  parts.push(
    `<rect width="${W}" height="${H}" fill="${p.paper}"/>`,
    `<rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="14" fill="${p.panel}" stroke="${p.border}" stroke-width="2"/>`,
    `<rect x="30" y="30" width="${W - 60}" height="${H - 60}" rx="10" fill="none" stroke="${p.accent}" stroke-width="1.2"/>`,
    `<path d="M48 132 C112 96 164 164 224 126 S350 96 432 134" fill="none" stroke="${p.accentSoft}" stroke-width="8" opacity="0.55"/>`,
    `<path d="M62 139 C128 115 164 156 222 136 S336 116 418 140" fill="none" stroke="${p.accentDark}" stroke-width="1.5" opacity="0.7"/>`,
    `<circle cx="240" cy="84" r="32" fill="${p.accentDark}" stroke="${p.accent}" stroke-width="3"/>`,
    `<path d="M224 86 C228 68 252 68 256 86 L252 104 L228 104 Z" fill="${p.panel}" opacity="0.95"/>`,
    `<circle cx="238" cy="83" r="5" fill="${p.accent}"/>`,
    `<circle cx="248" cy="88" r="5" fill="${p.accent}"/>`,
    `<circle cx="232" cy="93" r="5" fill="${p.accent}"/>`,
    `<path d="M238 69 C250 58 262 60 268 70" fill="none" stroke="${p.accentSoft}" stroke-width="2"/>`
  );

  let y = 158;
  if (label.brandName) {
    y = addCenteredLines(parts, wrap(label.brandName.toUpperCase(), 17), {
      y,
      baseSize: 32,
      maxChars: 17,
      lineGap: 36,
      fill: p.ink,
      weight: "700",
      letterSpacing: 1.6,
      minSize: 20,
    });
  }

  if (location) {
    parts.push(
      `<text x="${W / 2}" y="${y + 14}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="15" fill="${p.muted}" letter-spacing="2">${esc(location.toUpperCase())}</text>`
    );
    y += 42;
  } else {
    y += 24;
  }

  parts.push(
    `<line x1="132" y1="${y}" x2="${W - 132}" y2="${y}" stroke="${p.accent}" stroke-width="2"/>`,
    `<circle cx="${W / 2}" cy="${y}" r="3" fill="${p.accentDark}"/>`
  );
  y += 54;

  if (label.fancifulName) {
    y = addCenteredLines(parts, wrap(label.fancifulName, 24), {
      y,
      baseSize: 21,
      maxChars: 24,
      lineGap: 27,
      fill: p.accentDark,
      style: "italic",
      minSize: 15,
    });
    y += 8;
  }

  if (label.classType) {
    y = addCenteredLines(parts, wrap(label.classType, 24), {
      y,
      baseSize: 30,
      maxChars: 24,
      lineGap: 36,
      fill: p.ink,
      letterSpacing: 1.2,
      minSize: 18,
    });
  }

  if (label.wineVintage) {
    parts.push(
      `<text x="${W / 2}" y="${y + 28}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="24" fill="${p.accentDark}" letter-spacing="8">${esc(label.wineVintage)}</text>`
    );
    y += 58;
  }

  if (label.wineAppellation) {
    parts.push(
      `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="${p.muted}" letter-spacing="2.2">${esc(label.wineAppellation.toUpperCase())}</text>`
    );
    y += 24;
  }

  addProducer(parts, label, W / 2, Math.max(y + 12, 402), 42, p.ink);
  addHorizontalWarning(parts, label.governmentWarning, {
    x: 44,
    y: 492,
    width: W - 88,
    chars: 58,
    boxFill: "#fffaf0",
    boxStroke: p.accentSoft,
  });
  complianceFooter(parts, label, p);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-template="wine-estate" data-seed="${seed}">${parts.join("")}</svg>`;
}

function renderSpiritsPoster(label: ExtractedLabel, p: Palette, seed: number): string {
  const parts: string[] = [];
  const railX = 384;
  const labelBrand = label.brandName ? wrap(label.brandName.toUpperCase(), 16) : [];

  parts.push(
    `<rect width="${W}" height="${H}" fill="${p.paper}"/>`,
    `<rect x="20" y="22" width="${railX - 38}" height="${H - 44}" rx="8" fill="${p.panel}" stroke="${p.border}" stroke-width="2"/>`,
    `<rect x="${railX}" y="22" width="76" height="${H - 44}" fill="#fffdf8" stroke="${p.border}" stroke-width="2"/>`,
    `<path d="M48 74 L350 42 L344 184 L42 216 Z" fill="${p.accentSoft}" opacity="0.45"/>`,
    `<path d="M58 420 C118 386 286 386 346 420 L346 526 L58 526 Z" fill="${p.accentDark}" opacity="0.12"/>`,
    `<line x1="54" y1="560" x2="350" y2="560" stroke="${p.accent}" stroke-width="4"/>`
  );

  let y = 116;
  if (labelBrand.length > 0) {
    y = addCenteredLines(parts, labelBrand, {
      x: 202,
      y,
      baseSize: 34,
      maxChars: 16,
      lineGap: 38,
      fill: p.ink,
      weight: "700",
      letterSpacing: 1.2,
      minSize: 20,
    });
  }

  parts.push(
    `<text x="202" y="${y + 8}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="${p.muted}" letter-spacing="2.4">DISTILLED AND BOTTLED</text>`,
    `<line x1="92" y1="${y + 28}" x2="312" y2="${y + 28}" stroke="${p.accent}" stroke-width="1.5"/>`
  );
  y += 74;

  if (label.fancifulName) {
    y = addCenteredLines(parts, wrap(label.fancifulName.toUpperCase(), 18), {
      x: 202,
      y,
      baseSize: 22,
      maxChars: 18,
      lineGap: 28,
      fill: p.accentDark,
      weight: "700",
      letterSpacing: 1.4,
      minSize: 14,
    });
    y += 8;
  }

  if (label.classType) {
    y = addCenteredLines(parts, wrap(label.classType.toUpperCase(), 12), {
      x: 202,
      y: y - 4,
      baseSize: 28,
      maxChars: 12,
      lineGap: 33,
      fill: p.ink,
      weight: "700",
      letterSpacing: 1,
      minSize: 18,
    });
  }

  const location = producerLocation(label.producerNameAddress);
  if (location) {
    parts.push(
      `<text x="202" y="${Math.max(y + 22, 380)}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="15" fill="${p.muted}" letter-spacing="1.6">${esc(location.toUpperCase())}</text>`
    );
  }
  addProducer(parts, label, 202, 438, 35, p.ink);

  if (label.alcoholContent || label.netContents) {
    const alcohol = label.alcoholContent ?? "";
    const net = label.netContents ?? "";
    parts.push(
      `<text x="202" y="526" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="${p.ink}" letter-spacing="0.8">${esc([net, alcohol].filter(Boolean).join("  |  "))}</text>`
    );
  }

  addRotatedWarning(parts, label.governmentWarning, railX + 7, H - 52, 54, "#111");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-template="spirits-poster" data-seed="${seed}">${parts.join("")}</svg>`;
}

function renderBreweryBadge(label: ExtractedLabel, p: Palette, seed: number): string {
  const parts: string[] = [];

  parts.push(
    `<rect width="${W}" height="${H}" fill="${p.paper}"/>`,
    `<rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="12" fill="${p.paper}" stroke="${p.border}" stroke-width="3"/>`,
    `<path d="M18 104 H462 V170 H18 Z" fill="${p.accentDark}"/>`,
    `<path d="M18 506 H462 V566 H18 Z" fill="${p.accentSoft}" opacity="0.9"/>`,
    `<path d="M46 64 H434" stroke="${p.accent}" stroke-width="5"/>`,
    `<path d="M46 592 H434" stroke="${p.accent}" stroke-width="5"/>`,
    `<circle cx="240" cy="324" r="142" fill="${p.panel}" stroke="${p.accent}" stroke-width="8"/>`,
    `<circle cx="240" cy="324" r="116" fill="none" stroke="${p.border}" stroke-width="2" stroke-dasharray="8 7"/>`,
    `<path d="M146 334 C174 286 203 286 240 324 C276 286 306 286 334 334 C308 358 274 366 240 348 C206 366 172 358 146 334 Z" fill="${p.accentSoft}" opacity="0.85"/>`,
    `<path d="M240 211 V438" stroke="${p.accentDark}" stroke-width="2" opacity="0.45"/>`
  );

  let y = 86;
  if (label.brandName) {
    y = addCenteredLines(parts, wrap(label.brandName.toUpperCase(), 18), {
      y,
      baseSize: 30,
      maxChars: 18,
      lineGap: 33,
      fill: p.ink,
      weight: "700",
      letterSpacing: 1,
      minSize: 18,
    });
  }

  if (label.fancifulName) {
    addCenteredLines(parts, wrap(label.fancifulName.toUpperCase(), 20), {
      y: 212,
      baseSize: 16,
      maxChars: 20,
      lineGap: 20,
      fill: p.accentDark,
      weight: "700",
      letterSpacing: 2,
      minSize: 12,
    });
  }

  if (label.classType) {
    addCenteredLines(parts, wrap(label.classType.toUpperCase(), 11), {
      y: 292,
      baseSize: 30,
      maxChars: 11,
      lineGap: 34,
      fill: p.border,
      weight: "700",
      letterSpacing: 1.2,
      minSize: 17,
    });
  }

  addProducer(parts, label, W / 2, 490, 40, p.ink);
  addHorizontalWarning(parts, label.governmentWarning, {
    x: 44,
    y: 528,
    width: W - 88,
    chars: 58,
    boxFill: "#fffdf5",
    boxStroke: p.accent,
  });
  complianceFooter(parts, label, p, p.ink);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-template="brewery-badge" data-seed="${seed}">${parts.join("")}</svg>`;
}

export function renderLabelSvg(c: GeneratedCase, seed: number): string {
  const label: ExtractedLabel = c.label;
  const type = c.application.beverageType;
  const p = paletteFor(type, seed);

  if (type === "distilled_spirits") return renderSpiritsPoster(label, p, seed);
  if (type === "malt_beverage") return renderBreweryBadge(label, p, seed);
  return renderWineEstate(label, p, seed);
}
