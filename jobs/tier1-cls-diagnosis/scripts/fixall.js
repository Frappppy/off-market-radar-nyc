async (page) => {
  // Batched fix-validation runner for the remaining configs: map, data, healthfallback.
  // (root + trends were already validated by fix.js.)
  const INIT = 'jobs/tier1-cls-diagnosis/scripts/cls-init.js';

  const CONFIGS = {
    // "/map" — reserve the whole-page Suspense fallback at its final height.
    map: {
      route: '/map',
      css:
        '@media (max-width:1023px){main > p.text-sm{min-height:calc(100svh + 417px)}}' +
        '@media (min-width:1024px){main > p.text-sm{min-height:calc(100svh - 149px)}}',
    },
    // "/data" — reserve the whole-page Suspense fallback at its final height (itself
    //           viewport-height dependent via max-h-[calc(100svh-260px)]) AND raise the
    //           table scroll container's min-height to its max-height so the panel cannot
    //           grow when rows arrive.
    data: {
      route: '/data',
      css:
        '@media (max-width:639px){main > p.text-sm{min-height:calc(100svh + 921px)}}' +
        '@media (min-width:640px){main > p.text-sm{min-height:calc(100svh + 65px)}}' +
        'main .overflow-auto.min-h-\\[400px\\]{min-height:calc(100svh - 260px)}',
    },
    // "/trends" with /api/health forced to live:false and delayed 4s — isolates the health
    // card's OWN height change (loading/live branch vs fallback branch) from the page-wide
    // push, by keeping everything above it stable for 4s.
    healthfallback: {
      route: '/trends',
      css: '',
      delayHealthMs: 4000,
      api: {
        health: (j) => {
          j.live = false;
          return j;
        },
      },
    },
  };

  const combos = [
    [390, 844],
    [1280, 900],
    [1350, 940],
  ];

  await page.addInitScript({ path: INIT });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });

  const summary = {};

  for (const TAG of Object.keys(CONFIGS)) {
    const cfg = CONFIGS[TAG];
    const routes = [];
    if (cfg.css) {
      const m = (url) => url.pathname === cfg.route;
      const h = async (route) => {
        const resp = await route.fetch();
        const body = (await resp.text()).replace(
          '</head>',
          '<style id="cls-fix">' + cfg.css + '</style></head>'
        );
        await route.fulfill({ response: resp, body });
      };
      await page.route(m, h);
      routes.push([m, h]);
    }
    if (cfg.api) {
      for (const key of Object.keys(cfg.api)) {
        const m = '**/api/' + key + '*';
        const h = async (route) => {
          if (cfg.delayHealthMs && key === 'health') {
            await new Promise((r) => setTimeout(r, cfg.delayHealthMs));
          }
          const resp = await route.fetch();
          const j = await resp.json();
          await route.fulfill({ response: resp, json: cfg.api[key](j) });
        };
        await page.route(m, h);
        routes.push([m, h]);
      }
    }

    summary[TAG] = {};
    for (const [w, h] of combos) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 1, mobile: false, screenWidth: w, screenHeight: h,
      });
      await cdp.send('Network.clearBrowserCache');
      const t0 = Date.now();
      await page.goto('https://off-market-radar-nyc.vercel.app' + cfg.route, { waitUntil: 'load' });
      await page.waitForTimeout(cfg.delayHealthMs ? 12000 : 9000);
      const data = await page.evaluate((t) => {
        const s = window.__LS;
        // keep the payload small: geometry samples only for the health-card run
        const samples = t === 'healthfallback'
          ? s.samples.filter((row) => Object.keys(row.changed).some((k) => /panel|main > div/.test(k))).slice(0, 40)
          : [];
        return {
          clsRaw: s.clsRaw, clsFiltered: s.clsFiltered, inputs: s.inputs.length,
          fcp: s.fcp, lcp: s.lcp, shiftCount: s.shifts.length, shifts: s.shifts,
          docH: document.documentElement.scrollHeight, innerW: window.innerWidth,
          styleApplied: !!document.getElementById('cls-fix'),
          appliedCss: (function () { const el = document.getElementById('cls-fix'); return el ? el.textContent.length : 0; })(),
          cardRect: (function () {
            const el = document.querySelector('.panel');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) };
          })(),
          samples: samples,
        };
      }, TAG);
      data.wallMs = Date.now() - t0;
      data.tag = TAG;
      data.viewport = w + 'x' + h;
      await page.evaluate((d) => {
        const s = JSON.stringify(d);
        for (let i = 0; i < s.length; i += 6000) {
          console.log('@@FIX@@' + d.tag + '@@' + d.viewport + '@@' + i + '@@' + s.slice(i, i + 6000));
        }
        console.log('@@FIXEND@@' + d.tag + '@@' + d.viewport + '@@' + s.length);
      }, data);
      summary[TAG][w + 'x' + h] = {
        clsRaw: data.clsRaw, clsFiltered: data.clsFiltered, shiftCount: data.shiftCount,
        docH: data.docH, styleApplied: data.styleApplied, cardH: data.cardRect && data.cardRect.h,
      };
    }

    for (const [m, h] of routes) {
      try { await page.unroute(m, h); } catch (e) {}
    }
  }

  return 'FIXALL<' + JSON.stringify(summary) + '>';
}
