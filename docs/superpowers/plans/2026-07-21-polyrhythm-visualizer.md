# Polyrhythm Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Poly" tab to Guitar Practice Helper with accurate synchronized-click playback, circular + linear visualizations, a timing-analysis panel, and 5 practice modes for polyrhythm (A:B) practice.

**Architecture:** Everything lives in the existing single-file app (`index.html`) as: (1) a pure-function math section colocated near the existing `ENGINE` section, (2) a `poly` state object + Web-Audio lookahead scheduler mirroring the existing metronome's pattern and reusing its shared `AudioContext`/bus, (3) hand-rolled SVG rendering driven by `requestAnimationFrame` deriving position from `AudioContext.currentTime`, (4) a new tab button + panel following the exact markup/CSS conventions of the existing tabs, (5) a small `localStorage` wrapper mirroring the existing `store` object.

**Tech Stack:** Vanilla JS, Web Audio API, hand-rolled SVG, no build step. Tests via Playwright (`tests/smoke.js`), run against `python -m http.server 8741`.

## Global Constraints

- No new files except test additions to `tests/smoke.js` — all feature code goes into `index.html`, per the existing single-file convention.
- No new dependencies (no npm packages, no CDN scripts). Reuse `ensureAudio()` / `metro.bus` for all audio.
- Ratio inputs A and B are clamped to the range 1–16.
- BPM range for this feature is 20–300 (wider than the main metronome's 30–260, per the spec's ask for a range appropriate to slow polyrhythm practice).
- Starting Poly playback stops the main metronome if it's running, and vice versa — never two schedulers writing to the audio output at once.
- Playhead position in both visualizations must be computed fresh each `requestAnimationFrame` from `AudioContext.currentTime` — never accumulated frame-by-frame.
- `prefers-reduced-motion: reduce` disables the continuously-moving playhead; per-pulse flash highlighting still works.
- All new interactive controls need an accessible name (label, `aria-label`, or placeholder) — the existing smoke test's a11y check (`tests/smoke.js:31-41`) covers this automatically, so don't add controls it can't find (i.e. real `<button>`/`<select>`/`<input>` elements, not bare `<div>`s).
- Every task ends by running `python -m http.server 8741` (background) + `node tests/smoke.js` and confirming the new assertions pass (and no prior ones regress) before committing.

---

### Task 1: Polyrhythm math (pure functions)

**Files:**
- Modify: `index.html` — insert new section immediately after `// ===== ENGINE END =====` (currently `index.html:1309`)
- Test: `tests/smoke.js` — new assertions block

**Interfaces:**
- Produces: `gcdOf(a, b)`, `lcmOf(a, b)`, `simplifyRatio(a, b) → {a, b}`, `polyPulses(a, b) → {lcm, a: number[], b: number[]}` (subdivision indices, 0-based), `polyPulseTimes(a, b, cycleMs) → {a: number[], b: number[], shared: number[]}` (ms within cycle), `polyPattern(a, b) → {lineA, lineB, lineC}` (space-joined ASCII strings), `polyEvents(a, b, cycleMs, phaseMsB) → Array<{tMs, isA, isB, grid, aIdx, bIdx}>` sorted by `tMs`.

- [ ] **Step 1: Write the failing test**

Add to `tests/smoke.js`, right before the final `console.log(errs.length ...)` block (so it runs in the existing single browser context before it closes — add it right after the "voicings" block, before `await p.context().close();` around `tests/smoke.js:203`):

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python -m http.server 8741 &
node tests/smoke.js
```
Expected: script throws (e.g. `ReferenceError: gcdOf is not defined`) or exits non-zero — the functions don't exist yet.

- [ ] **Step 3: Implement the math functions**

Insert into `index.html` immediately after line 1309 (`// ===== ENGINE END =====`):

```js
// ---- Polyrhythm math (pure) ----
function gcdOf(a, b){ a = Math.abs(a); b = Math.abs(b); while(b){ [a, b] = [b, a % b]; } return a; }
function lcmOf(a, b){ return Math.abs(a * b) / gcdOf(a, b); }
function simplifyRatio(a, b){ const g = gcdOf(a, b) || 1; return { a: a / g, b: b / g }; }
// Subdivision indices (0..lcm-1) each rhythm strikes on, within one shared cycle.
function polyPulses(a, b){
  const lcm = lcmOf(a, b);
  const stepA = lcm / a, stepB = lcm / b;
  const pa = []; for(let i = 0; i < a; i++) pa.push(i * stepA);
  const pb = []; for(let i = 0; i < b; i++) pb.push(i * stepB);
  return { lcm, a: pa, b: pb };
}
// Millisecond timestamps within one cycle of length cycleMs (no phase offset).
function polyPulseTimes(a, b, cycleMs){
  const ta = []; for(let i = 0; i < a; i++) ta.push(i * cycleMs / a);
  const tb = []; for(let i = 0; i < b; i++) tb.push(i * cycleMs / b);
  const shared = ta.filter(t => tb.some(u => Math.abs(u - t) < 1e-6));
  return { a: ta, b: tb, shared };
}
// ASCII pattern lines across the LCM grid. ◎ = shared strike, A/B = single, . = rest.
function polyPattern(a, b){
  const { lcm, a: pa, b: pb } = polyPulses(a, b);
  const setA = new Set(pa), setB = new Set(pb);
  const lineA = [], lineB = [], lineC = [];
  for(let i = 0; i < lcm; i++){
    const hitA = setA.has(i), hitB = setB.has(i);
    lineA.push(hitA ? 'X' : '.');
    lineB.push(hitB ? 'X' : '.');
    lineC.push(hitA && hitB ? '◎' : hitA ? 'A' : hitB ? 'B' : '.');
  }
  return { lineA: lineA.join(' '), lineB: lineB.join(' '), lineC: lineC.join(' ') };
}
// One cycle's playable events, sorted by time. Every LCM subdivision is included
// (grid:true) so an optional soft click-every-step mode has something to schedule.
// Rhythm B's hits shift by phaseMsB (mod cycleMs) for playback timing; aIdx/bIdx
// let the UI flash the exact pulse dot that just fired.
function polyEvents(a, b, cycleMs, phaseMsB){
  const { lcm, a: pa, b: pb } = polyPulses(a, b);
  const setA = new Set(pa);
  const evs = [];
  for(let i = 0; i < lcm; i++){
    evs.push({ tMs: i * cycleMs / lcm, isA: setA.has(i), isB: false, grid: true,
      aIdx: setA.has(i) ? pa.indexOf(i) : -1, bIdx: -1 });
  }
  const shift = ((phaseMsB || 0) % cycleMs + cycleMs) % cycleMs;
  pb.forEach((i, n) => {
    const t = (i * cycleMs / lcm + shift) % cycleMs;
    const near = evs.find(e => Math.abs(e.tMs - t) < 1);
    if(near){ near.isB = true; near.bIdx = n; }
    else evs.push({ tMs: t, isA: false, isB: true, grid: false, aIdx: -1, bIdx: n });
  });
  evs.sort((x, y) => x.tMs - y.tMs);
  return evs;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/smoke.js
```
Expected: all `poly:` lines print `PASS`, and every pre-existing assertion still passes.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Add polyrhythm math functions (gcd/lcm/pulses/pattern/events)"
```

---

### Task 2: Poly tab scaffold (button, empty panel, wiring)

**Files:**
- Modify: `index.html:254-261` (tabbar), `index.html:556` (insert panel before the footer `<p class="sub">`), `index.html:1708-1723` (tab-switch handler), CSS block (near `index.html:90-93`)
- Test: `tests/smoke.js`

**Interfaces:**
- Produces: `#viewPoly` panel (hidden by default), `currentTab === 'poly'` when active, a no-op `renderPoly()` function later tasks extend.

- [ ] **Step 1: Write the failing test**

Add after the Task 1 assertions in `tests/smoke.js`:

```js
  await p.click('.tabbtn[data-tab="poly"]');
  assert('poly: tab switches panel visible', await p.locator('#viewPoly').isVisible());
  await p.click('.tabbtn[data-tab="ex"]');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/smoke.js
```
Expected: FAIL (or throws) — `.tabbtn[data-tab="poly"]` doesn't exist yet.

- [ ] **Step 3: Add the tab button**

In `index.html`, after the Progress tab button (line 260), before the closing `</div>` of `.tabbar` (line 261):

```html
    <button class="tabbtn" data-tab="poly"><svg class="ticon" aria-hidden="true" viewBox="0 0 20 20"><circle cx="6" cy="10" r="3" fill="currentColor"/><circle cx="14" cy="6" r="2" fill="currentColor"/><circle cx="14" cy="14" r="2" fill="currentColor"/></svg><span class="tl">Polyrhythm</span><span class="ts">Poly</span></button>
```

- [ ] **Step 4: Add the empty panel**

In `index.html`, right after `</div>` closing `#viewEar` (currently line 556), before the footer `<p class="sub" ...>`:

```html
  <div id="viewPoly" style="display:none">
  </div>
```

- [ ] **Step 5: Wire the tab switch**

In `index.html`'s tab-switch handler (`index.html:1708-1723`), add one line alongside the other `$('view...')` toggles:

```js
  $('viewPoly').style.display = b.dataset.tab==='poly' ? '' : 'none';
```

and one line alongside the other `if(b.dataset.tab===...)` init calls:

```js
  if(b.dataset.tab==='poly') renderPoly();
  if(b.dataset.tab!=='poly') polyTabLeave();
```

Add stub functions right after the `polyEvents` function from Task 1:

```js
// ---- Polyrhythm UI (filled in by later tasks) ----
let polyInited = false;
function renderPoly(){ polyInited = true; }
function polyTabLeave(){}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
node tests/smoke.js
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Add Polyrhythm tab scaffold"
```

---

### Task 3: Ratio controls + analysis text panel

**Files:**
- Modify: `index.html` (`#viewPoly` markup, `renderPoly`)
- Test: `tests/smoke.js`

**Interfaces:**
- Consumes: `gcdOf`, `lcmOf`, `simplifyRatio`, `polyPattern` (Task 1)
- Produces: `poly` state object with `{a, b}`, `polySetRatio(a, b)`, `polyRenderAnalysis()`. Later tasks read `poly.a`/`poly.b` and call `polySetRatio` from presets/inputs.

- [ ] **Step 1: Write the failing test**

```js
  await p.click('.tabbtn[data-tab="poly"]');
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
  await p.click('.tabbtn[data-tab="ex"]');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/smoke.js
```
Expected: FAIL — `#polyPresets`, `#polyA`, etc. don't exist.

- [ ] **Step 3: Add ratio controls + analysis markup**

Replace the empty `<div id="viewPoly" style="display:none"></div>` from Task 2 with:

```html
  <div id="viewPoly" style="display:none">
    <div class="chips" id="polyPresets">
      <button class="chip" data-a="2" data-b="3">2:3</button>
      <button class="chip" data-a="3" data-b="4">3:4</button>
      <button class="chip" data-a="4" data-b="5">4:5</button>
      <button class="chip" data-a="5" data-b="7">5:7</button>
      <button class="chip" data-a="7" data-b="8">7:8</button>
    </div>
    <div class="controls">
      <div class="ctl"><label for="polyA">Rhythm A</label><input id="polyA" type="number" min="1" max="16" value="3"></div>
      <div class="ctl"><label for="polyB">Rhythm B</label><input id="polyB" type="number" min="1" max="16" value="4"></div>
      <div class="ctl"><label>&nbsp;</label><button id="polySwap" aria-label="Swap rhythm A and B">⇄ Swap</button></div>
    </div>
    <p class="sub" id="polySameNote" style="display:none">A equals B — this plays both rhythms in unison, not a polyrhythm.</p>

    <div class="hgbox">
      <div class="keyhead"><span class="keyname" id="polyRatioTitle">3:4</span></div>
      <pre id="polyPatternText" class="sub" style="font-family:monospace;white-space:pre-wrap;color:var(--text)"></pre>
    </div>
  </div>
```

- [ ] **Step 4: Implement `poly` state, `polySetRatio`, `polyRenderAnalysis`, and wire the controls**

Replace the Task 2 stub functions with:

```js
// ---- Polyrhythm state ----
const poly = {
  a: 3, b: 4,
};
function polySetRatio(a, b){
  poly.a = Math.max(1, Math.min(16, Math.round(a) || 1));
  poly.b = Math.max(1, Math.min(16, Math.round(b) || 1));
  $('polyA').value = poly.a; $('polyB').value = poly.b;
  $('polySameNote').style.display = poly.a === poly.b ? '' : 'none';
  polyRenderAnalysis();
}
function polyRenderAnalysis(){
  const { a, b } = poly;
  const g = gcdOf(a, b), lcm = lcmOf(a, b), simp = simplifyRatio(a, b);
  const pat = polyPattern(a, b);
  $('polyRatioTitle').textContent = `${a}:${b}`;
  const simpNote = (simp.a !== a || simp.b !== b) ? ` (simplifies to ${simp.a}:${simp.b})` : '';
  $('polyPatternText').textContent =
    `${a}:${b}${simpNote}\nGCD ${g} · LCM ${lcm} · ${lcm} shared subdivisions\n\n` +
    `Rhythm A:\n${pat.lineA}\n\nRhythm B:\n${pat.lineB}\n\nCombined (◎ = both, A/B = single, . = rest):\n${pat.lineC}`;
}
let polyInited = false;
function renderPoly(){
  if(!polyInited){
    polyInited = true;
    document.querySelectorAll('#polyPresets .chip').forEach(btn =>
      btn.onclick = () => polySetRatio(+btn.dataset.a, +btn.dataset.b));
    $('polyA').addEventListener('change', () => polySetRatio(+$('polyA').value, poly.b));
    $('polyB').addEventListener('change', () => polySetRatio(poly.a, +$('polyB').value));
    $('polySwap').onclick = () => polySetRatio(poly.b, poly.a);
  }
  polyRenderAnalysis();
}
function polyTabLeave(){}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node tests/smoke.js
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Add polyrhythm ratio controls and analysis panel"
```

---

### Task 4: Audio scheduler (playback engine)

**Files:**
- Modify: `index.html` (`poly` state extended, scheduler functions, tempo/transport markup)
- Test: `tests/smoke.js`

**Interfaces:**
- Consumes: `ensureAudio()`, `metro.bus`, `metro.playing`/`metroStop()` (existing, `index.html:1850`/`2839`), `metroClick` (existing, `index.html:2777`), `polyEvents` (Task 1)
- Produces: `poly.bpm`, `poly.bpmRef`, `poly.playing`, `polyRebuild()`, `polyStart()`, `polyPause()`, `polyResume()`, `polyStop()`, `polyRestart()`, `polyTogglePlay()`, `polySetTempo(bpm)`. Later tasks call these from UI buttons and read `poly.cycleCount`/`poly.cycleMs`.

- [ ] **Step 1: Write the failing test**

```js
  await p.click('.tabbtn[data-tab="poly"]');
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/smoke.js
```
Expected: FAIL — `#polyPlay`/`#polyStop`, `polySetTempo`, `poly.timer` don't exist yet.

- [ ] **Step 3: Add transport markup**

Add inside `#viewPoly`, after the `.hgbox` analysis block from Task 3:

```html
    <div class="controls">
      <div class="ctl"><label for="polyBpm">BPM</label><input id="polyBpm" type="number" min="20" max="300" value="90"></div>
      <div class="ctl"><label for="polyBpmSlider">Tempo slider</label><input id="polyBpmSlider" type="range" min="20" max="300" value="90"></div>
      <div class="ctl"><label for="polyBpmRef">BPM refers to</label><select id="polyBpmRef">
        <option value="cycle" selected>Shared cycle</option>
        <option value="a">Rhythm A pulse</option>
        <option value="b">Rhythm B pulse</option>
      </select></div>
      <div class="ctl"><label><input id="polyCountIn" type="checkbox"> Count-in (1 cycle)</label></div>
    </div>
    <div class="keyhead">
      <button class="pbtn" id="polyPlay" aria-label="Play polyrhythm">▶</button>
      <button class="pbtn" id="polyRestart" aria-label="Restart from cycle 1">⟲</button>
      <button class="pbtn" id="polyStop" aria-label="Stop">■</button>
      <span class="keyname" id="polyCycleCount" style="font-size:14px">Cycle 0</span>
    </div>
```

- [ ] **Step 4: Implement the scheduler**

Add after `polyRenderAnalysis` in the polyrhythm section:

```js
Object.assign(poly, {
  bpm: 90, bpmRef: 'cycle', countIn: false,
  cycleMs: 0, cycleStartTime: 0, cycleCount: 0,
  events: [], eventIdx: 0,
  ctx: null, timer: null, playing: false,
  LOOKAHEAD_MS: 25, AHEAD: 0.1,
});
function polyCycleMs(){
  if(poly.bpmRef === 'a') return 60000 / poly.bpm * poly.a;
  if(poly.bpmRef === 'b') return 60000 / poly.bpm * poly.b;
  return 60000 / poly.bpm;
}
function polyRebuild(){
  poly.cycleMs = polyCycleMs();
  poly.events = polyEvents(poly.a, poly.b, poly.cycleMs, poly.phaseMsB || 0);
}
function polyClick(time, ev){
  const ctx = poly.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
  const both = ev.isA && ev.isB;
  osc.type = both ? 'square' : ev.isA ? 'triangle' : 'sine';
  osc.frequency.value = both ? 1568 : ev.isA ? 880 : 587;
  const vol = both ? 0.9 : 0.6;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(vol, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  osc.connect(g); g.connect(metro.bus);
  osc.start(time); osc.stop(time + 0.06);
}
function polyScheduler(){
  while(true){
    const ev = poly.events[poly.eventIdx];
    const t = poly.cycleStartTime + poly.cycleCount * poly.cycleMs / 1000 + ev.tMs / 1000;
    if(t >= poly.ctx.currentTime + poly.AHEAD) break;
    if(ev.isA || ev.isB) polyClick(t, ev);
    poly.eventIdx++;
    if(poly.eventIdx >= poly.events.length){
      poly.eventIdx = 0;
      poly.cycleCount++;
      const boundaryTime = poly.cycleStartTime + poly.cycleCount * poly.cycleMs / 1000;
      const delay = (boundaryTime - poly.ctx.currentTime) * 1000;
      setTimeout(() => { $('polyCycleCount').textContent = 'Cycle ' + poly.cycleCount; }, Math.max(delay, 0));
    }
  }
}
function polyCountIn(t0){
  const n = Math.max(poly.a, poly.b);
  for(let i = 0; i < n; i++) metroClick(t0 + i * poly.cycleMs / 1000 / n, i === 0 ? 2 : 0);
}
function polyStart(){
  const ctx = ensureAudio();
  poly.ctx = ctx;
  polyRebuild();
  poly.eventIdx = 0; poly.cycleCount = 0;
  const lead = 0.08 + (poly.countIn ? poly.cycleMs / 1000 : 0);
  if(poly.countIn) polyCountIn(ctx.currentTime + 0.08);
  poly.cycleStartTime = ctx.currentTime + lead;
  if(metro.playing) metroStop();
  poly.timer = setInterval(polyScheduler, poly.LOOKAHEAD_MS);
  poly.playing = true;
  polyUpdatePlayBtn();
}
function polyPause(){
  clearInterval(poly.timer); poly.timer = null; poly.playing = false;
  polyUpdatePlayBtn();
}
function polyResume(){
  const ctx = poly.ctx || ensureAudio();
  poly.ctx = ctx;
  poly.cycleStartTime = ctx.currentTime + 0.05 - (poly.cycleCount * poly.cycleMs / 1000 + poly.events[poly.eventIdx].tMs / 1000);
  if(metro.playing) metroStop();
  poly.timer = setInterval(polyScheduler, poly.LOOKAHEAD_MS);
  poly.playing = true;
  polyUpdatePlayBtn();
}
function polyStop(){
  clearInterval(poly.timer); poly.timer = null; poly.playing = false;
  poly.eventIdx = 0; poly.cycleCount = 0;
  $('polyCycleCount').textContent = 'Cycle 0';
  polyUpdatePlayBtn();
}
function polyRestart(){ polyStop(); polyStart(); }
function polyTogglePlay(){
  if(poly.playing) polyPause();
  else if(poly.ctx && poly.events.length && (poly.eventIdx || poly.cycleCount)) polyResume();
  else polyStart();
}
function polyUpdatePlayBtn(){
  $('polyPlay').innerHTML = poly.playing ? '&#10074;&#10074;' : '&#9654;';
  $('polyPlay').setAttribute('aria-label', poly.playing ? 'Pause polyrhythm' : 'Play polyrhythm');
}
function polySetTempo(bpm){
  poly.bpm = Math.max(20, Math.min(300, Math.round(bpm)));
  $('polyBpm').value = poly.bpm; $('polyBpmSlider').value = poly.bpm;
  if(poly.playing){
    const ctx = poly.ctx;
    polyRebuild();
    poly.eventIdx = 0; poly.cycleCount = 0;
    poly.cycleStartTime = ctx.currentTime + 0.05;
  } else polyRebuild();
}
```

Wire the transport controls inside `renderPoly()`'s `if(!polyInited){...}` block (append to it):

```js
    $('polyPlay').onclick = polyTogglePlay;
    $('polyRestart').onclick = polyRestart;
    $('polyStop').onclick = polyStop;
    $('polyBpm').addEventListener('change', () => polySetTempo(+$('polyBpm').value));
    $('polyBpmSlider').addEventListener('input', () => polySetTempo(+$('polyBpmSlider').value));
    $('polyBpmRef').addEventListener('change', () => { poly.bpmRef = $('polyBpmRef').value; if(poly.playing) polySetTempo(poly.bpm); else polyRebuild(); });
    $('polyCountIn').addEventListener('change', () => { poly.countIn = $('polyCountIn').checked; });
```

Also update `polySetRatio` (Task 3) to keep the scheduler in sync when ratio changes mid-play — replace its body's final line `polyRenderAnalysis();` with:

```js
  polyRenderAnalysis();
  if(poly.playing){
    const ctx = poly.ctx;
    polyRebuild();
    poly.eventIdx = 0; poly.cycleCount = 0;
    poly.cycleStartTime = ctx.currentTime + 0.05;
  } else if(poly.ctx) polyRebuild();
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node tests/smoke.js
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Add polyrhythm Web Audio lookahead scheduler and transport controls"
```

---

### Task 5: Volume, mute/solo, subdivision click, audio toggle

**Files:**
- Modify: `index.html`
- Test: `tests/smoke.js`

**Interfaces:**
- Consumes: `poly.playing`, `polyClick` (Task 4)
- Produces: `poly.volA/volB/muteA/muteB/soloA/soloB/subClick/audioOn`, updates `polyClick` to respect them.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/smoke.js
```
Expected: FAIL — controls don't exist.

- [ ] **Step 3: Add markup**

Add inside `#viewPoly`, after the transport `.keyhead` block from Task 4:

```html
    <div class="controls">
      <div class="ctl"><label for="polyVolA">Rhythm A volume</label><input id="polyVolA" type="range" min="0" max="1" step="0.05" value="0.8"></div>
      <div class="ctl"><label>&nbsp;</label><button id="polyMuteA" class="mbtn" aria-label="Mute rhythm A">Mute A</button></div>
      <div class="ctl"><label>&nbsp;</label><button id="polySoloA" class="mbtn" aria-label="Solo rhythm A">Solo A</button></div>
      <div class="ctl"><label for="polyVolB">Rhythm B volume</label><input id="polyVolB" type="range" min="0" max="1" step="0.05" value="0.8"></div>
      <div class="ctl"><label>&nbsp;</label><button id="polyMuteB" class="mbtn" aria-label="Mute rhythm B">Mute B</button></div>
      <div class="ctl"><label>&nbsp;</label><button id="polySoloB" class="mbtn" aria-label="Solo rhythm B">Solo B</button></div>
      <div class="ctl"><label><input id="polySubClick" type="checkbox"> Subdivision click</label></div>
      <div class="ctl"><label><input id="polyAudioOn" type="checkbox" checked> Audio on</label></div>
    </div>
```

- [ ] **Step 4: Implement**

Extend the `Object.assign(poly, {...})` call from Task 4 to include:

```js
  volA: 0.8, volB: 0.8, muteA: false, muteB: false, soloA: false, soloB: false,
  subClick: false, audioOn: true,
```

Replace `polyClick` (Task 4) with a version that respects these:

```js
function polyClick(time, ev){
  if(!poly.audioOn) return;
  const solo = poly.soloA || poly.soloB;
  const playA = ev.isA && !poly.muteA && (!solo || poly.soloA);
  const playB = ev.isB && !poly.muteB && (!solo || poly.soloB);
  const ctx = poly.ctx;
  if(!playA && !playB){
    if(poly.subClick && ev.grid){
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 300;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.12, time + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);
      osc.connect(g); g.connect(metro.bus);
      osc.start(time); osc.stop(time + 0.03);
    }
    return;
  }
  const both = playA && playB, osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = both ? 'square' : playA ? 'triangle' : 'sine';
  osc.frequency.value = both ? 1568 : playA ? 880 : 587;
  const vol = both ? 0.9 : 0.6 * (playA ? poly.volA : poly.volB);
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(vol, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  osc.connect(g); g.connect(metro.bus);
  osc.start(time); osc.stop(time + 0.06);
}
```

Also update `polyScheduler` (Task 4) — remove the `if(ev.isA || ev.isB)` guard around `polyClick(t, ev)` since `polyClick` now decides for itself (needed for the subdivision-click path to fire on grid-only events too):

```js
    polyClick(t, ev);
```

Wire the new controls inside `renderPoly()`'s init block:

```js
    $('polyVolA').addEventListener('input', () => poly.volA = +$('polyVolA').value);
    $('polyVolB').addEventListener('input', () => poly.volB = +$('polyVolB').value);
    $('polyMuteA').onclick = () => { poly.muteA = !poly.muteA; $('polyMuteA').classList.toggle('playing', poly.muteA); };
    $('polyMuteB').onclick = () => { poly.muteB = !poly.muteB; $('polyMuteB').classList.toggle('playing', poly.muteB); };
    $('polySoloA').onclick = () => { poly.soloA = !poly.soloA; $('polySoloA').classList.toggle('playing', poly.soloA); };
    $('polySoloB').onclick = () => { poly.soloB = !poly.soloB; $('polySoloB').classList.toggle('playing', poly.soloB); };
    $('polySubClick').addEventListener('change', () => poly.subClick = $('polySubClick').checked);
    $('polyAudioOn').addEventListener('change', () => poly.audioOn = $('polyAudioOn').checked);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node tests/smoke.js
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Add polyrhythm volume, mute/solo, subdivision click, audio toggle"
```

---

### Task 6: Circular + linear visualization

**Files:**
- Modify: `index.html`
- Test: `tests/smoke.js`

**Interfaces:**
- Consumes: `poly.a/b`, `poly.playing`, `poly.ctx`, `poly.cycleMs`, `poly.cycleStartTime`, `polyPulses` (Task 1)
- Produces: `polyRenderShapes()` (redraws both SVGs on ratio change), `polyRAF()` (rAF loop, playhead only), `polyFlash(ev, delayMs)` (called from the scheduler on each strike).

- [ ] **Step 1: Write the failing test**

```js
  await p.click('.tabbtn[data-tab="poly"]');
  const dots = await p.evaluate(() => document.querySelectorAll('#polyCircSvg .polydot').length + document.querySelectorAll('#polyLinSvg .polydot').length);
  assert('poly: visualization renders pulse dots for both views', dots > 0);
  await p.click('#polyPlay');
  await p.waitForTimeout(200);
  const angle1 = await p.evaluate(() => $('polyPlayheadCirc').getAttribute('transform'));
  await p.waitForTimeout(300);
  const angle2 = await p.evaluate(() => $('polyPlayheadCirc').getAttribute('transform'));
  assert('poly: circular playhead rotates during playback', angle1 !== angle2);
  await p.click('#polyStop');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/smoke.js
```
Expected: FAIL — `#polyCircSvg`/`#polyLinSvg` don't exist.

- [ ] **Step 3: Add markup + CSS**

Add inside `#viewPoly`, after the audio controls block from Task 5:

```html
    <div class="hgbox">
      <div class="keyhead"><span class="keyname">Circular view</span></div>
      <div class="polywrap"><svg id="polyCircSvg" viewBox="0 0 220 220" role="img" aria-label="Circular polyrhythm visualization"></svg></div>
      <div class="keyhead"><span class="keyname">Linear grid</span><span class="sub" id="polyCyclePct" style="margin:0 0 0 auto">0%</span></div>
      <div style="overflow-x:auto"><svg id="polyLinSvg" viewBox="0 0 300 84" role="img" aria-label="Linear grid polyrhythm visualization"></svg></div>
    </div>
```

Add to the `<style>` block, near the other component-specific rules (e.g. after `.pgbar` rules around `index.html:80`):

```css
.polywrap{display:flex;justify-content:center;margin-bottom:10px}
#polyCircSvg{width:220px;height:220px}
#polyLinSvg{width:100%;height:84px;min-width:300px}
.polydot{fill:var(--panel2);stroke:var(--accent2);stroke-width:1.5}
.polydot.rb{stroke:var(--accent)}
.polydot.shared{stroke-width:2.5}
.polydot.hit{fill:var(--accent2)}
.polydot.rb.hit{fill:var(--accent)}
.polyspoke{stroke:var(--accent);stroke-width:1;stroke-dasharray:2 2;opacity:.6}
#polyPlayheadCirc,#polyPlayheadLin{stroke:var(--accent2);stroke-width:2}
@media (prefers-reduced-motion: reduce){ #polyPlayheadCirc,#polyPlayheadLin{display:none} }
```

- [ ] **Step 4: Implement rendering**

Add after the Task 5 wiring code:

```js
function polyRenderCircular(){
  const { lcm, a: pa, b: pb } = polyPulses(poly.a, poly.b);
  const cx = 110, cy = 110, rA = 90, rB = 60;
  const setB = new Set(pb);
  let s = `<circle cx="${cx}" cy="${cy}" r="${rA}" fill="none" stroke="var(--border)"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${rB}" fill="none" stroke="var(--border)"/>`;
  pa.forEach((i, n) => {
    const shared = setB.has(i), ang = (i / lcm) * 2 * Math.PI - Math.PI / 2;
    if(shared) s += `<line class="polyspoke" x1="${cx}" y1="${cy}" x2="${cx + rA * Math.cos(ang)}" y2="${cy + rA * Math.sin(ang)}"/>`;
    s += `<circle class="polydot ra${shared ? ' shared' : ''}" data-idx="a${n}" cx="${cx + rA * Math.cos(ang)}" cy="${cy + rA * Math.sin(ang)}" r="7"/>`;
  });
  pb.forEach((i, n) => {
    const shared = pa.includes(i), ang = (i / lcm) * 2 * Math.PI - Math.PI / 2;
    const x = cx + rB * Math.cos(ang), y = cy + rB * Math.sin(ang);
    s += `<rect class="polydot rb${shared ? ' shared' : ''}" data-idx="b${n}" x="${x - 6}" y="${y - 6}" width="12" height="12"/>`;
  });
  s += `<line id="polyPlayheadCirc" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - rA - 10}" transform="rotate(0 ${cx} ${cy})"/>`;
  $('polyCircSvg').innerHTML = s;
}
function polyRenderLinear(){
  const { lcm, a: pa, b: pb } = polyPulses(poly.a, poly.b);
  const w = Math.max(280, lcm * 24), rowA = 22, rowB = 62;
  poly.gridWidth = w;
  const setA = new Set(pa), setB = new Set(pb);
  let s = `<line x1="0" y1="${rowA}" x2="${w}" y2="${rowA}" stroke="var(--border)"/>`;
  s += `<line x1="0" y1="${rowB}" x2="${w}" y2="${rowB}" stroke="var(--border)"/>`;
  for(let i = 0; i < lcm; i++){
    const x = (i / lcm) * w + w / lcm / 2, shared = setA.has(i) && setB.has(i);
    if(shared) s += `<line class="polyspoke" x1="${x}" y1="${rowA}" x2="${x}" y2="${rowB}"/>`;
    if(setA.has(i)) s += `<circle class="polydot ra${shared ? ' shared' : ''}" data-idx="a${pa.indexOf(i)}" cx="${x}" cy="${rowA}" r="7"/>`;
    if(setB.has(i)) s += `<rect class="polydot rb${shared ? ' shared' : ''}" data-idx="b${pb.indexOf(i)}" x="${x - 6}" y="${rowB - 6}" width="12" height="12"/>`;
  }
  s += `<line id="polyPlayheadLin" x1="0" y1="4" x2="0" y2="80"/>`;
  $('polyLinSvg').setAttribute('viewBox', `0 0 ${w} 84`);
  $('polyLinSvg').innerHTML = s;
}
function polyRenderShapes(){ polyRenderCircular(); polyRenderLinear(); }
function polyFlash(ev, delayMs){
  setTimeout(() => {
    document.querySelectorAll('.polydot.hit').forEach(el => el.classList.remove('hit'));
    if(ev.isA) document.querySelectorAll(`.polydot[data-idx="a${ev.aIdx}"]`).forEach(el => el.classList.add('hit'));
    if(ev.isB) document.querySelectorAll(`.polydot[data-idx="b${ev.bIdx}"]`).forEach(el => el.classList.add('hit'));
  }, Math.max(delayMs, 0));
}
const polyReduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function polyRAF(){
  poly.rafId = requestAnimationFrame(polyRAF);
  if(!poly.playing || !poly.ctx || polyReduceMotion) return;
  const cycleSec = poly.cycleMs / 1000;
  if(cycleSec <= 0) return;
  const elapsed = poly.ctx.currentTime - poly.cycleStartTime;
  const frac = ((elapsed % cycleSec) + cycleSec) % cycleSec / cycleSec;
  $('polyPlayheadCirc').setAttribute('transform', `rotate(${frac * 360} 110 110)`);
  $('polyPlayheadLin').setAttribute('x1', frac * poly.gridWidth); $('polyPlayheadLin').setAttribute('x2', frac * poly.gridWidth);
  $('polyCyclePct').textContent = Math.round(frac * 100) + '%';
}
```

Call `polyClick` from the scheduler now also triggers a flash — update `polyScheduler` (Task 4/5) to call `polyFlash` right after `polyClick(t, ev)`:

```js
    polyClick(t, ev);
    polyFlash(ev, (t - poly.ctx.currentTime) * 1000);
```

Update `polySetRatio` (Task 3) to redraw shapes — append `polyRenderShapes();` right after `polyRenderAnalysis();` in its body.

Update `renderPoly()` to draw shapes on first entry and start the rAF loop once:

```js
function renderPoly(){
  if(!polyInited){
    polyInited = true;
    /* ...existing wiring from Tasks 3-5... */
    requestAnimationFrame(polyRAF);
  }
  polyRenderAnalysis();
  polyRenderShapes();
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node tests/smoke.js
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Add polyrhythm circular and linear-grid visualizations"
```

---

### Task 7: Event table + collapsible detail

**Files:**
- Modify: `index.html`
- Test: `tests/smoke.js`

**Interfaces:**
- Consumes: `polyEvents`, `poly.a/b`, `poly.cycleMs` (falls back to a nominal 1000ms cycle for display when not yet computed)
- Produces: `polyRenderEventTable()`

- [ ] **Step 1: Write the failing test**

```js
  await p.click('#polyEventTableToggle');
  const rows = await p.evaluate(() => document.querySelectorAll('#polyEventTable tbody tr').length);
  assert('poly: event table shows one row per shared subdivision event', rows > 0);
  const headerText = await p.evaluate(() => $('polyEventTable').textContent);
  assert('poly: event table has expected columns', headerText.includes('%') && headerText.includes('Shared'));
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/smoke.js
```
Expected: FAIL — `#polyEventTableToggle` doesn't exist.

- [ ] **Step 3: Add markup**

Add inside `#viewPoly`, after the `.hgbox` visualization block from Task 6:

```html
    <button id="polyEventTableToggle" class="mbtn" style="width:auto;padding:0 12px;margin-bottom:8px">Show event table</button>
    <table class="stbl" id="polyEventTable" style="display:none">
      <thead><tr><th>#</th><th>Time (ms)</th><th>% cycle</th><th>A</th><th>B</th><th>Shared</th></tr></thead>
      <tbody></tbody>
    </table>
```

- [ ] **Step 4: Implement**

```js
function polyRenderEventTable(){
  const cycleMs = poly.cycleMs || (60000 / poly.bpm);
  const evs = polyEvents(poly.a, poly.b, cycleMs, poly.phaseMsB || 0).filter(e => e.isA || e.isB);
  const rows = evs.map((e, n) =>
    `<tr><td>${n + 1}</td><td>${Math.round(e.tMs)}</td><td>${Math.round(e.tMs / cycleMs * 100)}%</td>` +
    `<td>${e.isA ? '✓' : ''}</td><td>${e.isB ? '✓' : ''}</td><td>${e.isA && e.isB ? '✓' : ''}</td></tr>`).join('');
  $('polyEventTable').querySelector('tbody').innerHTML = rows;
}
```

Wire the toggle button and call the render function inside `renderPoly()`'s init block:

```js
    $('polyEventTableToggle').onclick = () => {
      const show = $('polyEventTable').style.display === 'none';
      $('polyEventTable').style.display = show ? '' : 'none';
      $('polyEventTableToggle').textContent = show ? 'Hide event table' : 'Show event table';
      if(show) polyRenderEventTable();
    };
```

Also call `polyRenderEventTable()` from `polySetRatio` (Task 3) when the table is visible — append to `polySetRatio`:

```js
  if($('polyEventTable').style.display !== 'none') polyRenderEventTable();
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node tests/smoke.js
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Add polyrhythm event table"
```

---

### Task 8: Practice modes (listen & follow, isolation, alternating focus, progressive tempo, random challenge)

**Files:**
- Modify: `index.html`
- Test: `tests/smoke.js`

**Interfaces:**
- Consumes: `poly.playing`, `polySetTempo`, `poly.muteA/muteB/volA/volB` (Task 5), scheduler cycle-boundary point in `polyScheduler` (Task 4)
- Produces: `poly.mode`, `practiceModeReset()`, `practiceModeOnCycle(count)`, `generateRandomChallenge(cfg)` (pure, independently testable)

- [ ] **Step 1: Write the failing test**

```js
  const rc = await p.evaluate(() => {
    const results = [];
    for(let i = 0; i < 50; i++) results.push(generateRandomChallenge({ min: 3, max: 8, maxLcm: 20, minBpm: 60, maxBpm: 90, allowReducible: false }));
    return results;
  });
  assert('poly: random challenge stays within min/max/maxLcm/tempo bounds',
    rc.every(r => r.a >= 3 && r.a <= 8 && r.b >= 3 && r.b <= 8 && lcmOf(r.a, r.b) <= 20 && r.bpm >= 60 && r.bpm <= 90 && gcdOf(r.a, r.b) === 1));

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/smoke.js
```
Expected: FAIL — `generateRandomChallenge`, `practiceModeReset`, `practiceModeOnCycle` don't exist.

- [ ] **Step 3: Add markup**

Add inside `#viewPoly`, after the event table from Task 7:

```html
    <div class="hgbox">
      <div class="keyhead"><span class="keyname">Practice mode</span></div>
      <div class="controls">
        <div class="ctl"><label for="polyMode">Mode</label><select id="polyMode">
          <option value="none" selected>Listen &amp; follow</option>
          <option value="isolation">Rhythm isolation</option>
          <option value="alternate">Alternating focus</option>
          <option value="progressive">Progressive tempo</option>
          <option value="random">Random challenge</option>
        </select></div>
        <div class="ctl" id="polyModeCyclesWrap"><label for="polyModeCycles">Cycles per phase</label><input id="polyModeCycles" type="number" min="1" max="32" value="4"></div>
        <div class="ctl" id="polyIsoSideWrap" style="display:none"><label for="polyIsoSide">Fade out</label><select id="polyIsoSide"><option value="a">Rhythm A</option><option value="b">Rhythm B</option></select></div>
        <div class="ctl" id="polyProgWrap" style="display:none">
          <label for="polyProgStep">Tempo step</label><select id="polyProgStep"><option value="1">+1</option><option value="2">+2</option><option value="5" selected>+5</option><option value="10">+10</option></select>
        </div>
        <div class="ctl" id="polyProgMaxWrap" style="display:none"><label for="polyProgMax">Max BPM</label><input id="polyProgMax" type="number" min="20" max="300" value="160"></div>
      </div>
      <div class="controls" id="polyRandWrap" style="display:none">
        <div class="ctl"><label for="polyRandMin">Min value</label><input id="polyRandMin" type="number" min="1" max="16" value="2"></div>
        <div class="ctl"><label for="polyRandMax">Max value</label><input id="polyRandMax" type="number" min="1" max="16" value="9"></div>
        <div class="ctl"><label for="polyRandMaxLcm">Max LCM</label><input id="polyRandMaxLcm" type="number" min="4" max="240" value="40"></div>
        <div class="ctl"><label for="polyRandMinBpm">Min BPM</label><input id="polyRandMinBpm" type="number" min="20" max="300" value="60"></div>
        <div class="ctl"><label for="polyRandMaxBpm">Max BPM</label><input id="polyRandMaxBpm" type="number" min="20" max="300" value="120"></div>
        <div class="ctl"><label><input id="polyRandAllowReducible" type="checkbox"> Allow reducible ratios</label></div>
        <div class="ctl"><label><input id="polyRandHide" type="checkbox"> Hide ratio until reveal</label></div>
        <div class="ctl"><label>&nbsp;</label><button id="polyRandGenerate">Generate challenge</button></div>
        <div class="ctl" id="polyRandRevealWrap" style="display:none"><label>&nbsp;</label><button id="polyRandReveal">Reveal ratio</button></div>
      </div>
      <p class="sub" id="polyModeStatus"></p>
    </div>
```

- [ ] **Step 4: Implement**

Add pure generator + mode state machine after the Task 7 code:

```js
function generateRandomChallenge(cfg){
  let a = cfg.min, b = cfg.min, tries = 0;
  do {
    a = cfg.min + Math.floor(Math.random() * (cfg.max - cfg.min + 1));
    b = cfg.min + Math.floor(Math.random() * (cfg.max - cfg.min + 1));
    tries++;
  } while(tries < 300 && (a === b || lcmOf(a, b) > cfg.maxLcm || (!cfg.allowReducible && gcdOf(a, b) !== 1)));
  const bpm = cfg.minBpm + Math.round(Math.random() * (cfg.maxBpm - cfg.minBpm));
  return { a, b, bpm };
}
Object.assign(poly, { mode: 'none', modeCycles: 4, modeCfg: {}, modeState: {}, phaseMsB: 0 });
function practiceModeReset(){
  poly.modeState = { cyclesInPhase: 0, phase: 'a' };
  poly.muteA = false; poly.muteB = false; poly.volA = +$('polyVolA').value; poly.volB = +$('polyVolB').value;
  applyPracticeMode();
}
function applyPracticeMode(){
  if(poly.mode === 'isolation'){
    const side = poly.modeCfg.isolateSide || 'b';
    const frac = Math.min(1, poly.modeState.cyclesInPhase / Math.max(1, poly.modeCycles));
    const baseVol = 0.8;
    if(side === 'a') poly.volA = baseVol * (1 - frac); else poly.volB = baseVol * (1 - frac);
  } else if(poly.mode === 'alternate'){
    const phase = poly.modeState.phase;
    poly.muteA = phase === 'b'; poly.muteB = phase === 'a';
  }
  polyRenderModeStatus();
}
function practiceModeOnCycle(count){
  if(poly.mode === 'none' || poly.mode === 'random') return;
  poly.modeState.cyclesInPhase++;
  if(poly.mode === 'isolation'){
    applyPracticeMode();
  } else if(poly.mode === 'alternate'){
    if(poly.modeState.cyclesInPhase >= poly.modeCycles){
      poly.modeState.cyclesInPhase = 0;
      poly.modeState.phase = poly.modeState.phase === 'a' ? 'b' : poly.modeState.phase === 'b' ? 'both' : 'a';
      applyPracticeMode();
    }
  } else if(poly.mode === 'progressive'){
    if(poly.modeState.cyclesInPhase >= poly.modeCycles){
      poly.modeState.cyclesInPhase = 0;
      const step = poly.modeCfg.step || 5, max = poly.modeCfg.maxBpm || 200;
      if(poly.bpm < max) polySetTempo(Math.min(max, poly.bpm + step));
    }
  }
  polyRenderModeStatus();
}
function polyRenderModeStatus(){
  if(poly.mode === 'alternate') $('polyModeStatus').textContent = 'Focus: ' + poly.modeState.phase.toUpperCase();
  else if(poly.mode === 'isolation') $('polyModeStatus').textContent = `Fading ${(poly.modeCfg.isolateSide || 'b').toUpperCase()} — vol A ${poly.volA.toFixed(2)}, vol B ${poly.volB.toFixed(2)}`;
  else if(poly.mode === 'progressive') $('polyModeStatus').textContent = `Tempo ${poly.bpm} BPM (max ${poly.modeCfg.maxBpm || 200})`;
  else $('polyModeStatus').textContent = '';
}
```

Hook `practiceModeOnCycle` into the scheduler's cycle-boundary point — in `polyScheduler` (Task 4), inside the `if(poly.eventIdx >= poly.events.length){...}` block, change the `setTimeout` body to also call it:

```js
      setTimeout(() => { $('polyCycleCount').textContent = 'Cycle ' + poly.cycleCount; practiceModeOnCycle(poly.cycleCount); }, Math.max(delay, 0));
```

Wire mode UI inside `renderPoly()`'s init block:

```js
    $('polyMode').addEventListener('change', () => {
      poly.mode = $('polyMode').value;
      $('polyIsoSideWrap').style.display = poly.mode === 'isolation' ? '' : 'none';
      $('polyProgWrap').style.display = poly.mode === 'progressive' ? '' : 'none';
      $('polyProgMaxWrap').style.display = poly.mode === 'progressive' ? '' : 'none';
      $('polyRandWrap').style.display = poly.mode === 'random' ? '' : 'none';
      $('polyModeCyclesWrap').style.display = poly.mode === 'random' ? 'none' : '';
      practiceModeReset();
    });
    $('polyModeCycles').addEventListener('change', () => { poly.modeCycles = Math.max(1, +$('polyModeCycles').value); });
    $('polyIsoSide').addEventListener('change', () => { poly.modeCfg.isolateSide = $('polyIsoSide').value; practiceModeReset(); });
    $('polyProgStep').addEventListener('change', () => { poly.modeCfg.step = +$('polyProgStep').value; });
    $('polyProgMax').addEventListener('change', () => { poly.modeCfg.maxBpm = +$('polyProgMax').value; });
    $('polyRandGenerate').onclick = () => {
      const cfg = {
        min: +$('polyRandMin').value, max: +$('polyRandMax').value, maxLcm: +$('polyRandMaxLcm').value,
        minBpm: +$('polyRandMinBpm').value, maxBpm: +$('polyRandMaxBpm').value,
        allowReducible: $('polyRandAllowReducible').checked,
      };
      const ch = generateRandomChallenge(cfg);
      poly.pendingChallenge = ch;
      const hide = $('polyRandHide').checked;
      $('polyRandRevealWrap').style.display = hide ? '' : 'none';
      if(hide){ $('polyRatioTitle').textContent = '? : ?'; polySetTempo(ch.bpm); }
      else { polySetRatio(ch.a, ch.b); polySetTempo(ch.bpm); }
    };
    $('polyRandReveal').onclick = () => { if(poly.pendingChallenge) polySetRatio(poly.pendingChallenge.a, poly.pendingChallenge.b); };
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node tests/smoke.js
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Add polyrhythm practice modes (isolation, alternating focus, progressive tempo, random challenge)"
```

---

### Task 9: Phase offset, delayed entry, keyboard shortcuts, reset-to-default

**Files:**
- Modify: `index.html`
- Test: `tests/smoke.js`

**Interfaces:**
- Consumes: `poly.phaseMsB`, `poly.cycleMs`, `polyRebuild` (Task 4)
- Produces: `polySetPhase(ms)` (keeps 4 representations in sync), keyboard shortcuts scoped to the Poly tab, `polyResetDefaults()`

- [ ] **Step 1: Write the failing test**

```js
  await p.click('.tabbtn[data-tab="poly"]');
  await p.click('.chip[data-a="3"][data-b="4"]');
  await p.evaluate(() => polySetTempo(90));
  await p.fill('#polyPhasePct', '25');
  await p.dispatchEvent('#polyPhasePct', 'change');
  const synced = await p.evaluate(() => ({ deg: +$('polyPhaseDeg').value, sub: +$('polyPhaseSub').value }));
  assert('poly: phase offset syncs degrees/subdivisions from %', Math.abs(synced.deg - 90) < 1 && Math.abs(synced.sub - 3) < 0.01);

  await p.keyboard.press('Space');
  await p.waitForTimeout(150);
  const playing1 = await p.evaluate(() => poly.playing);
  assert('poly: spacebar toggles play when Poly tab is active', playing1 === true);
  await p.keyboard.press('Space');

  await p.click('#polyReset');
  const reset = await p.evaluate(() => ({ a: poly.a, b: poly.b, bpm: poly.bpm, phase: poly.phaseMsB }));
  assert('poly: reset restores defaults', reset.a === 3 && reset.b === 4 && reset.bpm === 90 && reset.phase === 0);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/smoke.js
```
Expected: FAIL — `#polyPhasePct`/`#polyReset` don't exist, spacebar does nothing.

- [ ] **Step 3: Add markup**

Add inside `#viewPoly`, after the practice-mode `.hgbox` from Task 8:

```html
    <div class="hgbox">
      <div class="keyhead"><span class="keyname">Advanced</span></div>
      <div class="controls">
        <div class="ctl"><label for="polyPhaseDeg">Phase offset (°)</label><input id="polyPhaseDeg" type="number" min="0" max="359" value="0"></div>
        <div class="ctl"><label for="polyPhaseSub">Phase offset (subdivisions)</label><input id="polyPhaseSub" type="number" min="0" step="0.1" value="0"></div>
        <div class="ctl"><label for="polyPhaseMs">Phase offset (ms)</label><input id="polyPhaseMs" type="number" min="0" value="0"></div>
        <div class="ctl"><label for="polyPhasePct">Phase offset (%)</label><input id="polyPhasePct" type="number" min="0" max="99.9" step="0.1" value="0"></div>
        <div class="ctl"><label for="polyDelayCycles">Delay Rhythm B entry (cycles)</label><input id="polyDelayCycles" type="number" min="0" max="16" value="0"></div>
        <div class="ctl"><label>&nbsp;</label><button id="polyReset">Reset to defaults</button></div>
      </div>
      <p class="sub">Keyboard (while this tab is focused): Space = play/pause, R = restart, ↑/↓ = tempo ±1.</p>
    </div>
```

- [ ] **Step 4: Implement**

```js
function polySetPhase(pct){
  const cycleMs = poly.cycleMs || (60000 / poly.bpm);
  poly.phaseMsB = Math.max(0, Math.min(cycleMs * 0.999, cycleMs * pct / 100));
  const lcm = lcmOf(poly.a, poly.b);
  $('polyPhasePct').value = (poly.phaseMsB / cycleMs * 100).toFixed(1);
  $('polyPhaseDeg').value = Math.round(poly.phaseMsB / cycleMs * 360);
  $('polyPhaseSub').value = (poly.phaseMsB / cycleMs * lcm).toFixed(2);
  $('polyPhaseMs').value = Math.round(poly.phaseMsB);
  if(poly.ctx) polyRebuild();
}
function polyDefaults(){
  return { a: 3, b: 4, bpm: 90, bpmRef: 'cycle', volA: 0.8, volB: 0.8, muteA: false, muteB: false,
    soloA: false, soloB: false, subClick: false, audioOn: true, mode: 'none', modeCycles: 4,
    phaseMsB: 0, delayCycles: 0 };
}
function polyResetDefaults(){
  const d = polyDefaults();
  Object.assign(poly, d);
  polyStop();
  $('polyBpm').value = d.bpm; $('polyBpmSlider').value = d.bpm; $('polyBpmRef').value = d.bpmRef;
  $('polyVolA').value = d.volA; $('polyVolB').value = d.volB;
  $('polyMuteA').classList.remove('playing'); $('polyMuteB').classList.remove('playing');
  $('polySoloA').classList.remove('playing'); $('polySoloB').classList.remove('playing');
  $('polySubClick').checked = d.subClick; $('polyAudioOn').checked = d.audioOn;
  $('polyMode').value = d.mode; $('polyModeCycles').value = d.modeCycles;
  $('polyDelayCycles').value = d.delayCycles;
  polySetRatio(d.a, d.b);
  polySetPhase(0);
}
```

Wire inside `renderPoly()`'s init block:

```js
    ['polyPhaseDeg','polyPhaseSub','polyPhaseMs','polyPhasePct'].forEach(id => {
      $(id).addEventListener('change', () => {
        const cycleMs = poly.cycleMs || (60000 / poly.bpm), lcm = lcmOf(poly.a, poly.b);
        let pct;
        if(id === 'polyPhaseDeg') pct = +$(id).value / 360 * 100;
        else if(id === 'polyPhaseSub') pct = +$(id).value / lcm * 100;
        else if(id === 'polyPhaseMs') pct = +$(id).value / cycleMs * 100;
        else pct = +$(id).value;
        polySetPhase(pct);
      });
    });
    $('polyDelayCycles').addEventListener('change', () => poly.delayCycles = Math.max(0, +$('polyDelayCycles').value));
    $('polyReset').onclick = polyResetDefaults;
    document.addEventListener('keydown', e => {
      if(currentTab !== 'poly') return;
      const tag = (e.target.tagName || '').toLowerCase();
      if(tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if(e.code === 'Space'){ e.preventDefault(); polyTogglePlay(); }
      else if(e.code === 'KeyR'){ e.preventDefault(); polyRestart(); }
      else if(e.code === 'ArrowUp'){ e.preventDefault(); polySetTempo(poly.bpm + 1); }
      else if(e.code === 'ArrowDown'){ e.preventDefault(); polySetTempo(poly.bpm - 1); }
    });
```

Delayed entry of Rhythm B: in `polyClick` (Task 5), gate B (and shared) hits during the delay window — add at the top of the function, right after `if(!poly.audioOn) return;`:

```js
  if(ev.isB && !ev.isA && poly.cycleCount < (poly.delayCycles || 0)) return;
```

(Shared strikes still play their A component during the delay window since `ev.isA` is true for those; a pure-B strike is silent until Rhythm B "enters".)

- [ ] **Step 5: Run test to verify it passes**

```bash
node tests/smoke.js
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Add polyrhythm phase offset, delayed entry, keyboard shortcuts, reset"
```

---

### Task 10: Persistence

**Files:**
- Modify: `index.html`
- Test: `tests/smoke.js`

**Interfaces:**
- Consumes: `poly.*` fields (all prior tasks)
- Produces: `polyStore.load()/save(d)`, `polySavePrefs()`, `polyLoadPrefs()`

- [ ] **Step 1: Write the failing test**

```js
  await p.click('.tabbtn[data-tab="poly"]');
  await p.click('.chip[data-a="4"][data-b="5"]');
  await p.evaluate(() => polySetTempo(120));
  await p.reload();
  await p.waitForTimeout(1200);
  await p.click('.tabbtn[data-tab="poly"]');
  const persisted = await p.evaluate(() => ({ a: poly.a, b: poly.b, bpm: poly.bpm }));
  assert('poly: ratio and tempo persist across reload', persisted.a === 4 && persisted.b === 5 && persisted.bpm === 120);
  await p.click('.tabbtn[data-tab="ex"]');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/smoke.js
```
Expected: FAIL — preferences reset to 3:4/90 on reload.

- [ ] **Step 3: Implement**

```js
const polyStore = {
  load(){ try{ return JSON.parse(localStorage.getItem('gphPoly') || '{}'); }catch(e){ return {}; } },
  save(d){ try{ localStorage.setItem('gphPoly', JSON.stringify(d)); }catch(e){} },
};
function polySavePrefs(){
  polyStore.save({
    a: poly.a, b: poly.b, bpm: poly.bpm, bpmRef: poly.bpmRef,
    volA: poly.volA, volB: poly.volB, muteA: poly.muteA, muteB: poly.muteB,
    subClick: poly.subClick, audioOn: poly.audioOn,
    mode: poly.mode, modeCycles: poly.modeCycles, phaseMsB: poly.phaseMsB, delayCycles: poly.delayCycles,
  });
}
function polyLoadPrefs(){
  const p = polyStore.load();
  if(!p || p.a === undefined) return;
  Object.assign(poly, {
    a: p.a, b: p.b, bpm: p.bpm || 90, bpmRef: p.bpmRef || 'cycle',
    volA: p.volA ?? 0.8, volB: p.volB ?? 0.8, muteA: !!p.muteA, muteB: !!p.muteB,
    subClick: !!p.subClick, audioOn: p.audioOn !== false,
    mode: p.mode || 'none', modeCycles: p.modeCycles || 4, phaseMsB: p.phaseMsB || 0, delayCycles: p.delayCycles || 0,
  });
  $('polyA').value = poly.a; $('polyB').value = poly.b;
  $('polyBpm').value = poly.bpm; $('polyBpmSlider').value = poly.bpm; $('polyBpmRef').value = poly.bpmRef;
  $('polyVolA').value = poly.volA; $('polyVolB').value = poly.volB;
  $('polyMuteA').classList.toggle('playing', poly.muteA); $('polyMuteB').classList.toggle('playing', poly.muteB);
  $('polySubClick').checked = poly.subClick; $('polyAudioOn').checked = poly.audioOn;
  $('polyMode').value = poly.mode; $('polyModeCycles').value = poly.modeCycles; $('polyDelayCycles').value = poly.delayCycles;
}
```

Call `polyLoadPrefs()` once at the very start of `renderPoly()`'s `if(!polyInited){...}` block (before wiring, so field values are correct when listeners read them), and call `polySavePrefs()` at the end of every setter that changes persisted state: append `polySavePrefs();` to the end of `polySetRatio`, `polySetTempo`, `polySetPhase`, and to each of the mute/solo/subClick/audioOn/mode/modeCycles/delayCycles inline handlers added in Tasks 5, 8, 9 (one line each, after the state mutation in that handler).

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/smoke.js
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Persist polyrhythm preferences to localStorage"
```

---

### Task 11: Cleanup on tab-leave, mobile check, final smoke pass

**Files:**
- Modify: `index.html`
- Test: `tests/smoke.js`

**Interfaces:**
- Consumes: everything above
- Produces: `polyTabLeave()` fully implemented (Task 2 stub)

- [ ] **Step 1: Write the failing test**

```js
  await p.click('.tabbtn[data-tab="poly"]');
  await p.click('#polyPlay');
  await p.waitForTimeout(200);
  await p.click('.tabbtn[data-tab="ex"]');
  const stopped = await p.evaluate(() => ({ playing: poly.playing, timer: poly.timer }));
  assert('poly: switching tabs away stops playback and clears the scheduler', !stopped.playing && stopped.timer === null);
```

Add a mobile-viewport check inside the existing `// ---------- mobile ----------` block (`tests/smoke.js:205-220`), right before `await p.context().close();`:

```js
  await p.click('.tabbtn[data-tab="poly"]');
  assert('mobile: poly tab opens and shows ratio controls', await p.locator('#polyA').isVisible());
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/smoke.js
```
Expected: FAIL — `poly.playing` stays `true` after switching tabs (no cleanup yet).

- [ ] **Step 3: Implement**

Replace the `polyTabLeave` stub (Task 2) with:

```js
function polyTabLeave(){
  if(poly.playing) polyPause();
}
```

(The rAF loop in `polyRAF` (Task 6) already no-ops when `!poly.playing`, so no separate `cancelAnimationFrame` bookkeeping is needed — it keeps polling cheaply, which matches how the rest of the app has no per-tab rAF teardown either.)

- [ ] **Step 4: Run the full suite**

```bash
node tests/smoke.js
```
Expected: every assertion in the file prints PASS, `no page errors` at the end.

- [ ] **Step 5: Manual browser check**

Per the project's `verify` skill: start `python -m http.server 8741`, open `http://localhost:8741/index.html`, click the Poly tab, and confirm by eye: presets change the ratio and pattern text, Play produces two audibly distinct clicks plus a louder combined click on shared strikes, both visualizations move together and the linear grid stays readable at a wide ratio (e.g. 7:8 → 56 columns), toggling `prefers-reduced-motion` in DevTools rendering emulation stops the playhead motion but flashes still work, and switching to another tab mid-play stops the sound.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Stop polyrhythm playback on tab switch; mobile smoke coverage"
```

---

## Post-plan note

Tap-accuracy/MIDI practice mode (mode 6 in the original spec) is intentionally out of scope — see `docs/superpowers/specs/2026-07-21-polyrhythm-visualizer-design.md` for why. If wanted later, it's a separate spec/plan cycle: it needs its own input-latency-aware tap evaluator, which nothing in this plan builds toward.
