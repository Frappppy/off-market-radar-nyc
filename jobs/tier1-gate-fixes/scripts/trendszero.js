// Why does production render "In filter 0" persistently where local showed "…"?
// Capture the console, the failed requests, and the actual /api/deals response
// on bare /trends, so the claim is attributed rather than guessed.
const { launch, cell, BASE, OUT, writeJson } = require("./lib");

(async () => {
  const browser = await launch();
  const c = await cell(browser, "/trends", 1280, 900, { settle: 0, watchApi: true });
  const samples = [];
  for (const t of [200, 500, 1000, 2000, 4000, 7000]) {
    await c.page.waitForTimeout(t - (samples[samples.length - 1]?.t ?? 0));
    const s = await c.page.evaluate(() => {
      const kpi = {};
      document.querySelectorAll("dl dt").forEach((dt) => {
        const dd = dt.parentElement.querySelector("dd");
        kpi[dt.innerText.trim().toLowerCase()] = dd ? dd.innerText.trim() : null;
      });
      return { inFilter: kpi["in filter"] ?? null, rows: document.querySelectorAll("tbody tr").length };
    });
    samples.push({ t, ...s });
    console.log(`DIAG t=${t}ms inFilter="${s.inFilter}" tbodyRows=${s.rows}`);
  }

  // Ask the API directly from the page, the same way the page does.
  const direct = await c.page.evaluate(async () => {
    try {
      const r = await fetch("/api/deals?score=High,Medium&min_dom=60&limit=500");
      const j = await r.json();
      return { status: r.status, n: (j.deals || []).length, keys: Object.keys(j).slice(0, 6) };
    } catch (e) {
      return { err: String(e) };
    }
  });
  console.log(`DIAG direct API: ${JSON.stringify(direct)}`);

  console.log(`DIAG api log (${c.api.length}): ${JSON.stringify(c.api)}`);
  console.log(`DIAG console errors (${c.errs.length}): ${c.errs.join(" | ")}`);
  console.log(`DIAG failed requests (${c.failed.length}): ${JSON.stringify(c.failed)}`);
  console.log(`DIAG 4xx/5xx (${c.status4xx.length}): ${JSON.stringify(c.status4xx)}`);

  writeJson(`${OUT}\\trends-zero.json`, { base: BASE, samples, direct, api: c.api, errs: c.errs, failed: c.failed, status4xx: c.status4xx });
  await c.ctx.close();
  await browser.close();
  console.log("DIAG DONE");
})();
