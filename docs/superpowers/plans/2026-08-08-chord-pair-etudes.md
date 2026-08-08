# Chord Pair Études Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add nine hand-written triad-pair études to the Études tab, teaching the Ryan Devlin
methodology — a pair of triads per chord chosen by functional rule, interwoven rather than
arpeggiated.

**Architecture:** The études are static data in the existing `ETUDES` array. Four small code changes
support them: per-étude subdivision and bar count (replacing two module constants), a `tp` field
holding triad pairs as pitch classes so they transpose with the chords, an optional second line on
notation bar labels, and a sixth Technique filter value. No new dependencies, no new files.

**Tech Stack:** Vanilla HTML/CSS/JS in a single file (`index.html`), no build step. Tests are one
Playwright script (`tests/smoke.js`) driving the real page in headless Chrome.

## Global Constraints

- **Everything lives in `index.html`.** The single-file property is load-bearing — it is what makes
  the app installable as a PWA, usable offline, and shareable as a URL. Do not add files, imports,
  or a build step.
- **The existing 45 études must not change.** Every new field is optional and defaults to today's
  behaviour.
- **No new entries in `QUALITIES`.** `maj`, `min` and `aug` already exist and are all that is needed.
- **Do not add options to the Exercises tab's `#selTech` dropdown** (`index.html:621`). That control
  is picking-hand technique only.
- **Symbols follow `CHORD_SYM`** (`index.html:1836`) — `C`, `Dm`, `Caug`. Not `Δ`, `-`, `+`.
- **Prose matches the house voice**: second person, concrete, says what the hand has to solve. Read
  the `why` fields of the existing 45 before writing any.
- **Every bar fits a seven-fret window** — `max(fret) - min(fret) <= 6` over the non-open frets in
  that bar. Enforced by `tests/smoke.js:231`.
- **Comment style:** the codebase marks deliberate simplifications with `// ponytail:` comments that
  name the ceiling and the upgrade path. Follow that convention where the plan calls for one.

### Running the tests

From the repo root, in two shells:

```bash
python -m http.server 8741
```

```bash
npm i --no-save playwright-core && node tests/smoke.js
```

`GPH_URL` overrides the URL if port 8741 is taken. Every task below ends with a full smoke run;
the suite prints `PASS`/`FAIL` per assertion and exits non-zero on any failure.

---

### Task 1: Per-étude subdivision and bar count

Today `ET_NOTES_PER_BAR = 8` and `ET_NV = 'eighth'` are module constants (`index.html:2222`) used at
six sites. Make them per-étude, defaulting to today's values.

`markBarLines` needs **no change** — it already derives its tick size from `noteTicks(nv)`
(`index.html:3497`), which knows `triplet: 1/3`, so twelve triplet-eighths correctly fill one 4/4
bar.

**Files:**
- Modify: `index.html:2222` (constants → helpers), `index.html:4967-4971` (`etudePads`),
  `index.html:4984`, `index.html:4995`, `index.html:5004`, `index.html:5039`, `index.html:5054`
- Test: `tests/smoke.js:213-265` (shape assertion), `tests/smoke.js:350-360` (12-key note count)

**Interfaces:**
- Consumes: nothing.
- Produces: `etNv(et) -> 'eighth' | 'triplet'` and `etNpb(et) -> 8 | 12`, both used by every later
  task. `etudePads(chords, bar0, npb)` gains a third parameter.

- [ ] **Step 1: Write the failing test**

In `tests/smoke.js`, inside the `const et = await p.evaluate(...)` block that starts at line 213,
replace the shape check on line 221:

```js
      if(groups.length !== 4 || groups.some(g => g.length !== ET_NOTES_PER_BAR)) bad.shape.push(e.id);
```

with a per-étude version, and add a helper-contract check. The full replacement for that line:

```js
      if(groups.some(g => g.length !== etNpb(e))) bad.shape.push(e.id);
```

Then, immediately before `return { ...bad, empty, thin, count: ETUDES.length };` (line 256), add:

```js
    const helpers = {
      defaultNv:  etNv({}) === 'eighth',
      defaultNpb: etNpb({}) === 8,
      tripletNv:  etNv({nv:'triplet'}) === 'triplet',
      tripletNpb: etNpb({nv:'triplet'}) === 12,
    };
```

and include `helpers` in the returned object. Change the returned line to:

```js
    return { ...bad, empty, thin, helpers, count: ETUDES.length };
```

Then replace the assertion on line 259:

```js
  assert('etude: every étude is 4 bars of 8' + (et.shape.length ? ' — ' + et.shape.join(', ') : ''), et.shape.length === 0);
```

with:

```js
  assert('etude: every bar holds the étude\'s own note count' + (et.shape.length ? ' — ' + et.shape.join(', ') : ''), et.shape.length === 0);
  assert('etude: subdivision helpers default to eighths and know triplets', Object.values(et.helpers).every(Boolean));
```

Note the bar-count check is dropped from `shape` because `bad.chords` (line 223) already asserts
`chords.length === groups.length`, which is the constraint that actually matters — one chord per bar,
however many bars there are.

Finally, replace the 12-key note-count assertion. Line 350 inside the `run` evaluate block:

```js
      notes: document.querySelectorAll('#etOut .et12 .nn').length,
```

Add alongside it, in the same returned object:

```js
      expectNotes: et && 12 * etudeGroups(et.t).length * etNpb(et),
```

and change the assertion on line 360 from:

```js
  assert(`etude: all twelve notated inside one playback container (${run.notes} notes)`, run.notes === 12 * 4 * 8);
```

to:

```js
  assert(`etude: all twelve notated inside one playback container (${run.notes} notes)`, run.notes === run.expectNotes);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/smoke.js`
Expected: FAIL — a `pageerror` or console error mentioning `etNpb is not defined`, and the
subdivision-helpers assertion failing.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, replace line 2222:

```js
const ET_NOTES_PER_BAR = 8, ET_NV = 'eighth';
```

with:

```js
// An étude carries its own subdivision. Uniform within the étude: either all straight eighths or
// all triplets, never both. ponytail: per-note durations would mean variable column widths,
// beaming groups and triplet brackets over arbitrary subsets in renderNotationSystems — which four
// tabs share. The across-the-barline effect these studies want comes instead from cell lengths that
// do not divide the bar (three-note cells against eight eighths). Add real durations when a written
// étude needs a rhythm that phasing cannot produce.
const etNv  = et => et.nv ?? 'eighth';
const etNpb = et => et.nv === 'triplet' ? 12 : 8;
```

Then update the six call sites.

`etudePads` (`index.html:4967-4971`) — take notes-per-bar as a parameter:

```js
const etudePads = (chords, bar0, npb)=> chords.map((c,i)=>{
  let rootM = 48 + c.pc; if(rootM > 55) rootM -= 12;
  return {at: (bar0+i)*npb, dur: npb,
    pitches: QUALITIES[c.qual].intervals.slice(0,4).map(iv=>rootM+iv)};
});
```

In `etudeCard` (`index.html:4984` and `4995`):

```js
  markBarLines(groups, etNv(et));
```

```js
    playNotes(groups.flat(), pb, etudePads(chords, 0, etNpb(et)), false, etNv(et));
```

In `etudeCard`'s notation branch (`index.html:5004`):

```js
    nd.innerHTML = renderNotationSystems(groups, key, chords.map(c=>c.label), etNv(et), null,
```

In `etude12`'s play handler (`index.html:5036` and `5039`):

```js
      pads.push(...etudePads(chords, i*chords.length, etNpb(et)));
```

```js
    playNotes(notes, pb, pads, false, etNv(et));
```

Also update the sub-line at `index.html:5000`, which hardcodes "eighth notes":

```js
  div.appendChild(etudeSub(`${chords.map(c=>c.label).join(' – ')} · ${ET_LEVELS[et.lvl]} · ${etNv(et) === 'triplet' ? 'triplets' : 'eighth notes'}`));
```

And the auto-advance tooltip (`index.html:5054`), which hardcodes four bars:

```js
  akb.title = `Bars in each key before it advances — the étude is ${etudeGroups(et.t).length} bars, so ${etudeGroups(et.t).length * 2} is twice through`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/smoke.js`
Expected: PASS on every étude assertion. All 45 existing études still pass — they declare no `nv`,
so `etNv` returns `'eighth'` and `etNpb` returns `8`, exactly today's behaviour.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Let an étude carry its own subdivision and bar count"
```

---

### Task 2: The `tp` field — triad pairs that transpose

Triad pairs are stored as pitch classes, not names, so `etudeIn` can move them with the same
interval it already applies to `chords` (`index.html:4945-4948`). Labels are built with the same
`NM[pc] + CHORD_SYM[qual]` expression the rest of the app uses.

**Files:**
- Modify: `index.html` (add `etudePairs` next to `etudeGroups` at 2225; extend `etudeIn` at 4935)
- Test: `tests/smoke.js` (new block after the transposition suite that ends at line 297)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `etudePairs(tp) -> [[{pc, qual, label}, {pc, qual, label}], ...]`, one entry per bar.
  `etudeIn(et, pc)` gains a `pairs` key in its return value — `null` when the étude has no `tp`.

- [ ] **Step 1: Write the failing test**

In `tests/smoke.js`, immediately after the `assert('etude: "as written" leaves the frets alone', ...)`
call (line 296-297), add:

```js
  // Triad pairs are stored as pitch classes so they ride the same transposition as the chords.
  // A pair that stayed put while the line moved would be a label that lies.
  const tpChk = await p.evaluate(() => {
    const bad = { shape: [], move: [], spell: [], absent: [] };
    ETUDES.forEach(e => {
      const bars = etudeGroups(e.t).length;
      if (e.tech !== 'triadpair') { if (e.tp) bad.absent.push(e.id); return; }
      if (!e.tp) { bad.absent.push(e.id); return; }
      let pairs;
      try { pairs = etudePairs(e.tp); } catch (err) { bad.shape.push(e.id + ' THREW'); return; }
      if (pairs.length !== bars || pairs.some(p => p.length !== 2)) bad.shape.push(e.id);
      if (pairs.some(p => p.some(t => !QUALITIES[t.qual] || !(t.pc >= 0 && t.pc <= 11)))) bad.shape.push(e.id);
      for (let pc = 0; pc < 12; pc++) {
        const iv = (pc - e.key + 12) % 12, t = etudeIn(e, pc);
        if (!t.pairs || t.pairs.length !== bars) { bad.move.push(`${e.id}@${pc}`); continue; }
        t.pairs.forEach((p, bi) => p.forEach((tri, ti) => {
          if (tri.pc !== (pairs[bi][ti].pc + iv) % 12 || tri.qual !== pairs[bi][ti].qual)
            bad.move.push(`${e.id}@${pc} bar${bi + 1}`);
        }));
        // pair labels must use the same accidental family as the chords in that key
        const acc = new Set([...t.chords.map(c => c.label[1]), ...t.pairs.flat().map(x => x.label[1])]
          .filter(a => a === '#' || a === 'b'));
        if (acc.size > 1) bad.spell.push(`${e.id}@${pc}`);
      }
    });
    return bad;
  });
  assert('etude: every triad-pair étude declares one pair of two triads per bar'
    + (tpChk.shape.length ? ' — ' + tpChk.shape.join(', ') : ''), tpChk.shape.length === 0);
  assert('etude: tp is present on triad-pair études and absent on the rest'
    + (tpChk.absent.length ? ' — ' + tpChk.absent.join(', ') : ''), tpChk.absent.length === 0);
  assert('etude: triad pairs transpose with the same interval as the chords'
    + (tpChk.move.length ? ' — ' + tpChk.move.slice(0, 6).join(', ') : ''), tpChk.move.length === 0);
  assert('etude: pair labels share the progression\'s accidental family'
    + (tpChk.spell.length ? ' — ' + tpChk.spell.slice(0, 4).join(', ') : ''), tpChk.spell.length === 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/smoke.js`
Expected: FAIL — a console error mentioning `etudePairs is not defined`. (The `ETUDES.forEach`
body returns early for every étude at this point since none has `tech === 'triadpair'`, but the
`etudePairs` reference is still hoisted-undefined, so the evaluate throws.)

- [ ] **Step 3: Write minimal implementation**

In `index.html`, immediately after `etudeGroups` (which ends at line 2230), add:

```js
// Triad pairs, one pair per bar: "pc:qual pc:qual", ' / ' between bars. Pitch classes rather than
// names so a pair rides the same transposition as the chord it sits over — a label that stayed put
// while the line moved would simply be wrong.
function etudePairs(tp){
  return tp.split('/').map(bar => bar.trim().split(/\s+/).map(tok => {
    const [pc, qual] = tok.split(':');
    return {pc: +pc, qual};
  }));
}
```

Then extend `etudeIn` (`index.html:4935-4949`). Replace the whole function with:

```js
function etudeIn(et, pc){
  const groups = etudeGroups(et.t), chords = etudeChords(et);
  const pairs = et.tp ? etudePairs(et.tp) : null;
  const NM0 = SHARP_KEYS.has(et.key) ? SHARP_NAMES : FLAT_NAMES;
  const name = (p, q, nm) => nm[p] + (CHORD_SYM[q] ?? '');
  if(pc === null || pc === et.key)
    return {groups, chords, key: et.key,
      pairs: pairs && pairs.map(b => b.map(t => ({...t, label: name(t.pc, t.qual, NM0)})))};
  const iv = (pc - et.key + 12) % 12, frets = groups.flat().map(n => n.f);
  let n = iv;
  if(Math.max(...frets) + n > ET_HIGH_FRET && Math.min(...frets) + n - 12 >= 0) n -= 12;
  groups.forEach(g => g.forEach(nt => { nt.f += n; nt.p += n; }));
  // one accidental family for the whole progression, chosen by the key — spelling the IV of
  // D♭ as F♯ is how you get a chart nobody can read
  const NM = SHARP_KEYS.has(pc) ? SHARP_NAMES : FLAT_NAMES;
  return {groups, key: pc, chords: chords.map(c=>{
    const p2 = (c.pc + iv) % 12;
    return {pc: p2, qual: c.qual, label: name(p2, c.qual, NM)};
  }), pairs: pairs && pairs.map(b => b.map(t => {
    const p2 = (t.pc + iv) % 12;
    return {pc: p2, qual: t.qual, label: name(p2, t.qual, NM)};
  }))};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/smoke.js`
Expected: PASS. All four new assertions pass vacuously — no étude has `tech === 'triadpair'` yet, so
`absent` stays empty too. The existing transposition suite still passes, proving `etudeIn` was not
broken by the rewrite.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Store triad pairs as pitch classes so they transpose with the chords"
```

---

### Task 3: A second line on notation bar labels

`renderNotationSystems` collects bar labels into `marks` (`index.html:1701-1710`) and draws each as
one `<text>` at `y=14`, reserving 28px of headroom (`index.html:1718`, `1726`). Accept an array
label as well as a string.

**Files:**
- Modify: `index.html:1718` (headroom), `index.html:1725-1727` (label drawing)
- Test: `tests/smoke.js` (new block, placed after the tab-view assertions around line 311)

**Interfaces:**
- Consumes: nothing.
- Produces: `renderNotationSystems(groups, rootPc, labels, nv, fingers, availPx)` where an entry in
  `labels` may now be `[main, sub]` as well as a string. Task 5 relies on this.

- [ ] **Step 1: Write the failing test**

In `tests/smoke.js`, after the tab-view assertion (line 311) and before `await p.selectOption('#etView', 'note');`,
add:

```js
  // A bar label may carry a second, quieter line under the chord symbol. Every existing caller
  // passes plain strings and must be unaffected.
  const lbl = await p.evaluate(() => {
    const g = etudeGroups('3:5 3:7 / 3:9 3:10');
    const plain = renderNotationSystems(g, 0, ['Dm7', 'G7'], 'eighth', null, 800)[0];
    const stacked = renderNotationSystems(g, 0, [['Dm7', 'Dm / Em'], ['G7', 'G / A']], 'eighth', null, 800)[0];
    const count = (s, t) => s.split(t).length - 1;
    return {
      plainMain:  count(plain, '>Dm7<') === 1 && count(plain, '>G7<') === 1,
      plainNoSub: !plain.includes('Dm / Em'),
      subMain:    count(stacked, '>Dm7<') === 1,
      subLine:    count(stacked, '>Dm / Em<') === 1 && count(stacked, '>G / A<') === 1
                  && count(stacked, 'class="plab"') === 2,
      // the sub line sits below the main one, and the staff is pushed down to make room
      taller:     stacked.length > plain.length,
    };
  });
  assert('label: a plain string label still draws one line', lbl.plainMain && lbl.plainNoSub);
  assert('label: an array label draws the chord symbol and a sub line', lbl.subMain && lbl.subLine);
  assert('label: stacked labels reserve extra headroom', lbl.taller);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/smoke.js`
Expected: FAIL on `label: an array label draws the chord symbol and a sub line` — an array label
currently stringifies, so the SVG contains `>Dm7,Dm / Em<` rather than two separate `<text>` runs.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, replace line 1718:

```js
    const staffTop = (labels ? 28 : 12) + fingPad + (maxD-38)*SP/2;   // y of top staff line (F5, dval 38)
```

with:

```js
    // a stacked label (chord symbol over its triad pair) needs a second line of headroom
    const hasSub = marks.some(mk => Array.isArray(mk.label));
    const labelPad = labels ? (hasSub ? 38 : 28) : 12;
    const staffTop = labelPad + fingPad + (maxD-38)*SP/2;   // y of top staff line (F5, dval 38)
```

Then replace the label-drawing block at lines 1724-1727:

```js
    // chord labels (progression mode)
    marks.forEach(mk=>{
      s += `<text x="${mk.x+2}" y="14" font-size="12" font-weight="700" fill="var(--accent)">${mk.label}</text>`;
    });
```

with:

```js
    // chord labels (progression mode); an array label puts a quieter second line underneath —
    // the triad pair the bar is built from, which is the thing you read while playing it
    marks.forEach(mk=>{
      const [main, sub] = Array.isArray(mk.label) ? mk.label : [mk.label, null];
      s += `<text x="${mk.x+2}" y="14" font-size="12" font-weight="700" fill="var(--accent)">${main}</text>`;
      if(sub) s += `<text class="plab" x="${mk.x+2}" y="25" font-size="10" fill="var(--muted)">${sub}</text>`;
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/smoke.js`
Expected: PASS on all three new label assertions, and no regression in the Progressions or Exercises
notation assertions — both still pass plain strings.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Let a notation bar label carry a second, quieter line"
```

---

### Task 4: The triad-pair technique tip and its pitch check

Two pieces of groundwork that must land before any étude, because
`tests/smoke.js:217` rejects an étude whose `tech` has no `TECH_TIPS` entry.

`etudeTip` (`index.html:4978`) currently reads its display name out of the **Exercises tab's**
`selTech` dropdown. Give it a local name map instead, so `triadpair` never appears in a
picking-technique control.

The pitch check at `tests/smoke.js:233-239` asserts every note is in `QUALITIES[e.qual]` or a
semitone approach. For triad-pair études that is both too loose and too tight — too loose because it
permits scale tones outside both triads, too tight because no single scale covers an étude that
switches device mid-progression. Replace it, for `triadpair` only, with the precise thing: every note
in bar N is a chord tone of one of bar N's two declared triads.

**Files:**
- Modify: `index.html:3281-3287` (`TECH_TIPS`), `index.html:4978` (`etudeTip`)
- Test: `tests/smoke.js:233-239` (pitch check), `tests/smoke.js:263` (its assertion)

**Interfaces:**
- Consumes: `etudePairs` from Task 2.
- Produces: `ET_TECH_NAMES` — a `{value: displayName}` map covering all six values. Task 8 adds the
  matching dropdown option.

- [ ] **Step 1: Write the failing test**

In `tests/smoke.js`, replace the pitch-check block at lines 233-239:

```js
      const sc = new Set(QUALITIES[e.qual].intervals.map(iv => (iv + e.key) % 12));
      const flat = groups.flat();
      flat.forEach((n, i) => {
        if (sc.has(n.p % 12)) return;
        const nx = flat[i + 1];
        if (!nx || Math.abs(nx.p - n.p) !== 1) bad.pitch.push(`${e.id} @${i} pc${n.p % 12}`);
      });
```

with:

```js
      // A triad-pair étude is defined by its pairs, not by a parent scale: the check is that every
      // note in a bar is a chord tone of one of that bar's two triads. Stricter than the scale
      // check it replaces, and unlike a scale it covers an étude that switches device mid-chorus.
      const flat = groups.flat();
      if (e.tech === 'triadpair') {
        const pairs = etudePairs(e.tp);
        groups.forEach((g, bi) => {
          const tones = new Set(pairs[bi].flatMap(t => QUALITIES[t.qual].intervals.map(iv => (iv + t.pc) % 12)));
          g.forEach((n, i) => {
            if (tones.has(n.p % 12)) return;
            const nx = g[i + 1];
            if (!nx || Math.abs(nx.p - n.p) !== 1) bad.pitch.push(`${e.id} bar${bi + 1}@${i} pc${n.p % 12}`);
          });
        });
      } else {
        const sc = new Set(QUALITIES[e.qual].intervals.map(iv => (iv + e.key) % 12));
        flat.forEach((n, i) => {
          if (sc.has(n.p % 12)) return;
          const nx = flat[i + 1];
          if (!nx || Math.abs(nx.p - n.p) !== 1) bad.pitch.push(`${e.id} @${i} pc${n.p % 12}`);
        });
      }
```

Update the assertion at line 263 to describe both cases:

```js
  assert('etude: every note is in the declared scale, or in one of the bar\'s two triads' + (et.pitch.length ? ' — ' + et.pitch.slice(0, 8).join(', ') : ''), et.pitch.length === 0);
```

Then, after that assertion, add a check that the tip map is complete and independent of the
Exercises tab:

```js
  const tipChk = await p.evaluate(() => {
    const techs = [...new Set(ETUDES.map(e => e.tech))];
    return {
      named:   techs.every(t => ET_TECH_NAMES[t] && TECH_TIPS[t]),
      tips:    ETUDES.every(e => etudeTip(e).includes(ET_TECH_NAMES[e.tech])),
      // the Exercises-tab picking dropdown must stay picking-only
      picking: ![...document.getElementById('selTech').options].some(o => o.value === 'triadpair'),
    };
  });
  assert('etude: every technique has a display name and a tip', tipChk.named);
  assert('etude: tips read from the étude name map, not the Exercises dropdown', tipChk.tips);
  assert('etude: "triad pairs" never appears in the picking-technique dropdown', tipChk.picking);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/smoke.js`
Expected: FAIL — a console error mentioning `ET_TECH_NAMES is not defined`.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, add a `triadpair` entry to `TECH_TIPS` (`index.html:3281-3287`), after the `hybrid`
line:

```js
  triadpair: 'Two triads, one chord: play them interwoven rather than one after the other, and use inversions so the leaps stay wide. The upper triad is where the extensions live — that is the sound you are after.',
```

Then replace `etudeTip` (`index.html:4978`):

```js
const etudeTip = et => `${[...selTech.options].find(o=>o.value===et.tech).text}: ${TECH_TIPS[et.tech]}`;
```

with a local map, so the Études tab never depends on the Exercises tab's picking dropdown:

```js
// Its own name map rather than the Exercises tab's picking dropdown: triad pairs are note choice,
// not a picking-hand technique, and it has no business being offered as a picking focus.
const ET_TECH_NAMES = {
  alternate: 'Alternate picking', economy: 'Economy picking', legato: 'Legato',
  sweep: 'Sweep picking', hybrid: 'Hybrid picking', triadpair: 'Triad pairs',
};
const etudeTip = et => `${ET_TECH_NAMES[et.tech]}: ${TECH_TIPS[et.tech]}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/smoke.js`
Expected: PASS on all three new assertions. All 45 existing études still produce the same tip text —
the map's five picking names are copied verbatim from the dropdown's option labels.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Give the Études tab its own technique names, and check triad pairs by their triads"
```

---

### Task 5: The three beginner études

Diatonic, consonant, four bars of straight eighths. These are the way in: one device each, one pair
held for the whole chorus, so the ear hears what the upper triad does to the chord.

**The interweaving method**, which applies to every étude from here on:

- **Never a full triad up then a full triad down.** Alternate inside a cell — two notes of one triad,
  one of the other; or two and two.
- **Cell length must not divide the bar.** A three-note cell against eight eighths phase-shifts every
  bar and realigns only after three (LCM 24 — bar 4, beat 1). That phasing *is* the across-the-barline
  effect; it is what replaces mixed durations.
- **Inversions.** Take the triad from wherever it lies under the hand, not always from its root.
- **Voice leading.** End each bar within a step or two of where the next begins.
- **Seven-fret window per bar**, and pick a region that survives transposition: the octave-drop rule
  (`index.html:4940`) shifts the whole line down twelve when the top would pass fret 15 and there is
  room below the nut, so a line written between frets 5 and 10 is safe in all twelve keys.

**Files:**
- Modify: `index.html` — add three entries to `ETUDES` (`index.html:2231`), in a new
  `// ---- triad pairs ----` section after the `hybrid` block
- Test: `tests/smoke.js` — no changes; Tasks 1, 2 and 4 already assert everything these must satisfy

**Interfaces:**
- Consumes: `etNv`/`etNpb` (Task 1), `etudePairs` (Task 2), `TECH_TIPS.triadpair` (Task 4).
- Produces: three `ETUDES` entries with `tech: 'triadpair'`, `lvl: 0`.

- [ ] **Step 1: Write the first étude, fully worked**

This one is composed and verified — use it exactly as given, and as the model for the other eight.

Add to `ETUDES`, in a new section after the hybrid-picking études:

```js
  // ---- triad pairs ----
  { id:'tp-dorian-vamp', n:'Dorian vamp, minor pairs a whole step apart', tech:'triadpair', lvl:0,
    key:2, qual:'dorian', ch:'Dm7 Dm7 Dm7 Dm7',
    tp:'2:min 4:min / 2:min 4:min / 2:min 4:min / 2:min 4:min',
    why:'Two minor triads a whole step apart over one chord: D minor gives you the chord, E minor '
       + 'gives you the 9th, 11th and the natural 13th that makes it Dorian rather than Aeolian. '
       + 'The cell is three notes long and the bar is eight, so it lands somewhere new every bar.',
    t:'2:7 3:7 3:9 3:10 4:10 5:7 5:10 4:10 / 4:8 4:6 3:7 2:9 2:7 3:10 3:9 4:6 '
     + '/ 4:10 5:7 5:10 5:5 4:8 3:10 3:7 3:9 / 4:6 2:7 2:9 3:10 3:7 2:5 2:7 3:7' },
```

Verification already done on this entry, and worth re-checking by hand if you change a digit:
every one of its 32 notes is a chord tone of D minor (D F A) or E minor (E G B); frets run 5–10 so
every bar spans 5 and the seven-fret window holds; it ends on D, the root.

- [ ] **Step 2: Run the tests to confirm the first one is clean**

Run: `node tests/smoke.js`
Expected: PASS on `etude: every note is in the declared scale, or in one of the bar's two triads`
and on the triad-pair transposition assertions. The `thin` assertion (three per technique per level)
is not yet checked for `triadpair` because Task 8 has not added the dropdown option — that is
deliberate sequencing, so the suite stays green between tasks.

- [ ] **Step 3: Write the other two beginner études**

Same shape, same method. Compose the notes against these specifications:

```js
  { id:'tp-lydian-maj7', n:'Lydian major 7th, major pairs a whole step apart', tech:'triadpair', lvl:0,
    key:0, qual:'lydian', ch:'Cmaj7 Cmaj7 Cmaj7 Cmaj7',
    tp:'0:maj 2:maj / 0:maj 2:maj / 0:maj 2:maj / 0:maj 2:maj',
    why:'<house voice: C major gives the chord, D major gives the 9th, the ♯11 and the 13th — '
       + 'three extensions from one shape you already know. The ♯11 is the note that makes it '
       + 'Lydian, and it needs to sound deliberate rather than wrong.>',
    t:'<32 notes, frets 5–10, every note in C major (C E G) or D major (D F♯ A)>' },
  { id:'tp-bvii-dominant', n:'Flat-seven pair over a dominant', tech:'triadpair', lvl:0,
    key:0, qual:'mixo', ch:'C7 C7 C7 C7',
    tp:'10:maj 0:maj / 10:maj 0:maj / 10:maj 0:maj / 10:maj 0:maj',
    why:'<house voice: the triad built on the flat seventh, paired with the one on the root. '
       + 'B♭ major hands you the ♭7, the 9th and the 11th; C major holds the chord underneath it.>',
    t:'<32 notes, frets 5–10, every note in B♭ major (B♭ D F) or C major (C E G)>' },
```

Both `why` fields must be written in full in the house voice — read the existing 45 first. The
placeholder text above states what each must say, not what to ship.

For each, the note pool is fixed and small: build a table of `s:f` positions in frets 5–10 whose
pitch class is a chord tone of either triad, then write four bars of eight from it using a
three-note cell that alternates between the triads. `tp-lydian-maj7` should climb and resolve to C;
`tp-bvii-dominant` should sit lower and end on the ♭7 or the root.

- [ ] **Step 4: Run the tests**

Run: `node tests/smoke.js`
Expected: PASS. Specifically these assertions cover the new data completely —
`etude: strings/frets/pitches in range`, `etude: every bar fits one hand position`,
`etude: every note is in the declared scale, or in one of the bar's two triads`,
`etude: one chord per bar`, `etude: triad pairs transpose with the same interval as the chords`,
`etude: all 45 in all 12 keys stay on the neck` (which now covers 48).

If the pitch assertion fails it names the étude, bar and note index — fix the fret, do not relax the
check.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add three beginner triad-pair études"
```

---

### Task 6: The three intermediate études

The device now has to move. Two of these change pair with the chord; one runs eight bars.

**Files:**
- Modify: `index.html` — three more `ETUDES` entries in the triad-pairs section
- Test: `tests/smoke.js` — no changes

**Interfaces:**
- Consumes: everything from Tasks 1–4; the method and pool technique from Task 5.
- Produces: three `ETUDES` entries with `tech: 'triadpair'`, `lvl: 1`.

- [ ] **Step 1: Write the three études**

```js
  { id:'tp-lydian-dominant', n:'Lydian dominant, major pairs a whole step apart', tech:'triadpair', lvl:1,
    key:0, qual:'mixo', ch:'C7 F7 C7 C7',
    tp:'0:maj 2:maj / 5:maj 7:maj / 0:maj 2:maj / 0:maj 2:maj',
    why:'<house voice: the same whole-step major pair, moved to sit on each chord in turn. The '
       + 'upper triad supplies the 9th, ♯11 and 13th; the ♯11 is what makes it Lydian dominant '
       + 'rather than plain Mixolydian. Bar 2 is the test — find the nearest note in the new pair.>',
    t:'<32 notes; bars 1,3,4 from C/D major, bar 2 from F/G major; frets 5–10>' },
  { id:'tp-half-dim', n:'Minor pairs over a half-diminished chord', tech:'triadpair', lvl:1,
    key:11, qual:'locrian', ch:'Bm7b5 Bm7b5 Bm7b5 Bm7b5',
    tp:'2:min 4:min / 2:min 4:min / 2:min 4:min / 2:min 4:min',
    why:'<house voice: neither triad is built on the chord root. D minor is the chord from the '
       + 'third up; E minor adds the 11th and the ♭13. Half-diminished sounds bleak played as an '
       + 'arpeggio and quite different played as these two triads.>',
    t:'<32 notes, frets 5–10, every note in D minor (D F A) or E minor (E G B)>' },
  { id:'tp-major-251', n:'Major ii–V–I, a device per chord', tech:'triadpair', lvl:1,
    key:0, qual:'majscale', ch:'Dm7 G7 Cmaj7 Cmaj7 Dm7 G7 Cmaj7 Cmaj7',
    tp:'2:min 4:min / 7:maj 9:maj / 0:maj 2:maj / 0:maj 2:maj '
      +'/ 2:min 4:min / 7:maj 9:maj / 0:maj 2:maj / 0:maj 2:maj',
    why:'<house voice: three rules in eight bars — minor pair on the ii, Lydian-dominant major '
       + 'pair on the V, Lydian major pair on the I. Twice round, so the second time you already '
       + 'know where the changes are and can think about the line instead.>',
    t:'<64 notes, eight bars of eight, frets 5–10>' },
```

Every `why` must be written out in the house voice. The bracketed text says what to say.

Note `tp-major-251` is the first eight-bar étude: `ch` holds eight chords and `t` holds eight
bar groups. Task 1 made both the shape check and the 12-key note count derive from the data, so
nothing else needs changing.

`qual` on these is only a fallback label — the triad-membership check is what actually validates
the notes for `tech === 'triadpair'` (Task 4). It must still be a real key of `QUALITIES`
(`tests/smoke.js:217`).

- [ ] **Step 2: Run the tests**

Run: `node tests/smoke.js`
Expected: PASS, including `etude: all twelve notated inside one playback container` — which now
computes `12 * 8 * 8` for `tp-major-251` rather than the old hardcoded `12 * 4 * 8`. If that
assertion fails, Task 1's `expectNotes` change was not applied.

- [ ] **Step 3: Check the eight-bar étude in the browser**

Follow the `verify` skill in `.claude/skills/verify` to launch the app. On the Études tab, select
Every technique, find `tp-major-251`, and confirm: eight bars of notation wrap across systems
without clipping; the ⟳ 12 keys run renders twelve cards; auto-advance's bars-per-key tooltip reads
"the étude is 8 bars, so 16 is twice through".

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add three intermediate triad-pair études"
```

---

### Task 7: The three advanced études

All three in triplets. Twelve notes to the bar, and a four-note interweave cell — two notes from each
triad — so the cell crosses the triplet groupings and you get the quarter-note-triplet superimposition
that the notation's `3` brackets make visible.

**Files:**
- Modify: `index.html` — three more `ETUDES` entries
- Test: `tests/smoke.js` — extend the existing follow-along assertion to cover triplets

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: three `ETUDES` entries with `tech: 'triadpair'`, `lvl: 2`, `nv: 'triplet'`.

- [ ] **Step 1: Write the failing test**

`tests/smoke.js:314-320` already proves an étude plays at its own subdivision rather than the
Exercises tab's. Extend it to prove a *triplet* étude does. After the existing
`assert('etude: follow-along tracks the étude\'s own note value ...')` block (which ends around
line 320) and before the `#etOut .keyblock .pbtn` stop click, add:

```js
  // A triplet étude runs at 1/3 of a beat a note, so in the same wall-clock time the highlight
  // must be further along than an eighth-note étude would be.
  const tri = await p.evaluate(() => {
    const e = ETUDES.find(x => x.nv === 'triplet');
    return e ? { id: e.id, npb: etNpb(e), nv: etNv(e) } : null;
  });
  assert('etude: at least one étude is written in triplets', tri && tri.npb === 12 && tri.nv === 'triplet');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/smoke.js`
Expected: FAIL on `etude: at least one étude is written in triplets` — no étude declares `nv` yet.

- [ ] **Step 3: Write the three études**

```js
  { id:'tp-tritone-outside', n:'Tritone-apart majors over a dominant', tech:'triadpair', lvl:2,
    key:0, qual:'dimHW', ch:'C7 C7 C7 C7', nv:'triplet',
    tp:'0:maj 6:maj / 0:maj 6:maj / 0:maj 6:maj / 0:maj 6:maj',
    why:'<house voice: C major is the chord; F♯ major, a tritone away, is every altered note at '
       + 'once — the ♭9, the ♯11 and the ♭13. Alternate them and the line steps outside and back '
       + 'in every few notes. In triplets, so the four-note cell cuts across the groupings.>',
    t:'<48 notes: four bars of twelve, every note in C major (C E G) or F♯ major (F♯ A♯ C♯)>' },
  { id:'tp-altered-augmented', n:'Augmented pairs over an altered dominant', tech:'triadpair', lvl:2,
    key:7, qual:'wholetone', ch:'G7 G7 Cm7 Cm7', nv:'triplet',
    tp:'7:aug 5:aug / 7:aug 5:aug / 0:min 2:min / 0:min 2:min',
    why:'<house voice: two augmented triads a whole step apart give you the whole-tone scale, '
       + 'which is every altered tension over the V. Both are symmetrical, so an inversion is the '
       + 'same shape moved — the hand has nothing to hold on to. Bars 3 and 4 land it on a minor '
       + 'pair and the ground comes back.>',
    t:'<48 notes: bars 1–2 from Gaug (G B D♯) or Faug (F A C♯); bars 3–4 from Cm (C E♭ G) or '
     + 'Dm (D F A)>' },
  { id:'tp-minor-251-tritone', n:'Minor ii–V–i with a tritone-sub pair on the i', tech:'triadpair', lvl:2,
    key:0, qual:'dimHW', ch:'Dm7b5 G7 Cm7 Cm7 Dm7b5 G7 Cm7 Cm7', nv:'triplet',
    tp:'5:min 7:min / 7:aug 5:aug / 0:min 2:min / 0:min 6:min '
      +'/ 5:min 7:min / 7:aug 5:aug / 0:min 2:min / 0:min 6:min',
    why:'<house voice: four devices in eight bars. Minor pair on the ii∅, augmented pair on the '
       + 'altered V, ordinary minor pair on the i — and then bar 4 swaps the upper triad for one a '
       + 'tritone away, which turns the resolution inside out just as you settle into it.>',
    t:'<96 notes: eight bars of twelve, frets 5–10>' },
```

Every `why` written out in the house voice.

Cell construction for these: four notes, two from each triad — `A1 A2 B1 B2`, taking a different
inversion of each triad every time round. Against twelve notes to the bar that is three cells per
bar, and each cell straddles the triplet groups, which is the audible effect. Vary which triad
leads between bars so it does not become a pattern the hand plays without listening.

`tp-minor-251-tritone` bar 4 is the Invitation device: C minor paired with F♯ minor, a tritone
apart. `6:min` is F♯ minor.

- [ ] **Step 4: Run the tests**

Run: `node tests/smoke.js`
Expected: PASS, including the new triplet assertion. Watch three in particular:
`etude: every bar holds the étude's own note count` (twelve, not eight, for these three),
`etude: every note is in the declared scale, or in one of the bar's two triads`, and
`etude: every bar fits one hand position` — augmented and tritone-apart pairs spread widely, and this
is where a seven-fret violation is most likely.

- [ ] **Step 5: Check the triplets render and play**

Follow the `verify` skill to launch the app. On the Études tab find `tp-tritone-outside` and confirm:
the notation shows `3` brackets over each group of three; the card's sub-line reads "triplets" rather
than "eighth notes"; ▶ plays twelve notes to the bar against the metronome, and the follow-along
highlight stays with it.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Add three advanced triad-pair études, written in triplets"
```

---

### Task 8: Put Triad pairs in the filter

All nine now exist, so the dropdown option can land without breaking the "no empty combination" and
"three per technique per level" assertions (`tests/smoke.js:241-254`).

**Files:**
- Modify: `index.html:795-802` (the `#etTech` select), `index.html:817-820` (the tab's blurb)
- Test: `tests/smoke.js` — the existing `empty` and `thin` assertions begin covering `triadpair`
  automatically; add one for the filter itself

**Interfaces:**
- Consumes: `ET_TECH_NAMES` (Task 4) and all nine études (Tasks 5–7).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

In `tests/smoke.js`, after the existing technique-filter assertion (around line 308,
`etude: technique filter narrows the list`), add:

```js
  await p.selectOption('#etTech', 'triadpair');
  await p.waitForTimeout(200);
  const tpView = await p.evaluate(() => ({
    cards: document.querySelectorAll('#etOut .keyblock').length,
    // the pair label under the chord symbol is the thing these études exist to show
    subs: document.querySelectorAll('#etOut .nsys text.plab').length,
    levels: new Set(etudeList().map(e => e.lvl)).size,
  }));
  assert(`etude: the Triad pairs filter shows nine études (${tpView.cards})`, tpView.cards === 9);
  assert('etude: all three levels are represented', tpView.levels === 3);
  assert(`etude: triad-pair cards label the pair under the chord (${tpView.subs} sub-labels)`, tpView.subs > 0);
  await p.selectOption('#etTech', 'all');
  await p.waitForTimeout(200);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/smoke.js`
Expected: FAIL — `selectOption('#etTech', 'triadpair')` throws because the option does not exist.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, add the sixth option to the Études Technique select (after the `hybrid` line at
`index.html:801`):

```html
        <option value="triadpair">Triad pairs</option>
```

Then wire the stacked labels in `etudeCard`. Replace the notation branch (`index.html:5002-5006`):

```js
  if($('etView').value === 'note'){
    const nd = document.createElement('div'); nd.className = 'notation';
    nd.innerHTML = renderNotationSystems(groups, key, chords.map(c=>c.label), etNv(et), null,
      $('etOut').clientWidth - 34).map(s=>`<div class="nsys">${s}</div>`).join('');
    div.appendChild(nd);
```

with a version that passes the pair as a second label line when the étude has one:

```js
  if($('etView').value === 'note'){
    const nd = document.createElement('div'); nd.className = 'notation';
    // a triad-pair étude labels each bar twice: the chord, and the two triads it is built from
    const labels = chords.map((c,i)=> pairs
      ? [c.label, pairs[i].map(t=>t.label).join(' / ')] : c.label);
    nd.innerHTML = renderNotationSystems(groups, key, labels, etNv(et), null,
      $('etOut').clientWidth - 34).map(s=>`<div class="nsys">${s}</div>`).join('');
    div.appendChild(nd);
```

That needs `pairs` in scope. Update the destructuring at the top of `etudeCard`
(`index.html:4983`):

```js
  const {groups, chords, key, pairs} = etudeIn(et, pc);
```

Finally, extend the tab's explanatory blurb (`index.html:817-820`) so the new category is
discoverable. Replace the closing sentence with:

```html
      ⟳ 12 keys takes one étude round the circle of fourths and plays it straight through.
      The Triad pairs studies are note choice rather than picking: two triads per chord, labelled
      under the chord symbol, interwoven rather than arpeggiated.</p>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/smoke.js`
Expected: PASS on all three new assertions, and — importantly — on
`etude: no filter combination is empty` and `etude: three per technique per level`, which now
include `triadpair` at all three levels. If `thin` reports `triadpair/0=2` or similar, an étude is
missing or has the wrong `lvl`.

- [ ] **Step 5: Check the whole feature in the browser**

Follow the `verify` skill. On the Études tab: select Triad pairs, confirm nine cards; confirm each
bar shows the chord symbol with the triad pair in smaller muted text beneath it; switch Key to
several different keys and confirm the pair labels move with the chords and share one accidental
family; open ⟳ 12 keys on one and confirm the labels are right in all twelve; switch View to
Tab only and confirm it still renders.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Add Triad pairs to the Études technique filter"
```

---

## Self-review notes

**Spec coverage.** Every section of `docs/superpowers/specs/2026-08-08-chord-pair-etudes-design.md`
maps to a task: Architecture 1 → Task 1; Architecture 2 → Task 2; Architecture 3 → Tasks 3 and 8;
Architecture 4 → Tasks 4 and 8; the nine études → Tasks 5–7; every Testing bullet → the task that
touches that assertion.

**Sequencing.** The `#etTech` option lands last, in Task 8. Adding it earlier would make
`tests/smoke.js:241-254` fail — those assertions iterate the dropdown's options and require exactly
three études per technique per level, so the option cannot exist until all nine do. This is why the
suite stays green at every commit.

**Known gap.** Tasks 5–7 specify eight of the nine études by pair, chord, key, level, subdivision,
fret region and note pool, with mechanical acceptance criteria, but do not contain their literal
tab strings — `tp-dorian-vamp` is written out in full as the worked model. Composing the remaining
eight is the implementation work of those tasks, and the smoke suite validates every property that
matters: triad membership per bar, hand span, fret and pitch range, one chord per bar, correct
note count, and correct transposition into all twelve keys.
