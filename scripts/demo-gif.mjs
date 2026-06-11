/**
 * Demo-reel frame capture for the README GIF. Drives the production build at
 * localhost:3100 through the real verify flow (live GPT-4o call) and a small
 * batch, saving PNG frames to .demo-frames/. Assemble with scripts/make_gif.py.
 *
 * Run: node scripts/demo-gif.mjs
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3100";
const OUT = ".demo-frames";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);

let frame = 0;
async function snap(page, name) {
  frame += 1;
  const file = `${OUT}/${String(frame).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file });
  console.log("frame:", file);
}

async function clickByText(page, text, exact = false) {
  const clicked = await page.evaluate(
    ({ text, exact }) => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((x) =>
        exact ? x.textContent.trim() === text : x.textContent.includes(text)
      );
      if (!b || b.disabled) return false;
      b.click();
      return true;
    },
    { text, exact }
  );
  if (!clicked) throw new Error(`button not clickable: ${text}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForText(page, text, timeoutMs = 30000) {
  await page.waitForFunction(
    (t) => (document.querySelector("main")?.innerText ?? "").includes(t),
    { timeout: timeoutMs },
    text
  );
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();

try {
  // Scene 1: single verify on the real COLA.
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await snap(page, "verify-empty");

  await clickByText(page, "Load real example");
  await sleep(1200);
  await snap(page, "sample-loaded");

  await clickByText(page, "Verify label");
  await sleep(1400); // catch the Stepper mid-extraction
  await snap(page, "stepper");

  await page.waitForFunction(
    () => /MATCH SCORE/i.test(document.querySelector("main")?.innerText ?? ""),
    { timeout: 30000 }
  );
  await sleep(400);
  await snap(page, "result-100");

  // Scene 2: bad photo -> honest needs_review.
  await clickByText(page, "Try a bad photo");
  await sleep(1200);
  await clickByText(page, "Verify label");
  await page.waitForFunction(
    () => /MATCH SCORE/i.test(document.querySelector("main")?.innerText ?? ""),
    { timeout: 30000 }
  );
  await sleep(400);
  await snap(page, "bad-photo-result");

  // Scene 3: generator batch with real examples mixed in.
  await clickByText(page, "Generate test cases");
  await sleep(800);
  await clickByText(page, "3", true);
  await sleep(500);
  await clickByText(page, "+ real examples");
  await sleep(600);
  await snap(page, "generator-mixed");

  await clickByText(page, "Verify all");
  await sleep(2500);
  await snap(page, "batch-running");

  await page.waitForFunction(
    () => /8\/8 verified/.test(document.querySelector("main")?.innerText ?? ""),
    { timeout: 120000 }
  );
  await sleep(400);
  await snap(page, "batch-done");

  console.log("DONE");
} finally {
  await browser.close();
}
