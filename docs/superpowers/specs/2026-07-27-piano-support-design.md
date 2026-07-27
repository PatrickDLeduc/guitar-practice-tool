# Piano Support — Design

Date: 2026-07-27

## Context

Guitar Practice Helper is a single 4,362-line vanilla HTML/CSS/JS file (`index.html`), no build step, no framework. The single-file property is load-bearing: it is what makes the app installable as a PWA, usable offline, and shareable as a URL. No design that breaks it is acceptable.

The app has a marked `// ===== ENGINE =====` section (`index.html:983-1707`) holding pure, Node-testable theory functions. Tests are one Playwright script (`tests/smoke.js`) driving the real page in headless Chrome, calling internals via `page.evaluate` alongside UI assertions. `localStorage` goes through a tiny `store` object (`index.html:2774`). Exercise settings are encoded into `location.hash` by `stateToHash()` (`index.html:2608`).

### Why this is cheaper than it looks

Investigation found the engine is already largely instrument-agnostic:

- `buildPool()` (`index.html:1030`) computes in **MIDI pitches**. The collapse to guitar `{s, f}` happens only at the fingering step.
- `voicingStacks()` (`index.html:3629`) returns **pure interval stacks** with drop2/drop3 already applied as pitch math. Only `allGrips()` (`index.html:3654`) bends them onto string sets.
- `parseQuery()` (`index.html:1592`) — the plain-English wedge — has entirely instrument-free vocabulary for quality, pattern, direction, and key sequence. Only its fingering clauses are guitar-shaped.
- `progressionLine()` (`index.html:1468`) and `guideToneLine()` (`index.html:1495`) build MIDI pitches, then funnel through the *same* `assignFingering()` call that `buildKeyExercise()` uses.

Piano support is therefore not a port. It is **declining to perform the final pitch → fretboard conversion**, and drawing different glyphs.

### What is genuinely guitar-bound

`const STRINGS = [40,45,50,55,59,64]` (`index.html:1062`) and everything downstream: `candidates()`, `assignFingering()`, `renderTab()`, `cagedShapes()`, `fullNeckSVG()`, `shapeSVG()`, `allGrips()`, and the Karplus-Strong `pluck()` synth (`index.html:2987`).

## Goal

Let the author — who plays piano — use the existing exercise generator, progressions, and voicings at a keyboard. Grand-staff notation, a keyboard diagram, and standard scale fingerings, behind a Guitar/Piano toggle.

**Audience is one person.** This is explicitly not a market expansion, and it is not a general-purpose piano trainer. Scope decisions below follow from that.

### Non-goals

- Algorithmic piano fingering for arbitrary generated patterns. Real fingerings are memorized conventions with thumb-unders; deriving them for "arpeggios in 3rds along the cycle of 4ths" is a research problem that would dominate the work and is not needed.
- Two-handed or hand-split exercises. One line; the player decides which hand.
- Sampled piano sound. Samples cannot ship inside a single-file offline app.
- Piano-specific NL vocabulary. The parser is already agnostic; adding terms invents a problem.
- Any keyboard analogue of CAGED or voicing grips. Those concepts do not exist on a piano. In piano mode the fretboard diagram row is **absent**, not substituted.

## Architecture

### 1. Instrument state

```js
let instrument = 'guitar';   // 'guitar' | 'piano'
```

Persisted via `store` under key `instr`. Encoded in the share hash by `stateToHash()` as `i=p` when piano (absent = guitar, keeping existing links byte-identical). Read back in `parseHash()`.

Piano mode restricts the fingering-mode select to `pos` (auto) only — `3nps`, `fixed`, `caged`, `2str`, and `shift` are fretboard concepts. The select's other options are hidden, not removed, so switching back to guitar restores the prior value.

### 2. Notes carry pitch — one choke point

The core change. `assignFingering(pitches, strs)` (`index.html:1069`) becomes instrument-aware:

```js
function assignFingering(pitches, strs){
  if(instrument === 'piano') return pitches.map(p => ({p}));
  // ...existing greedy hand-tracking walk, but each note gains p:
  // {p, s, f}
}
```

This single edit fixes every caller: `buildKeyExercise()`, `progressionLine()`, `guideToneLine()`. Progressions and guide-tone lines get piano support for free.

The guitar-only fingering branches inside `buildKeyExercise()` (`fixed`, `caged`, `2str`, `shift`, `3nps`) build their own `posMap` and never run in piano mode; each gains a one-line `p: STRINGS[s]+f` attachment so the note shape is uniform across the app.

Downstream consumers then read `n.p` instead of recomputing:

- `renderNotationSystems()` (`index.html:1282`) — `c.sp = spellWritten(c.n.p, ...)`
- playback (`index.html:3067`) — `pluck(ctx, n.p, ...)`
- voicing playback (`index.html:3622`, `index.html:3719`, `index.html:3742`)

On guitar these produce **identical numbers** to today. That equivalence is what makes the refactor safe, and it is asserted by a regression test (§7).

### 3. Grand staff

`renderNotationSystems()` (`index.html:1262`) branches on whether notes carry an `s`.

**Octave convention.** `spellWritten()` (`index.html:1256`) currently hardcodes `midi + 12` — the guitar written-octave-up convention. It gains a third parameter:

```js
function spellWritten(midi, useSharps, up8va){
  const w = midi + (up8va ? 12 : 0);
  // ...unchanged
}
```

Guitar passes `true`, piano `false`.

**Geometry.** `dval = oct*7 + LETTER_DIA[letter]` (`index.html:1251`), so:

| | dval range |
|---|---|
| Bass staff (G2–A3) | 18, 20, 22, 24, 26 |
| Middle C (C4) | 28 |
| Treble staff (E4–F5) | 30, 32, 34, 36, 38 |

Middle C lands exactly midway between the staves. Real grand-staff geometry therefore falls out of the **existing** `yOf()` linear map with no new coordinate math, and the existing generic ledger-line loops work unchanged.

**Rendering, piano branch:**
- Draw both five-line staves plus a brace at the left edge.
- Treble clef `\u{1D11E}` as today; bass clef `\u{1D122}`.
- Notes with `dval >= 28` render against the treble staff, below against the bass. Stem direction flips about each staff's own middle line rather than the single global `dval < 34` test.
- The entire tab block (`index.html:1333-1342`) is skipped, along with `STRING_LABELS`.
- Bar lines span from the treble top line to the bass bottom line.

**Known compromise.** Uniform `SP/2` step spacing makes the inter-staff gap narrower than engraved music, which conventionally widens it. The result is geometrically consistent and readable. A `STAFF_GAP` constant added to `yOf()` for `dval < 28` is the upgrade path; marked with a `ponytail:` comment naming that ceiling.

### 4. Keyboard diagram

New `keyboardSVG(pitches, rootPc, opts)`, colocated with `shapeSVG()` (`index.html:2249`) and matching its call shape so it drops into the existing diagram row.

- White keys as rects, black keys overlaid at conventional offsets.
- Sounding tones filled; root distinguished; interval coloring reused from `fullNeckSVG()` (`index.html:2278`) so the palette stays consistent across the app.
- Range spans the supplied pitches rounded out to octave boundaries, minimum two octaves.
- Same `gripA11y()` treatment as existing diagrams when clickable.

In piano mode this replaces the `shapesRow()` / `neckRow()` output in the Exercises tab.

### 5. Standard scale fingerings

```js
// PIANO_FING[qualKey][rootPc] = {rh: [7 fingers], lh: [7], rhEnd: n, lhEnd: n}
```

Stores the **seven-note ascending cycle** plus the terminal finger. For N octaves: repeat the cycle N times, append the terminal. Descending reverses the result. Coverage: `majscale` and `natmin`, all 12 keys, both hands.

`harmmin` and `melmin` fall back to the `natmin` row for their key — the raised 6th/7th do not change the finger sequence in most keys. Marked with a `ponytail:` comment: *known ceiling, split out per-key if a specific key's fingering proves wrong in practice.*

**Numbers render only when all of:** pattern is `straight`, direction is plain `asc` or `desc`, fingering mode is auto, and the quality has a table row. Otherwise the fingering row is blank. Showing an invented fingering for an in-3rds cycle-of-4ths drill would be worse than showing none.

A RH/LH toggle in the Exercises controls selects which row displays. It is display-only — it does not change the generated notes.

Rendered as small numerals above the treble staff / below the bass staff.

### 6. Voicings

In piano mode `renderVoicings()` (`index.html:3602`) bypasses `allGrips()`. For each `{inv, stack}` from `voicingStacks()`, place the root in the octave nearest C3 and render `keyboardSVG()` plus a grand-staff chord. Click-to-hear uses `pad()` (`index.html:3259`) rather than `pluck()`.

Exercise and progression playback likewise swap `pluck()` → `pad()` in piano mode. `pad()` is an existing soft synth already used for comping; it reads as an electric piano, not a Steinway. Acceptable, and it costs nothing.

### 7. Verification

Extend `tests/smoke.js`:

1. **Regression guard (the important one).** For a fixed query, assert guitar-mode note output — `{s, f}` pairs and rendered tab text — is unchanged from a committed baseline. This is what protects the existing app from the `p` refactor.
2. Piano mode emits notes with `p` and no `s`.
3. Piano notation renders both clefs and no tab lines; guitar renders tab and one clef.
4. `spellWritten(60, false, false).dval === 28` and `spellWritten(60, false, true).dval === 35` — pins the octave convention in both directions.
5. Fingering array length equals note count for a straight 2-octave C major run, and is absent for the same material in 3rds.
6. Every `PIANO_FING` row has exactly 7 entries per hand (catches data-entry slips in the table).
7. Switching instrument and back restores the prior fingering-mode selection.

### 8. Analytics

Add `instr` to the debounced `exercise` event (`index.html:2801`). Given the roadmap's standing feature freeze, whether piano mode actually gets used is worth measuring rather than assuming. No other event changes; no new PII.

## Phasing

Each phase is independently shippable and useful on its own.

| Phase | Content | Value delivered |
|---|---|---|
| 1 | Instrument toggle, `p` on notes, grand staff, no tab | Existing drills become readable at the piano |
| 2 | `keyboardSVG()` wired into Exercises | Visual |
| 3 | `PIANO_FING` table + render | Mostly data entry |
| 4 | Piano voicings | Reuses everything above |

## As built — deviations from the design above

All four phases shipped. Where implementation contradicted the design, the design was wrong:

**Staff gap is not a compromise.** The design flagged uniform step spacing as "tighter than engraved music". It isn't: on a real grand staff middle C is exactly one ledger line below the treble staff and one above the bass, which is precisely what pitch-linear spacing produces. Measured output is 8px line spacing and a 16px inter-staff gap, with middle C at the midpoint. No `STAFF_GAP` constant was needed.

**`buildPool` needed an instrument branch.** Not anticipated. Guitar anchors the pool at E2–Eb3, which is far too low to read or play at a keyboard. Piano anchors at C3 so a two-octave run straddles middle C.

**Voicing placement was rewritten.** The design said "place the root in the octave nearest C3". That is wrong for wide stacks — a R-7-3 shell spans 16 semitones and landed at Bb3-Ab4-D5, an octave above where anyone plays it. Voicings are now placed by centring each stack's **centroid** near middle C, which puts shells in the left hand (Bb2-Ab3-D4) and drop voicings around middle C (G3-C4-E4-B4).

**`chordStaffSVG` is a separate renderer.** `renderNotationSystems` lays notes out in time — columns, stems, flags, bar lines. A voicing is one vertical sonority. It is drawn separately as stemless whole notes, with two engraving details the main renderer doesn't need: seconds nudged right so noteheads don't overlap, and stacked accidentals staggered so they don't overprint.

**Two suppressions the design missed.** The follow-along playback highlight anchored on `.nn` (tab fret numbers), which piano has none of — it now anchors on whichever collection matches the note count, so highlighting works on both instruments. The neck-position voicing drill is hidden on piano rather than faked, since climbing neck positions has no keyboard equivalent.

**Copy output.** "Copy all tabs" produced `undefined` for pitch-only notes. Piano copies pitch names with octaves instead (`C3 D3 E3 F3 …`), spelled per key.

**Mobile was not considered in the design, and needed two fixes.** The keyboard is one wide picture whose whole point is seeing every lit key at once, so on narrow screens it now **scales to fit** rather than scrolling inside `.shapes` (which hid ~93px of keys in portrait). Fretboard diagrams keep scrolling — a 15-fret neck squashed to 322px would be illegible — so the keyboard row carries its own `.kbdrow` class instead of changing `.shape` globally.

Separately, the metronome's compact bar was gated on `@media(max-width:640px)`. A phone in landscape is ~812px wide, so it fell through to the full desktop bar, which wrapped into stacked rows taking 31% of a 375px-tall viewport — with the ⋯ collapse button hidden, so there was no way to shrink it. The slim-bar rules now trigger on **narrow *or* short** viewports (`max-height:560px`), with a further trim below 420px. This benefits guitar in landscape too.

### Fingering coverage is partial, deliberately

The design assumed the full table could be written. It could not be written *reliably* — traditions differ for several left hands, and a plausible-looking wrong fingering is silent and would only surface at the keyboard. What shipped:

| | Covered | Absent |
|---|---|---|
| Major RH | all 12 keys | — |
| Major LH | C, G, D, A, E, F | B, Gb, Db, Ab, Eb, Bb |
| Natural minor | A (both hands) | all other keys |
| Harmonic / melodic minor | aliases to natural minor | wherever natural minor is absent |

Unlisted keys render **no numbers at all** rather than a guess. Adding a key is one row in `PIANO_FING`; the smoke test checks row shape (7 entries per hand, fingers in 1–5) but cannot check musical correctness. **These need verification at an actual piano before being trusted, and the gaps need filling by ear.**

## Risks

- **The `p` refactor touches the shared guitar path.** Mitigated by test 1 above, which must be written *before* the refactor so the baseline is captured from current behavior.
- **`PIANO_FING` is bulk data.** Wrong entries are silent and only surface at the instrument. Test 6 catches shape errors, not musical ones; the minor-scale fallback is the most likely source of a musically wrong answer.
- **File growth.** `index.html` is already 4,362 lines. This adds several hundred more. Not addressed here — extracting modules would break the single-file property that the whole project depends on.
