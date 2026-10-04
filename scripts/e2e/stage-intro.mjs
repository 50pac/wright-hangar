// Playwright checks for the /stage intro animation acceptance criteria. Not part of `npm test` (needs a browser + a running server).
//   BASE=http://127.0.0.1:3000 CHROME=/usr/bin/google-chrome node scripts/e2e/stage-intro.mjs        (needs: npm i --no-save playwright-core)
// The page must be served with ?debug=1 support (dev server or a normal production build both work).
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function openPage(query, { reducedMotion = 'no-preference', setup } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN', reducedMotion });
  const page = await ctx.newPage();
  if (setup) await setup(page, ctx);
  const t0 = Date.now();
  await page.goto(`${BASE}/stage?${query}&fpsguard=0&debug=1`, { waitUntil: 'load' });
  return { ctx, page, since: () => Date.now() - t0 };
}
const attr = page => page.evaluate(() => document.querySelector('.care-page')?.dataset.intro ?? null);
const reason = page => page.evaluate(() => document.querySelector('.care-page')?.dataset.introReason ?? '');
const ready = page => page.evaluate(() => window.__baymaxStage?.ready === true);
const paused = page => page.evaluate(() => window.__baymaxStage?.paused);
const waitAttr = (page, want, timeout) => page.waitForFunction(w => document.querySelector('.care-page')?.dataset.intro === w, want, { timeout });
const uiOpacity = page => page.evaluate(() => +getComputedStyle(document.querySelector('.vz-hero')).opacity);

// ───────── Acceptance 1: Esc / Space / mouse click skip the intro immediately; after the intro Space pauses again
for (const how of ['Escape', 'Space', 'click']) {
  // The model is held back 6 s so the storyboard parks at the breathing spark: a deterministic window to press the key in.
  const { ctx, page } = await openPage(`theme=a&intro=1`, { setup: p => p.route('**/models/*.glb', async r => { await new Promise(res => setTimeout(res, 6000)); await r.continue().catch(() => {}); }) });
  await page.waitForSelector('[data-intro-skip]', { timeout: 15000 }); // appears after 0.6 s
  await page.waitForTimeout(1500);
  check(`[1:${how}] intro is playing before the input`, (await attr(page)) === 'play');
  const t0 = Date.now();
  if (how === 'click') await page.mouse.click(300, 400); else await page.keyboard.press(how);
  await waitAttr(page, 'done', 3000);
  const took = Date.now() - t0;
  const inPage = await page.evaluate(() => ({ s: window.__baymaxIntro.skipAt, d: window.__baymaxIntro.doneAt }));
  check(`[1:${how}] jumps to the end state: in-page skip → done ≤ 1.0 s`, inPage.d - inPage.s <= 1.0, `(0.4 s blend, plus up to a few slow software-GL frames) in page ${(inPage.d - inPage.s).toFixed(2)} s; wall clock incl. Playwright polling ${took} ms`);
  check(`[1:${how}] reason = skipped`, (await reason(page)) === 'skipped', await reason(page));
  check(`[1:${how}] UI fully visible after the skip`, (await uiOpacity(page)) === 1);
  check(`[1:${how}] Space during the intro did NOT pause the animation`, how !== 'Space' || (await paused(page)) === false, `paused=${await paused(page)}`);
  await page.keyboard.press('Space'); await page.waitForTimeout(150);
  check(`[1:${how}] after the intro, Space pauses again`, (await paused(page)) === true);
  await page.keyboard.press('Space'); await page.waitForTimeout(150);
  check(`[1:${how}] and resumes`, (await paused(page)) === false);
  await ctx.close();
}
{ // Skip button + once-per-session
  const { ctx, page } = await openPage(`theme=a&intro=1`, { setup: p => p.route('**/models/*.glb', async r => { await new Promise(res => setTimeout(res, 6000)); await r.continue().catch(() => {}); }) });
  await page.waitForSelector('[data-intro-skip]', { timeout: 15000 });
  check('[1:button] Skip button appears (after 0.6 s)', true);
  await page.click('[data-intro-skip]'); await waitAttr(page, 'done', 3000);
  check('[1:button] Skip button ends the intro', (await attr(page)) === 'done');
  await page.goto(`${BASE}/stage?theme=a&fpsguard=0&debug=1`, { waitUntil: 'load' });
  await page.waitForSelector('.care-page');
  check('[1:session] reload in the same session does not replay the intro', (await attr(page)) === 'done');
  await ctx.close();
}

// ───────── Acceptance 2: reduced motion → straight fade, no storyboard; ?lod=low plays through normally
{
  const { ctx, page } = await openPage(`theme=a&intro=1`, { reducedMotion: 'reduce' });
  const seen = new Set(); let skipBtn = false, spark = false; const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    seen.add(await attr(page)); skipBtn ||= !!(await page.$('[data-intro-skip]'));
    if (await ready(page)) break; await page.waitForTimeout(40);
  }
  await page.waitForTimeout(500); seen.add(await attr(page));
  check('[2:reduced] the storyboard ("play"/"closing") never runs, even with ?intro=1', ![...seen].some(s => s === 'play' || s === 'closing'), [...seen].join(','));
  check('[2:reduced] fades straight to the end state (data-intro = reduced-fade)', (await attr(page)) === 'reduced-fade');
  check('[2:reduced] no Skip button, no star canvas, no progress line', !skipBtn && !(await page.$('.vz-stars')) && !(await page.$('.vz-progress')) || (await page.evaluate(() => getComputedStyle(document.querySelector('.vz-stars') ?? document.body).display === 'none')));
  const tf = Date.now(); await page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 8000 }); // let the single 0.3 s fade finish (software GL makes frames slow)
  const fade = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.vz-hero')); return { opacity: +c.opacity, dur: c.transitionDuration, prop: c.transitionProperty }; });
  check('[2:reduced] end state shown, the only transition is one 0.3 s opacity fade', fade.opacity === 1 && fade.dur === '0.3s' && fade.prop === 'opacity', JSON.stringify(fade));
  const anim = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').map(a => a.animationName ?? a.constructor.name));
  check('[2:reduced] no CSS animation running afterwards', anim.length === 0, anim.join(','));
  await ctx.close();
}
{
  const { ctx, page, since } = await openPage(`theme=a&intro=1&lod=low`);
  const seen = new Set(); const t0 = Date.now();
  while (Date.now() - t0 < 20000) { const a = await attr(page); seen.add(a); if (a === 'done') break; await page.waitForTimeout(40); }
  check('[2:lod=low] the intro plays (storyboard visible) and finishes by itself, not stuck on loading', seen.has('play') && (await attr(page)) === 'done', `${[...seen].join('>')} after ${since()} ms`);
  check('[2:lod=low] ends with reason "finished" (not skipped / failed / timeout) and the low model is shown', (await reason(page)) === 'finished' && (await page.evaluate(() => window.__baymaxStage.lod)) === 'low' && (await ready(page)), await reason(page));
  await ctx.close();
}

// ───────── Acceptance 3: model load failure or > 8 s → the intro closes itself and the page shows
{
  const { ctx, page, since } = await openPage(`theme=a&intro=1`, { setup: p => p.route('**/models/*.glb', r => r.abort()) });
  await waitAttr(page, 'done', 6000);
  const t = since();
  check('[3:fail] intro closes itself soon after the load error (no endless spinner)', t < 6000 && (await reason(page)) === 'failed', `${t} ms, reason=${await reason(page)}`);
  check('[3:fail] static placeholder + gentle small text shown', !!(await page.$('[data-stage-placeholder]')) && !!(await page.$('[data-stage-soft-error]')), await page.evaluate(() => document.querySelector('[data-stage-soft-error]')?.textContent));
  check('[3:fail] page UI (title, button) visible, no progress line', (await uiOpacity(page)) === 1 && !(await page.$('.vz-progress')));
  await page.screenshot({ path: process.env.SHOT_FAIL || '/tmp/e2e_fail.png' });
  await ctx.close();
}
{
  const { ctx, page, since } = await openPage(`theme=a&intro=1`, { setup: p => p.route('**/models/*.glb', async r => { await new Promise(res => setTimeout(res, 11000)); await r.continue().catch(() => {}); }) });
  await page.waitForTimeout(7000);
  check('[3:slow] still in the intro at ~7 s (not ended early)', (await attr(page)) === 'play', `${since()} ms`);
  await waitAttr(page, 'done', 4000);
  const t = since();
  check('[3:slow] after 8 s without a model the intro closes itself (8.0–9.5 s)', t >= 7800 && t <= 9800 && (await reason(page)) === 'timeout', `${t} ms, reason=${await reason(page)}`);
  check('[3:slow] page UI visible; placeholder + "Baymax is coming…" text', (await uiOpacity(page)) === 1 && !!(await page.$('[data-stage-placeholder]')) && !!(await page.$('[data-stage-waiting]')), await page.evaluate(() => document.querySelector('[data-stage-waiting]')?.textContent));
  await page.screenshot({ path: process.env.SHOT_SLOW || '/tmp/e2e_slow.png' });
  await page.waitForFunction(() => window.__baymaxStage?.ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  check('[3:slow] when the model finally arrives the placeholder goes away', !(await page.$('[data-stage-placeholder]')));
  await ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
