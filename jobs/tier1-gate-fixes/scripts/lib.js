// Shared helpers for the tier1-gate-fixes harness.
// Runs against a LOCAL production build (next start). Base URL is configurable
// via BASE env (default http://localhost:3222).
const path = require("path");

const PCORE =
  process.env.PW_CORE ||
  "D:\\Code\\Data Scraping\\repos\\mcp-servers\\playwright-mcp\\node_modules\\playwright-core";
const { chromium } = require(PCORE);

const EXE =
  process.env.PW_EXE ||
  "C:\\Users\\omisg\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe";
const BASE = process.env.BASE || "http://localhost:3222";
const AXE =
  process.env.AXE ||
  "D:\\Code\\porfolio_project\\Web Scraping\\Project 1 [The Off-Market Real Estate Deal Finder]\\jobs\\tier1-deployed-qa\\evidence\\raw\\axe.min.js";
const INSTR =
  process.env.INSTR ||
  "D:\\Code\\porfolio_project\\Web Scraping\\Project 1 [The Off-Market Real Estate Deal Finder]\\jobs\\tier1-cls-diagnosis\\scripts\\cls-init.js";

const OUT = process.env.OUT || "C:\\Users\\omisg\\AppData\\Local\\Temp\\opencode\\gate\\out";

async function launch() {
  return chromium.launch({
    headless: true,
    executablePath: EXE,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

// Force the viewport with CDP (mobile:false, dsf 1) and disable touch
// emulation, exactly as the deployed-QA gate did — page.setViewportSize()
// leaves layout at the previous width.
async function cell(browser, url, w, h, opts = {}) {
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const errs = [];
  const failed = [];
  const bad = [];
  const api = [];
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 300)));
  page.on("requestfailed", (r) =>
    failed.push(r.url() + " :: " + ((r.failure() || {}).errorText || "?"))
  );
  page.on("response", (r) => {
    if (r.status() >= 400) bad.push(r.status() + " " + r.url());
    if (opts.watchApi && /\/api\/deals/.test(r.url())) {
      api.push({ t: Date.now(), url: r.url().replace(BASE, "") });
    }
  });
  if (opts.init) await page.addInitScript({ path: opts.init });
  await page.goto(BASE + url, { waitUntil: "load", timeout: 60000 });
  if (opts.settle) await page.waitForTimeout(opts.settle);
  return { ctx, page, errs, failed, bad, api };
}

const writeJson = (p, obj) =>
  require("fs").writeFileSync(p, JSON.stringify(obj, null, 2));
const writeText = (p, s) => require("fs").writeFileSync(p, s);

module.exports = { chromium, launch, cell, BASE, EXE, AXE, INSTR, OUT, writeJson, writeText, path };
