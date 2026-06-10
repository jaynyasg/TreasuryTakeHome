import { ExtractedLabel, GeneratedCase } from "@/lib/contract";

/**
 * Render a generated label spec as a printable label image (SVG). Generated
 * cases go through the REAL vision pipeline: SVG -> PNG -> GPT-4o -> engine.
 */

const W = 480;
const H = 660;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrap(text: string, charsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > charsPerLine) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const PALETTES = [
  { edge: "#1f2937", accent: "#8b6f47", bg: "#fdfcf8" },
  { edge: "#3b2f2f", accent: "#7a1f2b", bg: "#faf7f2" },
  { edge: "#14342b", accent: "#a8893c", bg: "#fbfaf5" },
  { edge: "#2b2b45", accent: "#4f5a78", bg: "#fafafc" },
];

export function renderLabelSvg(c: GeneratedCase, seed: number): string {
  const label: ExtractedLabel = c.label;
  const p = PALETTES[Math.abs(seed) % PALETTES.length];
  const parts: string[] = [];
  let y = 90;

  parts.push(
    `<rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="${p.edge}" stroke-width="3"/>`,
    `<rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="${p.accent}" stroke-width="1"/>`
  );

  if (label.brandName) {
    for (const line of wrap(label.brandName, 18)) {
      parts.push(
        `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Georgia, serif" font-size="34" font-weight="bold" fill="${p.edge}" letter-spacing="1">${esc(line)}</text>`
      );
      y += 40;
    }
  }
  y += 2;
  parts.push(`<line x1="120" y1="${y}" x2="${W - 120}" y2="${y}" stroke="${p.accent}" stroke-width="2"/>`);
  y += 38;

  if (label.fancifulName) {
    for (const line of wrap(label.fancifulName, 24)) {
      parts.push(
        `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Georgia, serif" font-size="22" font-style="italic" fill="${p.accent}">${esc(line)}</text>`
      );
      y += 28;
    }
    y += 6;
  }

  if (label.classType) {
    for (const line of wrap(label.classType, 28)) {
      parts.push(
        `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Georgia, serif" font-size="20" fill="${p.edge}">${esc(line)}</text>`
      );
      y += 26;
    }
    y += 4;
  }

  if (label.wineVintage) {
    parts.push(
      `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Georgia, serif" font-size="16" fill="${p.edge}">${esc(label.wineVintage)}</text>`
    );
    y += 24;
  }
  if (label.wineAppellation) {
    parts.push(
      `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Georgia, serif" font-size="13" fill="${p.accent}" letter-spacing="2">${esc(label.wineAppellation.toUpperCase())}</text>`
    );
    y += 24;
  }

  if (label.producerNameAddress) {
    y = Math.max(y + 8, 360);
    for (const line of wrap(label.producerNameAddress.toUpperCase(), 44)) {
      parts.push(
        `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="${p.edge}">${esc(line)}</text>`
      );
      y += 15;
    }
  }

  // Government warning block (bottom third).
  const gw = label.governmentWarning;
  if (gw.present && gw.text) {
    let wy = 470;
    const m = gw.text.match(/^(government warning:)\s*/i);
    const heading = m ? m[1] : "";
    const body = m ? gw.text.slice(m[0].length) : gw.text;
    const lines = wrap(body, 62);
    if (heading) {
      const firstBody = lines.shift() ?? "";
      parts.push(
        `<text x="34" y="${wy}" font-family="Helvetica, Arial, sans-serif" font-size="10.5" fill="#111"><tspan font-weight="bold">${esc(heading)}</tspan> ${esc(firstBody)}</text>`
      );
      wy += 14;
    }
    for (const line of lines) {
      parts.push(
        `<text x="34" y="${wy}" font-family="Helvetica, Arial, sans-serif" font-size="10.5" fill="#111">${esc(line)}</text>`
      );
      wy += 14;
    }
  }

  // ABV bottom-left, net contents bottom-right.
  if (label.alcoholContent) {
    parts.push(
      `<text x="34" y="${H - 38}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${p.edge}">${esc(label.alcoholContent)}</text>`
    );
  }
  if (label.netContents) {
    parts.push(
      `<text x="${W - 34}" y="${H - 38}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${p.edge}">${esc(label.netContents)}</text>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${p.bg}"/>${parts.join("")}</svg>`;
}
