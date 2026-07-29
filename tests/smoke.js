// Smoke test: drives the real app in headless Chrome. Run from repo root:
//   npm i --no-save playwright-core && python -m http.server 8741 & node tests/smoke.js
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8741/index.html';

let failed = 0;
const assert = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) failed = 1; };

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required',
           '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
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

  // tuner: YIN pitch detection on synthetic strings, then the modal against the fake mic
  const pitches = await p.evaluate(() => [82.41, 110, 329.63].map(f => {
    const sr = 44100, buf = new Float32Array(4096);
    for (let i = 0; i < buf.length; i++)
      buf[i] = 0.6 * Math.sin(2 * Math.PI * f * i / sr) + 0.2 * Math.sin(4 * Math.PI * f * i / sr);
    return { f, got: detectPitch(buf, sr) };
  }));
  pitches.forEach(r => assert(
    `tuner: detects ${r.f}Hz (got ${r.got.toFixed(2)})`,
    Math.abs(1200 * Math.log2(r.got / r.f)) < 5));   // within 5 cents
  // phone-mic failure mode: weak fundamental under strong harmonics must NOT read an octave up
  const oct = await p.evaluate(() => {
    const sr = 44100, f = 82.41, buf = new Float32Array(4096);
    for (let i = 0; i < buf.length; i++)
      buf[i] = 0.2 * Math.sin(2 * Math.PI * f * i / sr)
             + 0.6 * Math.sin(4 * Math.PI * f * i / sr)
             + 0.35 * Math.sin(6 * Math.PI * f * i / sr);
    return detectPitch(buf, sr);
  });
  assert('tuner: harmonic-heavy E2 stays E2, not E3 (got ' + oct.toFixed(2) + ')',
    Math.abs(1200 * Math.log2(oct / 82.41)) < 20);
  assert('tuner: silence gated', await p.evaluate(() => detectPitch(new Float32Array(4096), 44100) === -1));
  await p.click('#tunBtn');
  await p.waitForTimeout(800);
  assert('tuner: modal opens on mic grant', await p.locator('#tunWrap').isVisible());
  await p.click('#tunClose');
  assert('tuner: close stops and hides', !(await p.locator('#tunWrap').isVisible()) && await p.evaluate(() => tuner === null));

  // meter sequences: parser, UI wiring, live bar rotation
  const ms = await p.evaluate(() => {
    const a = parseMeterSeq('3x5/8 + 7/8');
    const b = parseMeterSeq('7/8(2+2+3)');
    const c = parseMeterSeq('4/4 + 6/8');
    return {
      aLens: a && a.map(x => x.acc.length), aLabel: a && a[3].label,
      bAcc: b && b[0].acc.join(''),
      cLens: c && c.map(x => x.acc.length),
      badSum: parseMeterSeq('7/8(3+3)'), badNoise: parseMeterSeq('hello'),
    };
  });
  assert('meter: 3x5/8+7/8 → [5,5,5,7]', JSON.stringify(ms.aLens) === '[5,5,5,7]' && ms.aLabel === '7/8');
  assert('meter: 7/8(2+2+3) accents 2010100', ms.bAcc === '2010100');
  assert('meter: mixed denominators parse', JSON.stringify(ms.cLens) === '[4,6]');
  assert('meter: wrong group sum and garbage rejected', ms.badSum === null && ms.badNoise === null);

  await p.click('.tabbtn[data-tab="ex"]');
  await p.selectOption('#mBeats', 'custom');
  await p.fill('#mCustom', '5/8+7/8');
  await p.dispatchEvent('#mCustom', 'change');
  const seqState = await p.evaluate(() => ({
    bars: metro.bars && metro.bars.length, ticks: barSeqTicks(),
    summary: $('summary').textContent,
  }));
  assert('meter: custom seq applied (bars=' + seqState.bars + ', ticks=' + JSON.stringify(seqState.ticks) + ')',
    seqState.bars === 2 && JSON.stringify(seqState.ticks) === '[5,7]');
  assert('meter: summary shows custom meter', seqState.summary.includes('5/8+7/8'));
  await p.evaluate(() => { setBpm(240); metroStart(); });
  await p.waitForTimeout(2200);   // bar of 5 at 240bpm = 1.25s → should be in bar 2
  const barIdx = await p.evaluate(() => { const i = metro.barIdx; metroStop(); setBpm(80); return i; });
  assert('meter: metronome rotates bars (barIdx=' + barIdx + ')', barIdx >= 1);
  await p.selectOption('#mBeats', '4/4');

  // swing: toggle + swung playback highlight still tracks
  await p.click('#mSwing');
  assert('swing: toggle turns on', (await p.locator('#mSwing').innerText()).includes('ON'));
  await p.selectOption('#selNV', 'eighth');
  await p.waitForTimeout(300);
  await p.click('.keyblock .pbtn');
  await p.waitForTimeout(4200);
  const swIdx = await p.evaluate(() => [...document.querySelectorAll('.keyblock .nn')].findIndex(e => e.classList.contains('hl')));
  assert('swing: highlight tracks swung 8ths (idx ' + swIdx + ')', swIdx >= 0);
  await p.click('.keyblock .pbtn');
  await p.click('#mSwing');
  await p.selectOption('#selNV', 'quarter');
  await p.waitForTimeout(300);

  // favorites: save, apply, delete, persist across reload
  await p.click('#favBtn');
  assert('fav: chip appears after save', (await p.locator('#favChips .chip').count()) === 1);
  const savedQual = await p.evaluate(() => selQual.value);
  await p.click('#diceChip'); await p.waitForTimeout(150);
  await p.click('#favBtn');
  assert('fav: second save', (await p.locator('#favChips .chip').count()) === 2);
  await p.locator('#favChips .chip').last().click();   // last = oldest (first saved)
  await p.waitForTimeout(150);
  assert('fav: clicking chip restores exercise', (await p.evaluate(() => selQual.value)) === savedQual);
  await p.reload(); await p.waitForTimeout(1200);
  assert('fav: chips persist after reload', (await p.locator('#favChips .chip').count()) === 2);
  await p.locator('#favChips .fx').first().click();
  assert('fav: delete removes chip', (await p.locator('#favChips .chip').count()) === 1);

  // fingering: 2-string exercise cycles all 5 adjacent string pairs, notes stay on the pair
  await p.selectOption('#selSeq', 'single');   // isolate from leftover random-dice state (cycle4/etc.)
  await p.selectOption('#selFing', '2str');
  await p.waitForTimeout(150);
  const twoStr = await p.evaluate(() => {
    const blocks = [...document.querySelectorAll('#out .keyblock .keyname')].map(e => e.textContent);
    const ex = buildKeyExercise(+selRoot.value, selQual.value, 'straight', 'asc', +selOct.value, null, null, '2str', 'none', 5, 2, 'none');
    return { blockCount: blocks.length, allOnPair: ex.groups.flat().every(n => n.s === 2 || n.s === 3), sample: blocks[0] };
  });
  assert('2str: cycles all 5 string pairs into separate blocks (got ' + twoStr.blockCount + ')', twoStr.blockCount === 5);
  assert('2str: every note stays on the chosen string pair', twoStr.allOnPair);
  assert('2str: block name shows the string-pair label (' + twoStr.sample + ')', /strings/.test(twoStr.sample));

  // fingering: position-shift connector cycles all 5 CAGED shape pairs (wrapping the
  // last shape into the first, an octave up, so the cycle is continuous), ascends smoothly
  await p.selectOption('#selFing', 'shift');
  await p.waitForTimeout(150);
  const shift = await p.evaluate(() => {
    const blocks = [...document.querySelectorAll('#out .keyblock .keyname')].map(e => e.textContent);
    const ex = buildKeyExercise(+selRoot.value, selQual.value, 'straight', 'asc', +selOct.value, null, null, 'shift', 'none', 5, 1, 'none');
    const pitches = ex.groups.flat().map(n => STRINGS[n.s] + n.f);
    const wrapEx = buildKeyExercise(+selRoot.value, selQual.value, 'straight', 'asc', +selOct.value, null, null, 'shift', 'none', 5, 4, 'none');
    const wrapPitches = wrapEx.groups.flat().map(n => STRINGS[n.s] + n.f);
    return {
      blockCount: blocks.length,
      ascending: pitches.every((v,i) => i===0 || v >= pitches[i-1]),
      sample: blocks[0],
      wrapAscending: wrapPitches.every((v,i) => i===0 || v >= wrapPitches[i-1]),
      wrapHasNotes: wrapPitches.length > 0,
    };
  });
  assert('shift: cycles all 5 CAGED shape pairs, wrapping continuously (got ' + shift.blockCount + ')', shift.blockCount === 5);
  assert('shift: notes ascend smoothly across the position shift', shift.ascending);
  assert('shift: block name shows the shift label (' + shift.sample + ')', /shift/.test(shift.sample));
  assert('shift: wrap-around pair (last shape -> first shape, up an octave) produces notes', shift.wrapHasNotes);
  assert('shift: wrap-around pair still ascends smoothly', shift.wrapAscending);
  await p.selectOption('#selFing', 'pos');
  await p.waitForTimeout(150);

  // jam styles: every style schedules without errors
  await p.click('.tabbtn[data-tab="prog"]');
  await p.click('#progChips .dicechip');
  await p.waitForTimeout(200);
  for (const style of ['rock', 'swing', 'shuffle', 'bossa', 'funk']) {
    await p.selectOption('#jamStyle', style);
    await p.click('#jamBtn');
    await p.waitForTimeout(500);
    const on = (await p.locator('#jamBtn').innerText()).includes('■');
    await p.click('#jamBtn');
    assert('jam style ' + style + ' runs', on);
  }
  await p.click('.tabbtn[data-tab="ex"]');

  // voicings: dice keeps string set consistent with type; grips keyboard-accessible
  await p.click('.tabbtn[data-tab="voic"]');
  for (let i = 0; i < 4; i++) {
    await p.click('#vDice'); await p.waitForTimeout(120);
    const ok = await p.evaluate(() => $('vSet').dataset.type === $('vType').value && document.querySelectorAll('#voicOut .vgrip').length > 0);
    assert('voic: dice roll ' + i + ' valid', ok);
  }
  assert('voic: grips keyboard-focusable', await p.evaluate(() =>
    [...document.querySelectorAll('.vgrip')].every(el => el.tabIndex === 0 && el.getAttribute('role') === 'button')));

  // voic: sus2/sus4/7sus4 are selectable and render a grip for every applicable voicing type
  for (const q of ['sus2', 'sus4', '7sus4']) {
    await p.selectOption('#vQual', q);
    await p.waitForTimeout(150);
    const typeOpts = await p.evaluate(() => [...document.querySelectorAll('#vType option')].map(o => o.value));
    for (const t of typeOpts) {
      await p.selectOption('#vType', t);
      await p.waitForTimeout(150);
      const grips = await p.evaluate(() => document.querySelectorAll('#voicOut .vgrip').length);
      assert(`voic: ${q} (${t}) renders a grip (got ${grips})`, grips > 0);
    }
  }

  // polyrhythm math: pure functions, no UI needed
  const pm = await p.evaluate(() => ({
    gcd1: gcdOf(12, 18), gcd2: gcdOf(7, 5),
    lcm1: lcmOf(3, 4), lcm2: lcmOf(4, 6),
    simp: simplifyRatio(4, 6),
    pulses34: polyPulses(3, 4),
    times34: polyPulseTimes(3, 4, 1200),
    pattern34: polyPattern(3, 4),
    pulses46: polyPulses(4, 6),
    events34: polyEvents(3, 4, 1200, 0).map(e => ({ t: Math.round(e.tMs), a: e.isA, b: e.isB })),
    events34Hits: polyEvents(3, 4, 1200, 0).filter(e => e.isA || e.isB).length,
  }));
  assert('poly: gcd(12,18)=6, gcd(7,5)=1', pm.gcd1 === 6 && pm.gcd2 === 1);
  assert('poly: lcm(3,4)=12, lcm(4,6)=12', pm.lcm1 === 12 && pm.lcm2 === 12);
  assert('poly: simplifyRatio(4,6)={2,3}', pm.simp.a === 2 && pm.simp.b === 3);
  assert('poly: 3:4 pulses at [0,4,8]/[0,3,6,9], lcm 12',
    JSON.stringify(pm.pulses34.a) === '[0,4,8]' && JSON.stringify(pm.pulses34.b) === '[0,3,6,9]' && pm.pulses34.lcm === 12);
  assert('poly: 3:4 pulse times at 1200ms cycle',
    JSON.stringify(pm.times34.a) === '[0,400,800]' && JSON.stringify(pm.times34.b) === '[0,300,600,900]' && JSON.stringify(pm.times34.shared) === '[0]');
  assert('poly: 3:4 pattern matches spec example',
    pm.pattern34.lineA === 'X . . . X . . . X . . .' &&
    pm.pattern34.lineB === 'X . . X . . X . . X . .' &&
    pm.pattern34.lineC === '◎ . . B A . B . A B . .');
  assert('poly: 4:6 reduces to same pulse count as 2:3 (12 subdivisions, 4 A-pulses)',
    pm.pulses46.lcm === 12 && pm.pulses46.a.length === 4 && pm.pulses46.b.length === 6);
  assert('poly: 3:4 event list covers all 12 grid subdivisions, starts with a shared strike at t=0, 6 are actual A/B hits',
    pm.events34.length === 12 && pm.events34[0].t === 0 && pm.events34[0].a && pm.events34[0].b && pm.events34Hits === 6);

  await p.click('.tabbtn[data-tab="poly"]');
  assert('poly: tab switches panel visible', await p.locator('#viewPoly').isVisible());
  assert('poly: BPM refers to defaults to Rhythm A pulse', await p.evaluate(() => poly.bpmRef) === 'a' && await p.inputValue('#polyBpmRef') === 'a');

  await p.click('#polyPresets .chip[data-a="5"][data-b="7"]');
  const r1 = await p.evaluate(() => ({ a: poly.a, b: poly.b, aVal: +$('polyA').value, bVal: +$('polyB').value }));
  assert('poly: preset 5:7 sets ratio and inputs', r1.a === 5 && r1.b === 7 && r1.aVal === 5 && r1.bVal === 7);
  await p.click('#polySwap');
  const r2 = await p.evaluate(() => ({ a: poly.a, b: poly.b }));
  assert('poly: swap flips ratio', r2.a === 7 && r2.b === 5);
  await p.fill('#polyA', '99');
  await p.dispatchEvent('#polyA', 'change');
  const r3 = await p.evaluate(() => poly.a);
  assert('poly: ratio input clamps to max 16', r3 === 16);
  const analysis = await p.evaluate(() => $('polyPatternText').textContent);
  assert('poly: analysis panel shows LCM and pattern text', analysis.includes('LCM') && analysis.includes('X'));

  await p.click('#polyPlay');
  await p.waitForTimeout(300);
  const s1 = await p.evaluate(() => ({ playing: poly.playing, hasTimer: poly.timer !== null }));
  assert('poly: play starts scheduler', s1.playing && s1.hasTimer);
  const timersAfterTempoChange = await p.evaluate(() => {
    const before = poly.timer;
    polySetTempo(140);
    return { same: poly.timer === before, bpm: poly.bpm };
  });
  assert('poly: tempo change does not create a second scheduler', timersAfterTempoChange.same && timersAfterTempoChange.bpm === 140);
  await p.click('#polyStop');
  const s2 = await p.evaluate(() => ({ playing: poly.playing, hasTimer: poly.timer === null, cycle: poly.cycleCount }));
  assert('poly: stop clears scheduler and resets cycle', !s2.playing && s2.hasTimer && s2.cycle === 0);
  // starting poly stops the main metronome
  await p.click('.tabbtn[data-tab="ex"]');
  await p.click('#mPlay');
  await p.waitForTimeout(200);
  await p.click('.tabbtn[data-tab="poly"]');
  await p.click('#polyPlay');
  await p.waitForTimeout(200);
  const mutex = await p.evaluate(() => ({ metro: metro.playing, poly: poly.playing }));
  assert('poly: starting poly playback stops the main metronome', !mutex.metro && mutex.poly);
  await p.click('#polyStop');

  // mirror: starting the main metronome (via its always-visible #mPlay button, reachable
  // from the poly tab too) must pause poly playback rather than run both schedulers at once
  await p.click('#polyPlay');
  await p.waitForTimeout(200);
  await p.click('#mPlay');
  await p.waitForTimeout(200);
  const mutex2 = await p.evaluate(() => ({ metro: metro.playing, poly: poly.playing }));
  assert('poly: starting the main metronome stops poly playback', mutex2.metro && !mutex2.poly);
  await p.click('#mPlay');
  await p.click('#polyStop');

  await p.click('.tabbtn[data-tab="poly"]');
  await p.click('#polyPlay');
  await p.waitForTimeout(200);
  await p.click('.tabbtn[data-tab="ex"]');
  const stopped = await p.evaluate(() => ({ playing: poly.playing, timer: poly.timer }));
  assert('poly: switching tabs away stops playback and clears the scheduler', !stopped.playing && stopped.timer === null);

  await p.click('.tabbtn[data-tab="poly"]');
  await p.click('#polyMuteA');
  const m1 = await p.evaluate(() => poly.muteA);
  assert('poly: mute A toggles state', m1 === true);
  await p.click('#polyMuteA');
  await p.click('#polySoloB');
  const m2 = await p.evaluate(() => poly.soloB);
  assert('poly: solo B toggles state', m2 === true);
  await p.click('#polySoloB');
  await p.click('#polyAudioOn');
  const a1 = await p.evaluate(() => poly.audioOn);
  assert('poly: audio toggle turns off', a1 === false);
  await p.click('#polyAudioOn');

  const subClickTest = await p.evaluate(() => {
    let oscCount = 0;
    const fakeCtx = {
      createOscillator: () => { oscCount++; return { type: '', frequency: { value: 0 }, connect(){}, start(){}, stop(){} }; },
      createGain: () => ({ gain: { setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} }),
      currentTime: 0
    };
    const saved = { ctx: poly.ctx, muteA: poly.muteA, subClick: poly.subClick, audioOn: poly.audioOn };
    poly.ctx = fakeCtx; poly.muteA = true; poly.subClick = true; poly.audioOn = true;
    polyClick(0, { isA: true, isB: false, grid: true });
    const mutedCount = oscCount;
    poly.muteA = false;
    polyClick(0, { isA: false, isB: false, grid: true });
    const emptyGridCount = oscCount;
    Object.assign(poly, saved);
    return { mutedCount, emptyGridCount };
  });
  assert('poly: muted A hit does not trigger subdivision click', subClickTest.mutedCount === 0);
  assert('poly: empty grid position triggers subdivision click when enabled', subClickTest.emptyGridCount === 1);

  const delayTest = await p.evaluate(() => {
    let oscCount = 0;
    const fakeCtx = {
      createOscillator: () => { oscCount++; return { type: '', frequency: { value: 0 }, connect(){}, start(){}, stop(){} }; },
      createGain: () => ({ gain: { setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} }),
      currentTime: 0
    };
    const saved = { ctx: poly.ctx, delayCycles: poly.delayCycles, cycleCount: poly.cycleCount, audioOn: poly.audioOn };
    poly.ctx = fakeCtx; poly.audioOn = true; poly.delayCycles = 2;
    poly.cycleCount = 0;
    polyClick(0, { isA: false, isB: true }); // pure B hit, cycle 0 of 2 — should be gated silent
    const beforeEntry = oscCount;
    polyClick(0, { isA: true, isB: true }); // shared A+B hit during delay — A component still plays
    const sharedDuringDelay = oscCount;
    poly.cycleCount = 2;
    polyClick(0, { isA: false, isB: true }); // cycle 2 reached — Rhythm B has "entered"
    const afterEntry = oscCount;
    Object.assign(poly, saved);
    return { beforeEntry, sharedDuringDelay, afterEntry };
  });
  assert('poly: pure Rhythm B hit is silent before delayCycles elapses', delayTest.beforeEntry === 0);
  assert('poly: shared A+B hit still plays during the delay window', delayTest.sharedDuringDelay === 1);
  assert('poly: pure Rhythm B hit plays once delayCycles has elapsed', delayTest.afterEntry === 2);

  await p.click('.tabbtn[data-tab="poly"]');
  const dots = await p.evaluate(() => document.querySelectorAll('#polyCircSvg .polydot').length + document.querySelectorAll('#polyLinSvg .polydot').length);
  assert('poly: visualization renders pulse dots for both views', dots > 0);
  const linScroll = await p.evaluate(() => {
    polySetRatio(15, 16);
    const svg = $('polyLinSvg'), wrap = svg.parentElement;
    return { svgWidth: svg.getBoundingClientRect().width, scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth };
  });
  assert(`poly: linear grid overflows wrapper at 15:16 (svg ${linScroll.svgWidth}px, scroll ${linScroll.scrollWidth} > client ${linScroll.clientWidth})`,
    linScroll.svgWidth > 1000 && linScroll.scrollWidth > linScroll.clientWidth);
  await p.evaluate(() => polySetRatio(5, 7));
  await p.click('#polyPlay');
  await p.waitForTimeout(200);
  const angle1 = await p.evaluate(() => $('polyPlayheadCirc').getAttribute('transform'));
  await p.waitForTimeout(300);
  const angle2 = await p.evaluate(() => $('polyPlayheadCirc').getAttribute('transform'));
  assert('poly: circular playhead rotates during playback', angle1 !== angle2);
  await p.click('#polyStop');

  await p.click('#polyEventTableToggle');
  const rows = await p.evaluate(() => document.querySelectorAll('#polyEventTable tbody tr').length);
  assert('poly: event table shows one row per shared subdivision event', rows > 0);
  const headerText = await p.evaluate(() => $('polyEventTable').textContent);
  assert('poly: event table has expected columns', headerText.includes('%') && headerText.includes('Shared'));

  // practice modes: random challenge bounds, alternating focus cadence, progressive tempo cap
  const rc = await p.evaluate(() => {
    const results = [];
    for(let i = 0; i < 50; i++){
      const ch = generateRandomChallenge({ min: 3, max: 8, maxLcm: 20, minBpm: 60, maxBpm: 90, allowReducible: false });
      results.push({ ...ch, lcm: lcmOf(ch.a, ch.b), gcd: gcdOf(ch.a, ch.b) });
    }
    return results;
  });
  assert('poly: random challenge stays within min/max/maxLcm/tempo bounds',
    rc.every(r => r.a >= 3 && r.a <= 8 && r.b >= 3 && r.b <= 8 && r.lcm <= 20 && r.bpm >= 60 && r.bpm <= 90 && r.gcd === 1));

  await p.evaluate(() => { poly.mode = 'alternate'; poly.modeCycles = 2; practiceModeReset(); });
  const alt = await p.evaluate(() => {
    const phases = [poly.modeState.phase];
    for(let i = 1; i <= 5; i++){ practiceModeOnCycle(i); phases.push(poly.modeState.phase); }
    return phases;
  });
  assert('poly: alternating focus cycles a -> b -> both -> a on the configured cadence',
    JSON.stringify(alt) === JSON.stringify(['a','a','b','b','both','both']));

  await p.evaluate(() => { poly.mode = 'progressive'; poly.modeCycles = 1; poly.modeCfg = { step: 10, maxBpm: 100 }; poly.bpm = 90; practiceModeReset(); });
  await p.evaluate(() => { practiceModeOnCycle(1); practiceModeOnCycle(2); practiceModeOnCycle(3); });
  const bpmAfter = await p.evaluate(() => poly.bpm);
  assert('poly: progressive tempo stops increasing at configured max', bpmAfter === 100);
  await p.evaluate(() => { poly.mode = 'none'; });

  // phase offset, delayed entry, keyboard shortcuts, reset-to-default
  await p.click('.tabbtn[data-tab="poly"]');
  await p.click('.chip[data-a="3"][data-b="4"]');
  await p.evaluate(() => polySetTempo(90));
  await p.fill('#polyPhasePct', '25');
  await p.dispatchEvent('#polyPhasePct', 'change');
  const synced = await p.evaluate(() => ({ deg: +$('polyPhaseDeg').value, sub: +$('polyPhaseSub').value }));
  assert('poly: phase offset syncs degrees/subdivisions from %', Math.abs(synced.deg - 90) < 1 && Math.abs(synced.sub - 3) < 0.01);

  // typing space/r inside a number field must NOT trigger shortcuts (focus still in #polyPhasePct here)
  await p.keyboard.press('Space');
  await p.waitForTimeout(150);
  const playingWhileFocused = await p.evaluate(() => poly.playing);
  assert('poly: spacebar in a text field does not trigger play', playingWhileFocused === false);

  await p.evaluate(() => document.activeElement.blur());
  await p.keyboard.press('Space');
  await p.waitForTimeout(150);
  const playing1 = await p.evaluate(() => poly.playing);
  assert('poly: spacebar toggles play when Poly tab is active', playing1 === true);
  await p.keyboard.press('Space');

  await p.click('#polyReset');
  const reset = await p.evaluate(() => ({ a: poly.a, b: poly.b, bpm: poly.bpm, phase: poly.phaseMsB }));
  assert('poly: reset restores defaults', reset.a === 3 && reset.b === 4 && reset.bpm === 90 && reset.phase === 0);

  // persistence: ratio and tempo survive a reload via localStorage
  await p.click('.tabbtn[data-tab="poly"]');
  await p.click('.chip[data-a="4"][data-b="5"]');
  await p.evaluate(() => polySetTempo(120));
  await p.fill('#polyPhasePct', '25');
  await p.dispatchEvent('#polyPhasePct', 'change');
  await p.selectOption('#polyMode', 'isolation');
  await p.dispatchEvent('#polyMode', 'change');
  await p.click('#polyMuteA');
  await p.reload();
  await p.waitForTimeout(1200);
  await p.click('.tabbtn[data-tab="poly"]');
  const persisted = await p.evaluate(() => ({ a: poly.a, b: poly.b, bpm: poly.bpm }));
  assert('poly: ratio and tempo persist across reload', persisted.a === 4 && persisted.b === 5 && persisted.bpm === 120);

  // regression: restoring a saved non-default mode via polyLoadPrefs must not wipe
  // restored mute state (previously the mode-change listener's dispatch triggered
  // practiceModeReset(), silently clearing poly.muteA/muteB right after they were restored)
  const muteAfterReload = await p.evaluate(() => ({
    muteA: poly.muteA, muteAButtonOn: $('polyMuteA').textContent.includes('ON'),
  }));
  assert('poly: muteA persists across reload with restored mode', muteAfterReload.muteA === true);
  assert('poly: mute A button still shows ON after reload', muteAfterReload.muteAButtonOn === true);

  // persistence: phase offset inputs re-sync from saved poly.phaseMsB after reload
  const phaseAfterReload = await p.evaluate(() => ({
    phaseMsB: poly.phaseMsB, pct: +$('polyPhasePct').value, deg: +$('polyPhaseDeg').value, sub: +$('polyPhaseSub').value,
  }));
  assert('poly: phase offset % input re-syncs after reload', Math.abs(phaseAfterReload.pct - 25) < 1);
  assert('poly: phase offset degrees/subdivisions re-sync after reload',
    Math.abs(phaseAfterReload.deg - 90) < 1 && Math.abs(phaseAfterReload.sub - 5) < 0.01);

  // persistence: mode select and its sub-panel visibility re-sync after reload
  const modeAfterReload = await p.evaluate(() => ({
    mode: $('polyMode').value, isoWrapHidden: $('polyIsoSideWrap').style.display === 'none',
  }));
  assert('poly: mode select re-syncs to "isolation" after reload', modeAfterReload.mode === 'isolation');
  assert('poly: mode sub-panel (Fade out side) becomes visible after reload', !modeAfterReload.isoWrapHidden);

  // regression: a restored non-'none' practice mode must have poly.modeState initialized
  // before the first cycle boundary — previously modeState stayed {} after reload, and the
  // first practiceModeOnCycle() call crashed (undefined.toUpperCase() for 'alternate' mode
  // in polyRenderModeStatus, or NaN fed into exponentialRampToValueAtTime for 'isolation')
  await p.selectOption('#polyMode', 'alternate');
  await p.dispatchEvent('#polyMode', 'change');
  await p.evaluate(() => polySetTempo(280)); // fast cycle so a boundary passes quickly
  await p.reload();
  await p.waitForTimeout(1200);
  await p.click('.tabbtn[data-tab="poly"]');
  const alternateRestored = await p.evaluate(() => $('polyMode').value);
  assert('poly: alternate mode persists across reload', alternateRestored === 'alternate');
  const errsBeforeCycle = errs.length;
  await p.click('#polyPlay');
  await p.waitForTimeout(900); // several cycles at 280bpm — well past one boundary
  await p.click('#polyStop');
  assert('poly: restored alternate mode survives a cycle boundary without page errors', errs.length === errsBeforeCycle);

  // regression: applyPracticeMode() called from polyLoadPrefs must derive muteA/muteB from
  // the *restored* modeState.phase, not a hardcoded fresh phase='a' — previously it forced
  // phase back to 'a' on every reload, silently overwriting whatever mute state was actually
  // saved (defeating the "don't wipe restored mute/volume prefs" fix in the same commit).
  await p.evaluate(() => { poly.modeState.phase = 'b'; applyPracticeMode(); polySavePrefs(); });
  const altBeforeReload = await p.evaluate(() => ({ muteA: poly.muteA, muteB: poly.muteB }));
  await p.reload();
  await p.waitForTimeout(1200);
  await p.click('.tabbtn[data-tab="poly"]');
  const altAfterReload = await p.evaluate(() => ({ phase: poly.modeState.phase, muteA: poly.muteA, muteB: poly.muteB }));
  assert('poly: alternate mode phase persists across reload', altAfterReload.phase === 'b');
  assert('poly: alternate mode mute state matches the restored phase, not a reset-to-\'a\' phase',
    altAfterReload.muteA === altBeforeReload.muteA && altAfterReload.muteB === altBeforeReload.muteB);

  // regression: isolation mode's fade side and fade progress must survive a reload —
  // previously poly.modeCfg (isolateSide/maxBpm/step) was never persisted at all, and
  // applyPracticeMode() force-reset volA/volB to full volume on every reload.
  await p.evaluate(() => { $('polyMode').value = 'isolation'; $('polyMode').dispatchEvent(new Event('change')); });
  await p.selectOption('#polyIsoSide', 'a');
  await p.dispatchEvent('#polyIsoSide', 'change');
  await p.evaluate(() => { poly.modeState.cyclesInPhase = poly.modeCycles; applyPracticeMode(); polySavePrefs(); });
  const isoBeforeReload = await p.evaluate(() => poly.volA);
  await p.reload();
  await p.waitForTimeout(1200);
  await p.click('.tabbtn[data-tab="poly"]');
  const isoAfterReload = await p.evaluate(() => ({ isolateSide: poly.modeCfg.isolateSide, isoSideSelect: $('polyIsoSide').value, volA: poly.volA }));
  assert('poly: isolation fade side (Rhythm A) persists across reload', isoAfterReload.isolateSide === 'a' && isoAfterReload.isoSideSelect === 'a');
  assert('poly: isolation fade progress survives reload instead of snapping back to full volume',
    Math.abs(isoAfterReload.volA - isoBeforeReload) < 0.01);

  // regression: a *fresh* isolation mode (no saved isolateSide) must still default to fading
  // Rhythm B, matching pre-existing behavior — practiceModeReset() must not pre-commit the
  // #polyIsoSide dropdown's own default DOM value ('a') into modeCfg on mode entry.
  await p.evaluate(() => {
    $('polyMode').value = 'none'; $('polyMode').dispatchEvent(new Event('change'));
    poly.modeCfg = {};
    $('polyVolA').value = '0.8'; $('polyVolB').value = '0.8'; // practiceModeReset reads these DOM sliders
    $('polyMode').value = 'isolation'; $('polyMode').dispatchEvent(new Event('change'));
    poly.modeState.cyclesInPhase = poly.modeCycles; applyPracticeMode();
  });
  const freshIso = await p.evaluate(() => ({ volA: poly.volA, volB: poly.volB }));
  assert('poly: fresh isolation mode with no saved side defaults to fading Rhythm B', freshIso.volB < 0.1 && freshIso.volA === 0.8);

  await p.evaluate(() => { $('polyMode').value = 'none'; $('polyMode').dispatchEvent(new Event('change')); });
  await p.click('.tabbtn[data-tab="ex"]');

  // analytics: the beacon is prod-only (this test used to insert ~2 fake visitors per CI run into
  // the real events table), and the canned first-visit query must not be counted as a user query.
  const analytics = await p.evaluate(() => {
    const idle = window.__ev.length;    // on localhost the guard should have buffered nothing at all
    evOff = false;
    $('query').value = 'C major scale';
    $('go').click();                    // user path — onclick must not pass its MouseEvent as `demo`
    const user = window.__ev.find(e => e.name === 'nl_query');
    window.__ev.length = 0;
    runFromText(true);                  // first-visit demo path
    const demo = window.__ev.find(e => e.name === 'nl_query');
    window.__ev.length = 0; evOff = true;
    return { idle, user: user && user.props, demo: demo && demo.props };
  });
  assert('analytics: nothing buffered off guitarpractice.app (CI must not reach prod)', analytics.idle === 0);
  assert('analytics: a real Generate click is not flagged demo', !!analytics.user && analytics.user.demo === false);
  assert('analytics: the first-visit demo query is flagged demo', !!analytics.demo && analytics.demo.demo === true);

  // ---------- guitar regression guard ----------
  // Baseline captured from the pre-piano-support engine. Guitar note placement and tab
  // output must not shift when instrument-aware code paths change. If a deliberate
  // guitar change makes this fail, re-capture the baseline in the same commit.
  {
    const base = JSON.parse(require('fs').readFileSync(__dirname + '/guitar-baseline.json', 'utf8'));
    const cases = Object.keys(base).filter(k => k.startsWith('ex:')).map(k => k.slice(3).split('|'));
    const got = await p.evaluate((cases) => {
      const res = {};
      cases.forEach(c => {
        const [pc, qual, pat, dir, oct, fing, posFret, si] = c;
        const ex = buildKeyExercise(+pc, qual, pat, dir, +oct, null, null, fing, 'none', +posFret,
                                    si === '' ? null : +si, 'none');
        res['ex:' + c.join('|')] = {
          name: ex.name,
          sf: ex.groups.map(g => g.map(n => n.s + ',' + n.f).join(' ')),
          tab: renderTab(ex.groups).join('\n===\n'),
        };
      });
      const chords = parseProgression('ii-V-I in Bb').chords;
      res['prog:ii-V-I in Bb'] = {
        arps: progressionLine(chords, 8).map(g => g.map(n => n.s + ',' + n.f).join(' ')),
        guide: guideToneLine(chords).map(g => g.map(n => n.s + ',' + n.f).join(' ')),
      };
      return res;
    }, cases);
    const drift = Object.keys(base).filter(k => JSON.stringify(base[k]) !== JSON.stringify(got[k]));
    assert('guitar: engine output unchanged vs baseline' + (drift.length ? ' — drifted: ' + drift.join(', ') : ''),
           drift.length === 0);
  }

  // ---------- piano mode ----------
  {
    // octave convention pinned in both directions: guitar notation is written 8va, piano is not
    const sp = await p.evaluate(() => ({
      concert: spellWritten(60, false, false).dval,
      written: spellWritten(60, false, true).dval,
    }));
    assert('piano: middle C is dval 28 concert / 35 written (got ' + sp.concert + '/' + sp.written + ')',
      sp.concert === 28 && sp.written === 35);

    const pm = await p.evaluate(() => {
      const sel = document.getElementById('selInst');
      sel.value = 'piano'; sel.dispatchEvent(new Event('change'));
      document.getElementById('query').value = 'C major scale 2 octaves';
      runFromText();
      const svg = document.querySelector('#out .nsys svg');
      const staffLines = [...svg.querySelectorAll('line')]
        .filter(l => +l.getAttribute('x1') === 12 && +l.getAttribute('x2') > 100)
        .map(l => +l.getAttribute('y1')).sort((a, b) => a - b);
      const clefs = [...svg.querySelectorAll('text')]
        .map(t => t.textContent).filter(t => t.codePointAt(0) > 0x1D100);
      // Where each clef's ink actually lands, in staff coordinates. Rasterise the glyph and
      // scan it rather than trusting font metrics — the em box is not the ink.
      const inkEm = ch => {
        const R = 100, N = 3 * R, cv = document.createElement('canvas');
        cv.width = cv.height = N;
        const g = cv.getContext('2d');
        g.font = `${R}px Bravura`; g.fillStyle = '#fff';
        g.fillText(ch, R, 2 * R);                       // origin at (R, 2R)
        const px = g.getImageData(0, 0, N, N).data;
        let t = Infinity, b = -Infinity;
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (px[(y * N + x) * 4 + 3] > 20) {
          if (y < t) t = y; if (y > b) b = y;
        }
        return { top: (t - 2 * R) / R, h: (b - t) / R };
      };
      const clefInkY = {};
      [...svg.querySelectorAll('text')].filter(t => t.textContent.codePointAt(0) > 0x1D100).forEach(t => {
        const m = inkEm(t.textContent), fs = +t.getAttribute('font-size'), y = +t.getAttribute('y');
        clefInkY[t.textContent] = { top: y + m.top * fs, bot: y + (m.top + m.h) * fs };
      });
      const ex = buildKeyExercise(0, 'majscale', 'straight', 'asc', 2, null, null, 'pos', 'none', 5, null, 'none');
      const notes = ex.groups.flat();
      // fretboard modes must be refused even if a stale share link asks for one
      const forced = buildKeyExercise(0, 'majscale', 'straight', 'asc', 2, null, null, 'caged', 'none', 5, 0, 'none');
      return {
        staffLines, clefs, clefInkY,
        bravuraLoaded: document.fonts.check('32px Bravura'),
        tabLines: [...svg.querySelectorAll('text')].filter(t => 'eBGDAE'.includes(t.textContent) && t.getAttribute('font-family') === 'monospace').length,
        tabNums: document.querySelectorAll('#out .nn').length,
        noteheads: document.querySelectorAll('#out .nh').length,
        hasPitch: notes.every(n => typeof n.p === 'number'),
        hasNoStrings: notes.every(n => n.s === undefined && n.f === undefined),
        lowest: Math.min(...notes.map(n => n.p)),
        forcedNoStrings: forced.groups.flat().every(n => n.s === undefined),
        names: renderNoteNames(ex.groups, 0),
      };
    });
    assert('piano: grand staff has 10 lines, 16px gap (got ' + pm.staffLines.length + ')',
      pm.staffLines.length === 10 && pm.staffLines[5] - pm.staffLines[4] === 16 && pm.staffLines[1] - pm.staffLines[0] === 8);
    assert('piano: both clefs drawn', pm.clefs.includes('\u{1D11E}') && pm.clefs.includes('\u{1D122}'));
    // The inlined Bravura subset is what makes the clef placement exact — if it ever fails to
    // decode, the fallback system glyph lands somewhere else entirely and everything below
    // silently drifts, so check the font first.
    assert('piano: inlined Bravura subset loaded', pm.bravuraLoaded);
    {
      // Ink, not the em box, has to line up with the staff. Bravura places the G clef 4.39
      // spaces above its G line and 2.63 below, the F clef 1.05 above its F line and 2.54
      // below — measured off the shipped subset, so a bad subset or a lost glyph fails here.
      const L = pm.staffLines, SP = 8, near = (a, b) => Math.abs(a - b) <= 1.5;
      const g = pm.clefInkY['\u{1D11E}'], f = pm.clefInkY['\u{1D122}'];
      const gLine = L[3], fLine = L[6];        // G4 = 2nd treble line up, F3 = 2nd bass line down
      assert(`piano: G clef hangs off its G line (ink ${g.top.toFixed(0)}..${g.bot.toFixed(0)}, G line ${gLine}, staff ${L[0]}..${L[4]})`,
        near(g.top, gLine - 4.39 * SP) && near(g.bot, gLine + 2.63 * SP));
      assert(`piano: F clef sits on its F line (ink ${f.top.toFixed(0)}..${f.bot.toFixed(0)}, F line ${fLine}, staff ${L[5]}..${L[9]})`,
        near(f.top, fLine - 1.05 * SP) && near(f.bot, fLine + 2.54 * SP));
    }
    assert('piano: no tab staff or fret numbers', pm.tabLines === 0 && pm.tabNums === 0);
    assert('piano: notes carry pitch and no string/fret', pm.hasPitch && pm.hasNoStrings);
    assert('piano: 2-octave scale renders 15 noteheads (got ' + pm.noteheads + ')', pm.noteheads === 15);
    assert('piano: C major starts at C3 (got ' + pm.lowest + ')', pm.lowest === 48);
    assert('piano: fretboard fingering mode refused', pm.forcedNoStrings);
    assert('piano: note names spelled with octaves', pm.names.startsWith('C3 D3 E3 F3 G3 A3 B3 C4'));

    // keyboard diagram: whole octaves, correct keys lit for a black-key-heavy key signature
    const kb = await p.evaluate(() => {
      const read = q => {
        document.getElementById('query').value = q;
        runFromText();
        const svg = document.querySelector('#out .shapes svg');
        const rects = [...svg.querySelectorAll('rect')];
        return {
          whites: rects.filter(r => +r.getAttribute('width') === 19).length,
          blacks: rects.filter(r => +r.getAttribute('width') === 11.5).length,
          litW: rects.filter(r => +r.getAttribute('width') === 19 && r.getAttribute('fill') !== '#e8eaf0').length,
          litB: rects.filter(r => +r.getAttribute('width') === 11.5 && r.getAttribute('fill') !== '#14161c').length,
          octaveMarks: [...svg.querySelectorAll('text')].map(t => t.textContent).filter(t => /^C\d$/.test(t)),
        };
      };
      const r = { c: read('C major scale 2 octaves'), eb: read('Eb major scale 1 octave') };
      document.getElementById('selShapes').value = 'off';
      document.getElementById('selShapes').dispatchEvent(new Event('change'));
      r.offHides = document.querySelectorAll('#out .shapes').length === 0;
      document.getElementById('selShapes').value = 'neck';
      document.getElementById('selShapes').dispatchEvent(new Event('change'));
      return r;
    });
    assert('piano: keyboard spans whole octaves (' + kb.c.whites + ' white, ' + kb.c.blacks + ' black)',
      kb.c.whites % 7 === 0 && kb.c.blacks / 5 === kb.c.whites / 7);
    assert('piano: C major lights 15 white keys, no black', kb.c.litW === 15 && kb.c.litB === 0);
    assert('piano: Eb major lights Eb/Ab/Bb as black keys (4W/4B, got ' + kb.eb.litW + 'W/' + kb.eb.litB + 'B)',
      kb.eb.litW === 4 && kb.eb.litB === 4);
    assert('piano: octave markers under each C', JSON.stringify(kb.c.octaveMarks) === '["C3","C4","C5"]');
    assert('piano: keyboard can be switched off', kb.offHides);

    // standard scale fingerings
    const fng = await p.evaluate(() => {
      const run = (q, hand) => {
        document.getElementById('selHand').value = hand;
        document.getElementById('query').value = q;
        runFromText();
        const blocks = [...document.querySelectorAll('#out .keyblock')];
        return {
          seq: [...document.querySelectorAll('#out .fng')].map(t => t.textContent).join(''),
          // wherever numbers appear at all, there must be exactly one per note
          aligned: blocks.every(b => {
            const f = b.querySelectorAll('.fng').length;
            return f === 0 || f === b.querySelectorAll('.nh').length;
          }),
        };
      };
      // table shape — catches data-entry slips in any row that gets added later
      const badRows = [];
      Object.entries(PIANO_FING).forEach(([q, keys]) => Object.entries(keys).forEach(([pc, row]) =>
        Object.entries(row).forEach(([hand, f]) => {
          if (f.first.length !== 7) badRows.push(`${q}/${pc}/${hand} first=${f.first.length}`);
          if (f.rep && f.rep.length !== 7) badRows.push(`${q}/${pc}/${hand} rep=${f.rep.length}`);
          if (!(f.end >= 1 && f.end <= 5)) badRows.push(`${q}/${pc}/${hand} end=${f.end}`);
          if (f.first.concat(f.rep || [], f.end).some(x => x < 1 || x > 5)) badRows.push(`${q}/${pc}/${hand} finger out of range`);
        })));
      return {
        badRows,
        cRH: run('C major scale 2 octaves', 'rh'),
        cLH: run('C major scale 2 octaves', 'lh'),
        fRH: run('F major scale 1 octave', 'rh'),
        desc: run('C major scale 1 octave descending', 'rh'),
        both: run('C major scale 1 octave ascending and descending', 'rh'),
        thirds: run('C major scale in 3rds', 'rh'),
        unlisted: run('Bb major scale 1 octave', 'lh'),
        hidden: run('C major scale 1 octave', 'off'),
        harm: run('A harmonic minor scale 1 octave', 'rh'),
      };
    });
    assert('piano: fingering table rows well-formed' + (fng.badRows.length ? ' — ' + fng.badRows.join(', ') : ''),
      fng.badRows.length === 0);
    assert('piano: C major RH 2 octaves = 123123412312345 (got ' + fng.cRH.seq + ')',
      fng.cRH.seq === '123123412312345');
    assert('piano: C major LH 2 octaves = 543213214321321 (got ' + fng.cLH.seq + ')',
      fng.cLH.seq === '543213214321321');
    assert('piano: F major RH thumbs on F and C (got ' + fng.fRH.seq + ')', fng.fRH.seq === '12341234');
    assert('piano: descending reverses the run (got ' + fng.desc.seq + ')', fng.desc.seq === '54321321');
    assert('piano: asc+desc replays the top note (got ' + fng.both.seq + ')', fng.both.seq === '1231234554321321');
    assert('piano: no fingering invented for in-3rds', fng.thirds.seq === '');
    assert('piano: unlisted key shows no fingering', fng.unlisted.seq === '');
    assert('piano: fingering can be hidden', fng.hidden.seq === '');
    assert('piano: harmonic minor inherits the natural-minor hand', fng.harm.seq === '12312345');
    assert('piano: one finger number per note wherever shown',
      ['cRH','cLH','fRH','desc','both','harm'].every(k => fng[k].aligned));

    // voicings on piano: same interval theory, keyboard + grand-staff rendering
    const voi = await p.evaluate(() => {
      document.querySelector('.tabbtn[data-tab="voic"]').click();
      const set = (root, q, type) => {
        document.getElementById('vRoot').value = String(root);
        document.getElementById('vQual').value = q;
        document.getElementById('vType').value = type;
        ['vRoot', 'vQual', 'vType'].forEach(id => document.getElementById(id).dispatchEvent(new Event('change')));
        return [...document.querySelectorAll('#voicOut .vgrip')];
      };
      const cells = set(0, 'maj7', 'drop2');
      const pitches = t => pianoVoicings(...t.slice(0, 3), VOICE_SETS[t[2]][t[3] || 0]).map(v => v.pitches);
      return {
        cells: cells.length,
        labels: cells.map(c => c.querySelector('.vlabel').textContent),
        twoSvgs: cells.every(c => c.querySelectorAll('svg').length === 2),
        clickable: cells.every(c => c.getAttribute('role') === 'button' && c.tabIndex === 0),
        drop2: pitches([0, 'maj7', 'drop2']),
        shell: pitches([10, 'dom7', 'shell']),
        triad: pitches([7, 'maj', 'triad']),
        drillHidden: document.getElementById('vdBox').style.display === 'none',
        // guitar path must still work after the piano branch was added
        guitar: (() => {
          instrument = 'guitar';
          renderVoicings();
          const n = document.querySelectorAll('#voicOut .vgrip').length;
          instrument = 'piano'; renderVoicings();
          return n;
        })(),
      };
    });
    assert('piano: drop2 gives 4 inversions with staff + keyboard',
      voi.cells === 4 && voi.twoSvgs && voi.clickable);
    assert('piano: voicings labelled as derived from close position',
      JSON.stringify(voi.labels) === '["from root pos","from 1st inv","from 2nd inv","from 3rd inv"]');
    assert('piano: Cmaj7 drop2 root position is G3-C4-E4-B4 (got ' + voi.drop2[0] + ')',
      JSON.stringify(voi.drop2[0]) === '[55,60,64,71]');
    assert('piano: Bb7 shell sits in the left hand, not an octave high (got ' + voi.shell[0] + ')',
      JSON.stringify(voi.shell[0]) === '[46,56,62]');
    assert('piano: every voicing centred near middle C',
      [...voi.drop2, ...voi.shell, ...voi.triad].every(ps => {
        const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
        return mean > 48 && mean < 72;
      }));
    assert('piano: neck-position voicing drill hidden', voi.drillHidden);
    assert('guitar: voicing grips still render after the piano branch', voi.guitar > 0);

    // guitar-only fingering choice survives a detour through piano
    const rt = await p.evaluate(() => {
      const sel = document.getElementById('selInst'), r = {};
      sel.value = 'guitar'; sel.dispatchEvent(new Event('change'));
      selFing.value = 'caged'; selFing.dispatchEvent(new Event('change'));
      sel.value = 'piano';  sel.dispatchEvent(new Event('change'));
      r.inPiano = selFing.value;
      sel.value = 'guitar'; sel.dispatchEvent(new Event('change'));
      r.restored = selFing.value;
      r.tabBack = document.querySelectorAll('#out .nn').length > 0;
      return r;
    });
    assert('piano: fretboard fingering restored on return to guitar',
      rt.inPiano === 'pos' && rt.restored === 'caged' && rt.tabBack);
  }

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
  await p.click('.tabbtn[data-tab="poly"]');
  assert('mobile: poly tab opens and shows ratio controls', await p.locator('#polyA').isVisible());

  // piano keyboard must fit the width rather than hide keys behind a scrollbar
  await p.click('.tabbtn[data-tab="ex"]');
  const kbFit = await p.evaluate(() => {
    const sel = document.getElementById('selInst');
    sel.value = 'piano'; sel.dispatchEvent(new Event('change'));
    document.getElementById('query').value = 'C major scale 2 octaves';
    runFromText();
    const svg = document.querySelector('#out .kbdrow svg');
    const box = svg.closest('.kbdrow');
    const r = svg.getBoundingClientRect(), b = box.getBoundingClientRect();
    const lit = [...svg.querySelectorAll('rect')].filter(x => {
      const f = x.getAttribute('fill'); return f !== '#e8eaf0' && f !== '#14161c';
    });
    return {
      natural: +svg.getAttribute('width'),
      rendered: Math.round(r.width),
      fits: r.width <= b.width + 1,
      scrolls: box.scrollWidth > box.clientWidth + 1,
      allLitVisible: Math.max(...lit.map(x => x.getBoundingClientRect().right)) <= b.right + 1
                  && Math.min(...lit.map(x => x.getBoundingClientRect().left)) >= b.left - 1,
    };
  });
  assert('mobile: keyboard scales to fit, no hidden keys (' + kbFit.natural + '->' + kbFit.rendered + ')',
    kbFit.fits && !kbFit.scrolls && kbFit.allLitVisible && kbFit.rendered < kbFit.natural);
  await p.context().close();

  // ---------- landscape phone ----------
  // A phone in landscape is ~812px wide, so the width-only breakpoint used to leave it on the
  // full desktop metronome: it wrapped into stacked rows and ate a third of the viewport, with
  // no collapse button reachable.
  p = await newPage({ width: 812, height: 375 });
  const land = await p.evaluate(() => {
    const h = () => Math.round(document.getElementById('metro').getBoundingClientRect().height);
    const more = document.getElementById('mMore');
    const slim = h();
    const moreVisible = getComputedStyle(more).display !== 'none';
    more.click(); const expanded = h();
    more.click();
    return { slim, moreVisible, expanded, backToSlim: h(), vh: innerHeight };
  });
  assert('landscape: metronome collapsed to a slim bar (' + land.slim + 'px, ' +
    Math.round(land.slim / land.vh * 100) + '% of viewport)', land.slim < 60);
  assert('landscape: collapse button reachable', land.moreVisible);
  assert('landscape: it expands and collapses again',
    land.expanded > land.slim && land.backToSlim === land.slim);

  // viewport-fit=cover puts the notch over the page edges in landscape; the bar must keep its
  // controls inside the safe area. env() is 0 here, so simulate a phone-class inset instead.
  const notch = await p.evaluate(() => {
    const m = document.getElementById('metro');
    const probe = () => {
      const mr = m.getBoundingClientRect(), cs = getComputedStyle(m);
      const inner = { l: mr.left + parseFloat(cs.paddingLeft), r: mr.right - parseFloat(cs.paddingRight) };
      const kids = [...m.children].filter(c => getComputedStyle(c).display !== 'none');
      return {
        overflowsX: m.scrollWidth > m.clientWidth + 1,
        allInside: kids.every(c => {
          const r = c.getBoundingClientRect();
          return r.left >= inner.l - 1 && r.right <= inner.r + 1;
        }),
      };
    };
    const before = probe();
    const s = document.createElement('style');
    s.textContent = '#metro{padding-left:71px !important;padding-right:71px !important}';
    document.head.appendChild(s);
    const sim = probe();
    s.remove();
    // and the rule itself must actually reference the horizontal insets
    const css = [...document.styleSheets].filter(x => !x.href)
      .flatMap(x => [...x.cssRules]).map(r => r.cssText).join('');
    return { before, sim, hasInsets: /safe-area-inset-left/.test(css) && /safe-area-inset-right/.test(css) };
  });
  assert('landscape: metronome padding is notch-aware', notch.hasInsets);
  assert('landscape: controls stay inside the safe area under a 59px notch',
    notch.before.allInside && notch.sim.allInside && !notch.sim.overflowsX);
  await p.context().close();

  // ---------- portrait: expanded metronome must stay bounded ----------
  // Expanded, it grew unbounded as controls wrapped (273px, past the 162px body reserves) and
  // covered the page. It is capped and scrolls internally now, with 44px touch targets intact.
  p = await newPage({ width: 393, height: 852 });
  const port = await p.evaluate(() => {
    const m = document.getElementById('metro'), more = document.getElementById('mMore');
    const h = () => Math.round(m.getBoundingClientRect().height);
    const slim = h();
    more.click();
    const open = h();
    const reachable = ['mTap', 'mSwing', 'tunBtn', 'beatsGrp', 'trainerGrp'].every(id => {
      const el = document.getElementById(id);
      return el && getComputedStyle(el).display !== 'none' && el.offsetTop < m.scrollHeight;
    });
    const tapH = document.getElementById('mTap').getBoundingClientRect().height;
    const scrolls = m.scrollHeight > m.clientHeight + 1;
    more.click();
    return { slim, open, reachable, scrolls, tapH, backToSlim: h() === slim, vh: innerHeight };
  });
  assert('portrait: collapsed bar stays slim (' + port.slim + 'px)', port.slim < 80);
  assert('portrait: expanded bar capped at ' + port.open + 'px (' +
    Math.round(port.open / port.vh * 100) + '% of viewport, was 273/32%)', port.open <= 215);
  assert('portrait: every expanded control still reachable by scrolling',
    port.reachable && port.scrolls);
  assert('portrait: touch targets not shrunk to fit (Tap = ' + Math.round(port.tapH) + 'px)',
    port.tapH >= 40);
  assert('portrait: collapses back', port.backToSlim);
  await p.context().close();

  // ---------- harmony game: random rolls must not be stuck on the I chord ----------
  p = await newPage({ width: 1280, height: 900 });
  const roll = await p.evaluate(() => {
    let dup = 0, homeEnd = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      hgRandom(4);
      const l = hgProg.map(c => c.label);
      if (l.some((x, j) => j && x === l[j - 1])) dup++;
      if (l[l.length - 1] === l[0]) homeEnd++;
    }
    return { dup, homeEnd, N, len: hgProg.length };
  });
  assert('harmony game: random x4 gives 4 bars', roll.len === 4);
  assert('harmony game: never repeats a chord back-to-back', roll.dup === 0);
  assert('harmony game: ends on I ' + Math.round(100 * roll.homeEnd / roll.N) + '% of rolls (was 60%)',
    roll.homeEnd / roll.N < 0.5);
  await p.context().close();

  // ---------- Today's Practice ----------
  // Seeded history: a recently-practiced technique exercise with a 120 BPM PB, a stale
  // favorite (exploration candidate), and ear history where chords are clearly weakest.
  {
    const DAY = 86400000, NOW = Date.now();
    const pentV = ['9', 'minpent', 'groups3', 'single', 'asc', '2', 'pos', '5', 'none', 'alternate', 'neck', 'on', 'eighth', '0', 'none'];
    const bluesV = ['7', 'blues', 'straight', 'single', 'both', '2', 'pos', '5', 'none', 'none', 'neck', 'on', 'eighth', '0', 'none'];
    const pentK = 'minor pentatonic · groups of 3 · ascending · 8th notes · 2 octaves · 4 bars/key in 4/4';
    const seed = {
      sessions: [{ k: pentK, bpm: 115, t: NOW - 2 * DAY, v: pentV }],
      pb: { [pentK]: { bpm: 120, t: NOW - 2 * DAY } },
      favs: [{ n: 'blues scale · straight · asc + desc · 8th notes', v: bluesV, t: NOW - 20 * DAY }],
      ear: { intervals: { c: 18, t: 20 }, chords: { c: 4, t: 10 } },
      earRecent: [
        ...Array.from({ length: 20 }, (_, i) => ({ cat: 'intervals', ok: i < 18, t: NOW - 3 * DAY + i })),
        ...Array.from({ length: 10 }, (_, i) => ({ cat: 'chords', ok: i < 4, t: NOW - 2 * DAY + i })),
      ],
    };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(s => localStorage.setItem('gph', JSON.stringify(s)), seed);
    p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push('console: ' + m.text()); });
    await p.goto(URL); await p.waitForTimeout(1200);

    // unit tests on the pure engine, independent of the seeded localStorage
    const u = await p.evaluate(() => {
      const pentV2 = ['9', 'minpent', 'groups3', 'single', 'asc', '2', 'pos', '5', 'none', 'alternate', 'neck', 'on', 'eighth', '0', 'none'];
      const mk = (pb, extra) => ({
        sessions: [{ k: 'minor pentatonic · groups of 3 · ascending · 8th notes · x', bpm: 100, t: Date.now() - 86400000, v: pentV2 }],
        pb: pb ? { 'minor pentatonic · groups of 3 · ascending · 8th notes · x': { bpm: pb, t: Date.now() } } : {},
        ...extra,
      });
      const sums = [15, 20, 30].map(m => generateDailySession(mk(120), m, 's').blocks.reduce((a, b) => a + b.mins, 0));
      const t120 = generateDailySession(mk(120), 20, 's').blocks[0];
      const t45  = generateDailySession(mk(45), 20, 's').blocks[0];
      const t280 = generateDailySession(mk(280), 20, 's').blocks[0];
      const weak = generateDailySession({ earRecent: [
        ...Array.from({ length: 10 }, (_, i) => ({ cat: 'intervals', ok: true, t: i })),
        ...Array.from({ length: 10 }, (_, i) => ({ cat: 'chords', ok: i < 4, t: i })),
      ] }, 20, 's').blocks[1];
      const sparse = generateDailySession({}, 20, 's').blocks[1];
      const favOnly = generateDailySession({ favs: [{ n: 'blues scale · straight · asc + desc · 8th notes', v: pentV2, t: 1 }] }, 20, 's').blocks[0];
      const multi = generateDailySession({ favs: [
        { n: 'a · b · c · d', v: pentV2, t: 1 }, { n: 'e · f · g · h', v: pentV2, t: 2 },
      ] }, 20, 's');
      const empty = generateDailySession({}, 20, 's');
      const stable = JSON.stringify(generateDailySession(mk(120), 20, 'seedA')) ===
                     JSON.stringify(generateDailySession(mk(120), 20, 'seedA'));
      const first = generateDailySession({}, 20, 'x').blocks[0];
      const regen = generateDailySession({ avoid: [first.n] }, 20, 'x').blocks[0];
      let malformedOk = true;
      try {
        const m = generateDailySession({ sessions: [{ k: 5 }, null, 'x'], pb: 'nope', favs: [{}, { n: 'a' }], ear: { intervals: 'bad' }, earRecent: 'nope' }, 20, 's');
        malformedOk = m.blocks.length === 3 && m.blocks.every(b => b.mins > 0 && b.reason);
      } catch (e) { malformedOk = false; }
      return { sums, t120: { target: t120.target, pb: t120.pb }, t45: t45.target, t280: t280.target,
               weak: { cat: weak.cat, acc: weak.acc }, sparse: { cat: sparse.cat, src: sparse.src, lvl: sparse.lvl },
               favOnly: { src: favOnly.src, n: favOnly.n }, multiDistinct: multi.blocks[0].n !== multi.blocks[2].n,
               empty: { n: empty.blocks.length, target: empty.blocks[0].target, reasons: empty.blocks.every(b => b.reason && b.mins > 0) },
               stable, regenDiffers: first.n !== regen.n, malformedOk };
    });
    assert('today: block minutes sum to 15/20/30 exactly', JSON.stringify(u.sums) === '[15,20,30]');
    assert('today: technique target is PB − 10 (120 → ' + u.t120.target + ')', u.t120.target === 110 && u.t120.pb === 120);
    assert('today: target clamped to trainer limits (45→' + u.t45 + ', 280→' + u.t280 + ')', u.t45 === 40 && u.t280 === 260);
    assert('today: weakest recent ear category selected (chords @ ' + u.weak.acc + '%)', u.weak.cat === 'chords' && u.weak.acc === 40);
    assert('today: sparse ear history falls back to a level-1 rotation', ['intervals', 'chords', 'scales'].includes(u.sparse.cat) && u.sparse.lvl === 1 && u.sparse.src === 'rotation');
    assert('today: favorites usable when practice history is missing', u.favOnly.src === 'fav');
    assert('today: technique and exploration blocks pick different exercises', u.multiDistinct);
    assert('today: new user gets a complete starter session at 80 BPM', u.empty.n === 3 && u.empty.target === 80 && u.empty.reasons);
    assert('today: generation is deterministic for the same seed', u.stable);
    assert('today: regeneration avoids the previous technique pick', u.regenDiffers);
    assert('today: malformed history data does not crash generation', u.malformedOk);

    // UI flow against the seeded history
    await p.click('.tabbtn[data-tab="today"]');
    assert('today: tab opens the panel', await p.locator('#viewToday').isVisible());
    assert('today: renders three block cards', (await p.locator('.tdcard').count()) === 3);
    const techCard = await p.locator('.tdcard').first().innerText();
    assert('today: technique card shows PB-derived target (Target: 110 · PB 120)',
      techCard.includes('Target: 110 BPM') && techCard.includes('120 BPM'));
    assert('today: technique reason explains the selection', techCard.includes('10 below your 120 BPM'));
    const earCard = await p.locator('.tdcard').nth(1).innerText();
    assert('today: ear card targets the weak category with its accuracy', earCard.includes('Chord recognition') && earCard.includes('40%'));
    const noHoles = await p.evaluate(() => !/undefined|NaN|null/.test($('viewToday').innerText));
    assert('today: no undefined/NaN leaks into the page', noHoles);

    await p.click('.tddur[data-min="15"]');
    const m15 = await p.evaluate(() => ({ mins: tdSession.mins, sum: tdSession.blocks.reduce((a, b) => a + b.mins, 0), pressed: $('viewToday').querySelector('.tddur[data-min="15"]').getAttribute('aria-pressed') }));
    assert('today: 15-min selector reallocates to 15 total', m15.mins === 15 && m15.sum === 15 && m15.pressed === 'true');
    await p.click('.tddur[data-min="20"]');

    // same-day stability: a reload restores the identical session
    const before = await p.evaluate(() => tdSession.blocks.map(b => b.n || b.cat).join('|') + '|' + tdSession.gen);
    await p.reload(); await p.waitForTimeout(1200);
    await p.click('.tabbtn[data-tab="today"]');
    const after = await p.evaluate(() => tdSession.blocks.map(b => b.n || b.cat).join('|') + '|' + tdSession.gen);
    assert('today: session survives a reload unchanged', before === after);

    // start → configures the exercise tab, metronome and speed-trainer target
    await p.evaluate(() => { [...$('tdControls').children].find(b => b.textContent === 'Start Session').click(); });
    await p.waitForTimeout(300);
    const started = await p.evaluate(() => ({
      exVisible: $('viewEx').style.display !== 'none', bpm: metro.bpm, tTarget: $('tTarget').value,
      qual: selQual.value, tech: selTech.value, status: tdSession.status, b0: tdSession.blocks[0].status,
    }));
    assert('today: Start Session opens the exercise at 110 BPM with the trainer target set',
      started.exVisible && started.bpm === 110 && started.tTarget === '110' && started.qual === 'minpent' && started.tech === 'alternate');
    assert('today: session and first block marked in progress', started.status === 'started' && started.b0 === 'active');

    // "✓ Log" flows into the practice log AND completes the active block — no duplicates
    const logsBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('gph')).sessions.length);
    await p.click('#logBtn'); await p.waitForTimeout(200);
    const afterLog = await p.evaluate(() => ({
      logs: JSON.parse(localStorage.getItem('gph')).sessions.length,
      b0: tdSession.blocks[0].status, hasV: Array.isArray(JSON.parse(localStorage.getItem('gph')).sessions.at(-1).v),
    }));
    assert('today: logging the exercise completes the technique block', afterLog.b0 === 'done');
    assert('today: exactly one practice-log entry added, carrying select values', afterLog.logs === logsBefore + 1 && afterLog.hasV);

    // ear block start configures the existing ear trainer
    await p.click('.tabbtn[data-tab="today"]');
    await p.evaluate(() => { const i = tdSession.blocks.findIndex(b => b.type === 'ear'); tdStartBlock(i); });
    await p.waitForTimeout(200);
    const earStart = await p.evaluate(() => ({ vis: $('viewEar').style.display !== 'none', cat: $('eCat').value }));
    assert('today: ear block opens Ear training preset to the weak category', earStart.vis && earStart.cat === 'chords');

    // return to an in-progress session, mark ear done, replace + skip exploration
    await p.click('.tabbtn[data-tab="today"]');
    await p.evaluate(() => { const i = tdSession.blocks.findIndex(b => b.type === 'ear'); tdCompleteBlock(i); });
    const expBefore = await p.evaluate(() => tdSession.blocks[2].n);
    await p.evaluate(() => tdReplaceBlock(2));
    const expAfter = await p.evaluate(() => tdSession.blocks[2].n);
    assert('today: replace picks a different exploration exercise', !!expAfter && expAfter !== expBefore);
    await p.evaluate(() => tdSkipBlock(2));
    const finished = await p.evaluate(() => ({ status: tdSession.status, boxShown: $('tdDoneBox').style.display !== 'none', text: $('tdDoneBox').innerText }));
    assert('today: skipping the last block completes the session', finished.status === 'done' && finished.boxShown);
    assert('today: completion summary shows completed and skipped counts', /2 completed/.test(finished.text) && /1 skipped/.test(finished.text));

    // completed state also persists across a reload (anonymous localStorage persistence)
    await p.reload(); await p.waitForTimeout(1200);
    await p.click('.tabbtn[data-tab="today"]');
    const persisted = await p.evaluate(() => ({ status: tdSession.status, boxShown: $('tdDoneBox').style.display !== 'none' }));
    assert('today: completed session persists for the rest of the day', persisted.status === 'done' && persisted.boxShown);

    // regenerate produces a fresh, valid session and fires the analytics event
    const regen = await p.evaluate(() => {
      evOff = false; window.__ev.length = 0;
      tdRegenerate();
      const ev = window.__ev.map(e => e.name);
      window.__ev.length = 0; evOff = true;
      return { status: tdSession.status, n: tdSession.blocks.length, sum: tdSession.blocks.reduce((a, b) => a + b.mins, 0), ev };
    });
    assert('today: regenerate yields a fresh valid session', regen.status === 'new' && regen.n === 3 && regen.sum === 20);
    assert('today: regenerate tracked', regen.ev.includes('today_regenerate'));
    await p.context().close();
  }

  // ---------- Today's Practice: brand-new user + mobile ----------
  {
    p = await newPage({ width: 390, height: 844 });
    await p.click('.tabbtn[data-tab="today"]');
    const fresh = await p.evaluate(() => ({
      cards: document.querySelectorAll('.tdcard').length,
      intro: $('tdIntro').textContent,
      target: tdSession.blocks[0].target,
      clean: !/undefined|NaN|null/.test($('viewToday').innerText),
      fits: document.documentElement.scrollWidth <= innerWidth + 1,
    }));
    assert('today: new user gets a full starter session on mobile', fresh.cards === 3 && fresh.target === 80);
    assert('today: new-user message explains adaptation', /adapt/i.test(fresh.intro));
    assert('today: no data holes and no horizontal overflow on mobile', fresh.clean && fresh.fits);
    await p.context().close();
  }

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
  if (errs.length) failed = 1;
  await browser.close();
  process.exit(failed);
})();
