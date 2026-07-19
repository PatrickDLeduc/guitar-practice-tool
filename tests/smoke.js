// Smoke test: drives the real app in headless Chrome. Run from repo root:
//   npm i --no-save playwright-core && python -m http.server 8741 & node tests/smoke.js
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8741/index.html';

let failed = 0;
const assert = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) failed = 1; };

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const errs = [];
  const newPage = async vp => {
    const ctx = await browser.newContext({ viewport: vp });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push('console: ' + m.text()); });
    await p.goto(URL); await p.waitForTimeout(1200);
    return p;
  };

  // ---------- desktop ----------
  let p = await newPage({ width: 1280, height: 900 });
  assert('desktop: notation rendered', (await p.locator('.keyblock').count()) > 0);
  assert('desktop: controls visible, no customize button', await p.locator('#exControls').isVisible() && !(await p.locator('#custBtn').isVisible()));
  assert('desktop: top tab bar with long labels', await p.locator('.tl').first().isVisible());

  // a11y: every button and form control has an accessible name
  const unnamed = await p.evaluate(() => {
    const name = el => (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title');
    const bad = [];
    document.querySelectorAll('button, [role="button"]').forEach(el => { if (!name(el)) bad.push('button#' + (el.id || el.className)); });
    document.querySelectorAll('select, input').forEach(el => {
      if (!el.getAttribute('aria-label') && !el.labels?.length && !el.getAttribute('placeholder')) bad.push(el.tagName + '#' + (el.id || el.className));
    });
    return bad;
  });
  assert('a11y: all controls named' + (unnamed.length ? ' — missing: ' + unnamed.slice(0, 6).join(', ') : ''), unnamed.length === 0);

  // audio: Karplus-Strong buffer is sane at bass and treble pitches
  const ks = await p.evaluate(() => {
    const c = new AudioContext();
    return [41.2, 82.4, 440].map(f => {
      const b = pluckBuffer(c, f, 1.5), d = b.getChannelData(0);
      let peak = 0, headRms = 0, tailRms = 0;
      const n = d.length, h = Math.floor(n / 10);
      for (let i = 0; i < n; i++) { if (Number.isNaN(d[i])) return { f, nan: true }; peak = Math.max(peak, Math.abs(d[i])); }
      for (let i = 0; i < h; i++) headRms += d[i] * d[i];
      for (let i = n - h; i < n; i++) tailRms += d[i] * d[i];
      return { f, peak, decays: tailRms < headRms * 0.05 };
    });
  });
  ks.forEach(r => assert(`audio: pluck ${r.f}Hz clean (peak ${r.peak?.toFixed(2)}) and decays`, !r.nan && r.peak <= 1.01 && r.decays));

  // follow-along highlight: appears after count-in, advances, clears on stop
  await p.click('.keyblock .pbtn');
  await p.waitForTimeout(4400);
  const i1 = await p.evaluate(() => [...document.querySelectorAll('.keyblock .nn')].findIndex(e => e.classList.contains('hl')));
  assert('playback: highlight active (idx ' + i1 + ')', i1 >= 0);
  await p.waitForTimeout(1600);
  const i2 = await p.evaluate(() => [...document.querySelectorAll('.keyblock .nn')].findIndex(e => e.classList.contains('hl')));
  assert('playback: highlight advances', i2 > i1);
  await p.click('.keyblock .pbtn');
  await p.waitForTimeout(300);
  assert('playback: stop clears highlight', (await p.locator('.hl').count()) === 0);

  // progressions: all dice templates parse in all keys, dice renders, jam runs
  const badProg = await p.evaluate(() => {
    const tpls = ['ii-V-I', 'minor ii-V-i', 'blues', 'I vi ii V', 'I IV V', 'vi IV I V', 'iii vi ii V', 'I vi IV V'];
    const bad = [];
    for (const t of tpls) for (const k of FLAT_NAMES) {
      try { if (!parseProgression(`${t} in ${k}`).chords.length) bad.push(`${t} in ${k}`); }
      catch (e) { bad.push(`${t} in ${k} THREW`); }
    }
    return bad;
  });
  assert('prog: 96/96 dice combos parse', badProg.length === 0);
  await p.click('.tabbtn[data-tab="prog"]');
  await p.click('#progChips .dicechip');
  await p.waitForTimeout(200);
  assert('prog: dice renders', ((await p.locator('#progName').innerText()) || '').length > 0);
  await p.click('#jamBtn'); await p.waitForTimeout(700);
  assert('prog: jam starts', (await p.locator('#jamBtn').innerText()).includes('■'));
  await p.click('#jamBtn');

  // voicings: dice keeps string set consistent with type; grips keyboard-accessible
  await p.click('.tabbtn[data-tab="voic"]');
  for (let i = 0; i < 4; i++) {
    await p.click('#vDice'); await p.waitForTimeout(120);
    const ok = await p.evaluate(() => $('vSet').dataset.type === $('vType').value && document.querySelectorAll('#voicOut .vgrip').length > 0);
    assert('voic: dice roll ' + i + ' valid', ok);
  }
  assert('voic: grips keyboard-focusable', await p.evaluate(() =>
    [...document.querySelectorAll('.vgrip')].every(el => el.tabIndex === 0 && el.getAttribute('role') === 'button')));
  await p.context().close();

  // ---------- mobile ----------
  p = await newPage({ width: 390, height: 844 });
  const tb = await p.locator('.tabbar').boundingBox();
  assert('mobile: tab bar docked at bottom', tb && Math.abs(tb.y + tb.height - 844) < 2);
  assert('mobile: icons + short labels', (await p.locator('.ticon').first().isVisible()) && (await p.locator('.ts').first().isVisible()));
  const met = await p.locator('#metro').boundingBox();
  assert('mobile: metronome above tab bar', met && met.y + met.height <= tb.y + 2);
  await p.click('#custBtn');
  assert('mobile: customize sheet opens', await p.locator('#exControls').isVisible());
  await p.click('#custDone');
  await p.waitForTimeout(300);
  assert('mobile: Done closes sheet', !(await p.locator('#exControls').isVisible()));
  await p.click('#diceChip');
  await p.waitForTimeout(200);
  assert('mobile: exercise dice works', (await p.locator('.keyblock').count()) > 0);
  await p.context().close();

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
  if (errs.length) failed = 1;
  await browser.close();
  process.exit(failed);
})();
