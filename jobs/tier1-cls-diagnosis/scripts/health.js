async (page) => {
  // Clean-context health-card isolation. Leftover page.route registrations from earlier
  // runs persist for the page's lifetime, so clear them first (fixall.js's healthfallback
  // row was contaminated by fix.js's /trends CSS route -> styleApplied was true).
  try { await page.unrouteAll({ behavior: 'ignoreErrors' }); } catch (e) {}
  try { await page.unroute('**/*'); } catch (e) {}

  const SAMPLER = {
    content: `(() => {
      const H = { rows: [], t0: Math.round(performance.timeOrigin) };
      window.__H = H;
      const q = () => {
        const card = document.querySelector('section[aria-labelledby="ingestion-health-heading"]');
        const hdr = card && card.querySelector('div');
        const dl = card && card.querySelector('dl');
        const badges = card ? card.querySelectorAll('span.rounded') : [];
        const txt = card ? card.innerText.replace(/\\s+/g,' ').slice(0,90) : null;
        const r = (el) => el ? [Math.round(el.getBoundingClientRect().y), Math.round(el.getBoundingClientRect().height)] : null;
        return {
          card: r(card), hdr: r(hdr), dl: r(dl),
          badgeN: badges.length,
          mainH: (() => { const m = document.querySelector('main'); return m ? Math.round(m.getBoundingClientRect().height) : null; })(),
          footY: (() => { const f = document.querySelector('footer'); return f ? Math.round(f.getBoundingClientRect().y) : null; })(),
          doc: document.documentElement.scrollHeight,
          liveTxt: txt && /frozen fallback/.test(txt) ? 'frozen' : 'live',
        };
      };
      const tick = () => {
        const fp = JSON.stringify(q());
        if (H.rows.length === 0 || fp !== H.last) { H.last = fp; H.rows.push({ t: Math.round(performance.now()), v: JSON.parse(fp) }); }
        if (H.rows.length < 200) requestAnimationFrame(tick);
      };
      const start = () => requestAnimationFrame(tick);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    })();`,
  };

  const combos = [[390, 844], [1280, 900]];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.addInitScript(SAMPLER);

  const out = {};

  for (const mode of ['live', 'frozen']) {
    const handlers = [];
    if (mode === 'frozen') {
      const m = '**/api/health*';
      const h = async (route) => {
        await new Promise((r) => setTimeout(r, 3000));
        const resp = await route.fetch();
        const j = await resp.json();
        j.live = false;
        await route.fulfill({ response: resp, json: j });
      };
      await page.route(m, h);
      handlers.push([m, h]);
    }

    for (const [w, h] of combos) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 1, mobile: false, screenWidth: w, screenHeight: h,
      });
      await cdp.send('Network.clearBrowserCache');
      await page.goto('https://off-market-radar-nyc.vercel.app/trends', { waitUntil: 'load' });
      await page.waitForTimeout(9000);
      const d = await page.evaluate(() => ({
        rows: window.__H.rows,
        clsFixPresent: !!document.getElementById('cls-fix'),
      }));
      out[mode + '|' + w + 'x' + h] = { clsFixPresent: d.clsFixPresent, rows: d.rows };
    }

    for (const [m, h] of handlers) { try { await page.unroute(m, h); } catch (e) {} }
  }

  return 'HEALTH<' + JSON.stringify(out) + '>';
}
