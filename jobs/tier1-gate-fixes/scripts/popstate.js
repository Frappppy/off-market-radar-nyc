// popstate / history / navigation consistency for the external URL store.
// Nobody has ever tested this path: the store folds in `window.location` on
// (re)subscribe and on `popstate`, while filter writes go through `setUrlSearch`
// + `router.replace` (which does NOT create a history entry). The risk is a state
// that disagrees with the URL, or a stale query surviving a soft navigation.
//
// Steps: load defaults -> set min_dom=90 in the UI -> history.back/forward ->
// SPA navigate away and back -> deep-link the same cohort directly. At every step
// we record the URL, the rendered cohort and the slider, because the invariant is
// simply: the rendered cohort always matches the URL.
const { launch, cell, BASE, OUT, writeJson } = require("./lib");

const read = () => {
  const kpi = {};
  document.querySelectorAll("dl dt").forEach((dt) => {
    const dd = dt.parentElement.querySelector("dd");
    kpi[dt.innerText.trim()] = dd ? dd.innerText.trim() : null;
  });
  const txt = document.body.innerText.replace(/\s+/g, " ");
  return {
    path: location.pathname,
    search: location.search,
    inFilter: kpi["IN FILTER"] || kpi["In filter"] || null,
    shownOf: (txt.match(/(\d+) of ([\d,]+) shown/) || [])[0] || null,
    csv: (([...document.querySelectorAll("a")].find((a) => /rows as CSV/.test(a.innerText)) || {}).innerText || "").trim() || null,
    slider: (() => { const s = document.querySelector("input[type=range]"); return s ? s.value : null; })(),
    notices: [...document.querySelectorAll("[class*=notice], .border-amber-300, .border-yellow-300")]
      .map((n) => n.innerText.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3),
  };
};

(async () => {
  const browser = await launch();
  const ROUTE = process.env.ROUTE || "/map";
  const TAG = process.env.TAG || "popstate";
  const out = { base: BASE, route: ROUTE, steps: [] };
  const log = [];
  const say = (s) => { console.log(s); log.push(s); };

  const c = await cell(browser, ROUTE, 1280, 900, { settle: 8000, watchApi: true });
  const step = async (label) => {
    const s = await c.page.evaluate(read);
    out.steps.push({ label, ...s, apiCalls: c.api.length, errs: c.errs.length });
    say(`POPSTATE ${label}: url="${s.path}${s.search}" inFilter=${s.inFilter} slider=${s.slider} shownOf=${s.shownOf} csv="${s.csv}" api=${c.api.length} errs=${c.errs.length}`);
  };

  await step("1 initial (defaults)");

  // 2. drive the UI: set the min_dom range to 90 through the native setter so
  // React's onChange fires (setting .value directly is swallowed by React).
  const applied = await c.page.evaluate(() => {
    const s = document.querySelector("input[type=range]");
    if (!s) return "no range input";
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(s), "value").set;
    setter.call(s, "90");
    s.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return "min_dom=90";
  });
  await c.page.waitForTimeout(4000);
  await step(`2 UI set (${applied})`);

  // 3. history.back()
  await c.page.goBack().catch((e) => say(`POPSTATE goBack error: ${e.message}`));
  await c.page.waitForTimeout(4000);
  await step("3 history.back()");

  // 4. history.forward()
  await c.page.goForward().catch((e) => say(`POPSTATE goForward error: ${e.message}`));
  await c.page.waitForTimeout(4000);
  await step("4 history.forward()");

  // 5. SPA navigate away and back (store must not serve a stale query)
  await c.page.click('a[href="/data"]').catch(() => {});
  await c.page.waitForTimeout(4000);
  await step("5 SPA nav -> /data");
  await c.page.click('a[href="' + ROUTE + '"]').catch(() => {});
  await c.page.waitForTimeout(5000);
  await step(`6 SPA nav -> ${ROUTE}`);

  // 7. deep-link the same cohort the UI produced, in a fresh context, so the
  // UI-driven and link-driven renders can be compared directly.
  const c2 = await cell(browser, ROUTE + "?min_dom=90", 1280, 900, { settle: 9000, watchApi: true });
  const deep = await c2.page.evaluate(read);
  out.steps.push({ label: "7 deep-link ?min_dom=90", ...deep, apiCalls: c2.api.length, errs: c2.errs.length });
  say(`POPSTATE 7 deep-link ?min_dom=90: inFilter=${deep.inFilter} slider=${deep.slider} shownOf=${deep.shownOf} csv="${deep.csv}" api=${c2.api.length} errs=${c2.errs.length}`);
  out.compare = {
    uiAfterStep2: out.steps[1],
    deepLink: deep,
    uiMatchesDeepLink: out.steps[1].inFilter === deep.inFilter && out.steps[1].csv === deep.csv,
  };
  say(`POPSTATE ui-vs-deeplink match: ${out.compare.uiMatchesDeepLink} (ui=${out.steps[1].inFilter} ${out.steps[1].csv} | deep=${deep.inFilter} ${deep.csv})`);

  out.api = c.api.map((a) => a.url);
  out.errs = c.errs;
  say(`POPSTATE api (${c.api.length}): ${out.api.join(" | ")}`);
  say(`POPSTATE console errors: ${c.errs.length}${c.errs.length ? " :: " + c.errs.join(" | ") : ""}`);
  writeJson(`${OUT}\\${TAG}.json`, out);
  await c.ctx.close();
  await c2.ctx.close();
  await browser.close();
  say("POPSTATE DONE");
})();
