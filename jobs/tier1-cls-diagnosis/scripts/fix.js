async (page) => {
  // Fix-validation runner. TAG selects the config below. Loops 3 device-emulated viewports.
  const TAG = 'trends';
  const INIT = 'jobs/tier1-cls-diagnosis/scripts/cls-init.js';

  const CONFIGS = {
    // "/" — (1) reserve the Explorer Suspense fallback to the height its content will take,
    //       (2) ablate the conditional hero "Sample scope" paragraph by making /api/meta
    //           report no total_tracked, so the paragraph is never inserted.
    root: {
      route: '/',
      css:
        '@media (max-width:639px){main > div > p.text-sm{min-height:520px}}' +
        '@media (min-width:640px){main > div > p.text-sm{min-height:472px}}',
      api: {
        meta: (j) => {
          j.total_tracked = null;
          return j;
        },
      },
    },
    // "/trends" — reserve the whole-page Suspense fallback at its final height, and reserve
    //             the data-gated h1 paragraph at its max (loading-state) height.
    trends: {
      route: '/trends',
      css:
        '@media (max-width:639px){main > p.text-sm{min-height:4260px}}' +
        '@media (min-width:640px){main > p.text-sm{min-height:2295px}}' +
        'main > div > div.flex.flex-wrap.items-start > div.min-w-0 > p.mt-1{min-height:80px}',
    },
    // "/map" — reserve the whole-page Suspense fallback at its final height.
    map: {
      route: '/map',
      css:
        '@media (max-width:1023px){main > p.text-sm{min-height:calc(100svh + 417px)}}' +
        '@media (min-width:1024px){main > p.text-sm{min-height:calc(100svh - 149px)}}',
    },
    // "/data" — reserve the whole-page Suspense fallback at its final height (which is
    //           itself viewport-height dependent because of max-h-[calc(100svh-260px)]).
    data: {
      route: '/data',
      css:
        '@media (max-width:639px){main > p.text-sm{min-height:calc(100svh + 921px)}}' +
        '@media (min-width:640px){main > p.text-sm{min-height:calc(100svh + 65px)}}',
    },
    // "/trends" with every font request blocked — tests the webfont-swap hypothesis.
    trendsnofonts: {
      route: '/trends',
      blockFonts: true,
      css: '',
    },
    // "/trends" with /api/health delayed 4s and forced to live:false — measures the health
    // card's own growth when the payload reports fallback mode.
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

  const cfg = CONFIGS[TAG];
  const combos = [
    [390, 844],
    [1280, 900],
    [1350, 940],
  ];
  const summary = {};

  await page.addInitScript({ path: INIT });
  if (cfg.blockFonts) {
    await page.route((url) => /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url.pathname), (r) => r.abort());
  }
  if (cfg.css) {
    await page.route(
      (url) => url.pathname === cfg.route,
      async (route) => {
        const resp = await route.fetch();
        const body = (await resp.text()).replace('</head>', '<style id="cls-fix">' + cfg.css + '</style></head>');
        await route.fulfill({ response: resp, body });
      }
    );
  }
  if (cfg.api) {
    for (const key of Object.keys(cfg.api)) {
      await page.route('**/api/' + key + '*', async (route) => {
        const resp = await route.fetch();
        const j = await resp.json();
        await route.fulfill({ response: resp, json: cfg.api[key](j) });
      });
    }
  }
  if (cfg.delayHealthMs) {
    await page.route('**/api/health*', async (route) => {
      await new Promise((r) => setTimeout(r, cfg.delayHealthMs));
      const resp = await route.fetch();
      const j = await resp.json();
      if (cfg.api && cfg.api.health) cfg.api.health(j);
      await route.fulfill({ response: resp, json: j });
    });
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  for (const [w, h] of combos) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: false, screenWidth: w, screenHeight: h,
    });
    await cdp.send('Network.clearBrowserCache');
    const t0 = Date.now();
    await page.goto('https://off-market-radar-nyc.vercel.app' + cfg.route, { waitUntil: 'load' });
    await page.waitForTimeout(cfg.delayHealthMs ? 11000 : 9000);
    const data = await page.evaluate(() => {
      const s = window.__LS;
      return {
        clsRaw: s.clsRaw, clsFiltered: s.clsFiltered, inputs: s.inputs.length,
        fcp: s.fcp, lcp: s.lcp, shiftCount: s.shifts.length, shifts: s.shifts,
        docH: document.documentElement.scrollHeight, innerW: window.innerWidth,
        styleApplied: !!document.getElementById('cls-fix'),
        appliedCss: (function () { const el = document.getElementById('cls-fix'); return el ? el.textContent.length : 0; })(),
      };
    });
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
    summary[w + 'x' + h] = {
      clsRaw: data.clsRaw, clsFiltered: data.clsFiltered, shiftCount: data.shiftCount,
      docH: data.docH, styleApplied: data.styleApplied,
    };
  }
  return 'FIXSUMMARY<' + TAG + '>' + JSON.stringify(summary) + '</FIXSUMMARY>';
}
