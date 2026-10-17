async (page) => {
  // Clean re-run of the /map and /data fix validations (fixall.js's earlier rows shared
  // the page with fix.js's leftover /trends document route and **/api/meta* route).
  try { await page.unrouteAll({ behavior: 'ignoreErrors' }); } catch (e) {}

  const INIT = 'jobs/tier1-cls-diagnosis/scripts/cls-init.js';

  const CONFIGS = {
    map: {
      route: '/map',
      css:
        '@media (max-width:1023px){main > p.text-sm{min-height:calc(100svh + 417px)}}' +
        '@media (min-width:1024px){main > p.text-sm{min-height:calc(100svh - 149px)}}',
    },
    data: {
      route: '/data',
      css:
        '@media (max-width:639px){main > p.text-sm{min-height:calc(100svh + 921px)}}' +
        '@media (min-width:640px){main > p.text-sm{min-height:calc(100svh + 65px)}}' +
        'main .overflow-auto.min-h-\\[400px\\]{min-height:calc(100svh - 260px)}',
    },
  };

  await page.addInitScript({ path: INIT });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });

  const out = [];
  for (const TAG of Object.keys(CONFIGS)) {
    const cfg = CONFIGS[TAG];
    const M = (url) => url.pathname === cfg.route;
    const H = async (route) => {
      const resp = await route.fetch();
      const body = (await resp.text()).replace('</head>', '<style id="cls-fix">' + cfg.css + '</style></head>');
      await route.fulfill({ response: resp, body });
    };
    await page.route(M, H);
    for (const [w, h] of [[390, 844], [1280, 900], [1350, 940]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 1, mobile: false, screenWidth: w, screenHeight: h,
      });
      await cdp.send('Network.clearBrowserCache');
      await page.goto('https://off-market-radar-nyc.vercel.app' + cfg.route, { waitUntil: 'load' });
      await page.waitForTimeout(9000);
      const d = await page.evaluate(() => ({
        clsRaw: window.__LS.clsRaw,
        clsFiltered: window.__LS.clsFiltered,
        shiftCount: window.__LS.shifts.length,
        shifts: window.__LS.shifts.map((s) => ({
          t: s.t, v: s.value,
          src: s.sources.map((x) => (x.node && (x.node.textNode ? 'TEXT ' + x.node.path : x.node.path)) || ''),
        })),
        docH: document.documentElement.scrollHeight,
        fix: !!document.getElementById('cls-fix'),
      }));
      out.push(TAG + ' | ' + w + 'x' + h + ' | clsRaw=' + d.clsRaw + ' shifts=' + d.shiftCount +
        ' docH=' + d.docH + ' fixApplied=' + d.fix);
      for (const s of d.shifts) {
        out.push('    t=' + s.t + ' v=' + s.v + ' srcs=' + s.src.slice(0, 3).join(' ~ '));
      }
    }
    try { await page.unroute(M, H); } catch (e) {}
  }
  return 'FIXMD<\n' + out.join('\n') + '\n>FIXMD';
}
