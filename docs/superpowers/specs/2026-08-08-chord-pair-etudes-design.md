# Chord Pair Études — Design

Date: 2026-08-08

## Context

The Études tab ([`index.html:2211`](../../../index.html)) holds 45 hand-written technique studies as a static
array. Each is a `"string:fret"` string, four bars of eight eighth notes, one chord per bar, tagged
with a picking technique (`alternate`, `economy`, `legato`, `sweep`, `hybrid`) and a level. Everything
downstream — notation, text tab, playback with chord pads, the ⟳ 12-keys circle-of-fourths run,
auto-advance, deep links, 🎲 — already works off that shape.

Two properties of the existing design carry this feature:

- **Études are data, not a generator.** They cost nothing at runtime and work offline.
- **Transposition slides frets and leaves strings alone** ([`index.html:4928`](../../../index.html)), so
  the fingering — and with it the picking problem — survives a key change intact.

## Goal

Add a tenth-through-eighteenth study to the library: **nine triad-pair études** teaching the
Ryan Devlin methodology — for each chord, a pair of triads chosen by functional rule, interwoven
rather than arpeggiated, using inversions for angular motion, voice-led across chord changes.

Triad pairs are *note-choice* vocabulary, not picking-hand technique. The tab's Technique filter
gains a sixth value rather than a second axis; see Decisions.

### Non-goals

- **A triad-pair generator.** Enter a progression, get a written line. Genuinely new capability,
  but generated interweaving sounds like an algorithm, and the craft is the point. Deferred to its
  own spec.
- **Per-note durations.** See "Rhythmic displacement" below — the expensive half is engraving, and
  the musical device is reachable without it.
- **Tune-named études.** The source collection is written over standards. These are named for the
  harmonic situation, matching how the other 45 are named and keeping the tab transferable.
- **Δ / - / + symbols.** The app's own `CHORD_SYM` convention is used throughout.

## Decisions

| Question | Decision |
|---|---|
| Deliverable | Hand-written études in the `ETUDES` array |
| Rhythm | Per-étude subdivision: uniformly eighths **or** uniformly triplets |
| Form length | Mixed — 4 or 8 bars, chosen per étude |
| Harmony | Generic situations, not tune names |
| Taxonomy | Sixth option in the Études Technique filter |
| Labels | Chord symbol, with the triad pair stacked beneath it |
| Symbols | App convention (`C` / `Dm` / `Caug`) |
| Count | Nine — three per level, forced by an existing test invariant |

## Rhythmic displacement, and why the grid stays uniform

The source etudes use mixed eighths and triplets within a bar. That is not free here.

**Playback is cheap.** `playNotes` builds onsets from an index counter
([`index.html:4763`](../../../index.html)): `slots = noteList.map(n => n.stack && slot ? slot-1 : slot++)`.
Per-note durations means `slot += n.d`. `trackPlayback` already takes `slots` as an array of
per-note positions, so the follow-along highlight needs nothing. ~15 lines, plus ~10 in
`markBarLines` to accumulate durations rather than count.

**Engraving is not.** `renderNotationSystems` lays notes out as equal-width columns (`cols`, `c.x`,
`cW`). `nv` decides only three cosmetic things today: flag count
([`index.html:1777`](../../../index.html)), notehead fill ([`index.html:1783`](../../../index.html)), and
triplet numerals ([`index.html:1802`](../../../index.html)). Mixed durations means variable column
widths, real beaming groups, and triplet brackets over arbitrary subsets — a rewrite of the layout
core, in a function shared by the Exercises, Progressions, Practice and Études tabs.

**The device does not require it.** Across-the-barline phrasing comes from a group length that does
not divide the bar. A three-note triad against eight eighths phase-shifts every bar and realigns
only after three (LCM 24 — bar 4, beat 1). The library already works this way; from
[`index.html:2259`](../../../index.html): *"Because the cell is four long and the strings hold three,
the crossing lands in a different place in every repetition."*

So displacement is written into the note groupings:

- **Eighth-note études** — three-note cells against eight per bar. Phases across all four bars.
- **Triplet études** — four-note interweave cells (two notes from each triad) against twelve per
  bar. The cell crosses the triplet-group boundaries, giving the quarter-note-triplet superimposition,
  and the notation's `3` brackets show it.

Per-note durations remain a known, tracked deferral, marked with a `ponytail:` comment at the
subdivision constants.

## Architecture

### 1. Per-étude subdivision and bar count

`ET_NOTES_PER_BAR` and `ET_NV` ([`index.html:2222`](../../../index.html)) are constants used at six
sites. They become per-étude, defaulting to today's values so the existing 45 are untouched:

```js
const etNv  = et => et.nv ?? 'eighth';
const etNpb = et => et.nv === 'triplet' ? 12 : 8;
```

Bar count already falls out of the `/` splits in `etudeGroups`. Two places hardcode 4: `etudePads`
(via `ET_NOTES_PER_BAR`) and the auto-advance tooltip at
[`index.html:5054`](../../../index.html), which reads "the étude is 4 bars, so 8 is twice through".
Both derive from `groups.length`.

Call sites to update: [`4969`](../../../index.html), [`4984`](../../../index.html),
[`4995`](../../../index.html), [`5004`](../../../index.html), [`5039`](../../../index.html).

### 2. Triad-pair data

A new optional field `tp`, one pair per bar, in the same shape as the tab string — `pc:qual`
tokens, space-separated, ` / ` between bars:

```js
tp: '2:min 4:min / 7:maj 9:maj / 0:maj 2:maj / 0:maj 2:maj'
```

Stored as pitch classes, not literal names, so `etudeIn` transposes the pairs with the exact
interval it already applies to `chords` — the labels stay correct through all twelve keys with no
extra logic. Accidental spelling follows the same one-family-per-progression rule already in
`etudeIn` ([`index.html:4942`](../../../index.html)).

`maj`, `min` and `aug` all exist in `QUALITIES` and `CHORD_SYM`
([`index.html:1836`](../../../index.html)), so label construction reuses `NM[pc] + CHORD_SYM[qual]`
unchanged.

### 3. Stacked bar labels

`renderNotationSystems` takes `labels` and draws one `<text>` at `y=14`, reserving 28px of headroom
([`index.html:1718`](../../../index.html), [`1726`](../../../index.html)). A label entry becomes
*either* a string (every existing caller, unchanged) *or* a `[main, sub]` pair:

- main line at `y=14`, as now
- sub line at `y=25`, smaller and in `var(--muted)`
- `staffTop` headroom 28 → 38 when any label in the system has a sub

Étude cards pass `[chord.label, 'Dm / Em']`.

### 4. Filter and tip

`triadpair` as a sixth `#etTech` option ([`index.html:795`](../../../index.html)), plus a
`TECH_TIPS` entry describing the method.

`etudeTip` ([`index.html:4978`](../../../index.html)) currently reads its display name out of the
**Exercises tab's** `selTech` dropdown ([`index.html:621`](../../../index.html)). Adding a sixth
value there would offer "Triad pairs" as a picking-technique focus for generated exercises, where it
means nothing. `etudeTip` gets a local name map instead, and the Exercises dropdown stays
picking-only.

## The nine études

Three per level — an invariant, not a preference; see Testing. `×2` in a chord column means the
four-chord progression is played twice, giving eight bars; `×4` means one chord held for all four
bars. Everything is written in a convenient key and transposes to the other eleven.

### Beginner — 4 bars, eighths

| id | Situation | Chords | Pairs | Teaches |
|---|---|---|---|---|
| `tp-dorian-vamp` | Dorian vamp, minor pairs a whole step apart | `Dm7` ×4 | Dm / Em | The natural 13 arriving from the upper triad |
| `tp-lydian-maj7` | Lydian major 7th, major pairs a whole step apart | `Cmaj7` ×4 | C / D | 9, ♯11 and 13, all from one triad |
| `tp-bvii-dominant` | Flat-seven pair over a dominant | `C7` ×4 | B♭ / C | ♭7, 9 and 11 without leaving two shapes |

### Intermediate

| id | Situation | Bars | Chords | Pairs |
|---|---|---|---|---|
| `tp-lydian-dominant` | Lydian dominant, major pairs a whole step apart | 4, eighths | `C7 F7 C7 C7` | C/D · F/G · C/D · C/D |
| `tp-half-dim` | Minor pairs over a half-diminished chord | 4, eighths | `Bm7b5` ×4 | Dm / Em |
| `tp-major-251` | Major ii–V–I, a device per chord | 8, eighths | `Dm7 G7 Cmaj7 Cmaj7` ×2 | Dm/Em · G/A · C/D · C/D |

### Advanced — triplets

| id | Situation | Bars | Chords | Pairs |
|---|---|---|---|---|
| `tp-tritone-outside` | Tritone-apart majors over a dominant | 4 | `C7` ×4 | C / F♯ |
| `tp-altered-augmented` | Augmented pairs over an altered dominant | 4 | `G7 G7 Cm7 Cm7` | Gaug/Faug · Cm/Dm |
| `tp-minor-251-tritone` | Minor ii–V–i with a tritone-sub pair on the i | 8 | `Dm7b5 G7 Cm7 Cm7` ×2 | Fm/Gm · Gaug/Faug · Cm/Dm · Cm/F♯m |

Every étude carries a `why` blurb in the house voice, saying what the pair does to the chord and
what the hand has to solve.

### Writing constraints

- **Interweaving, not arpeggios.** Alternate between the triads inside each cell — 2+1 or 2+2
  patterns, never a full triad up followed by a full triad down.
- **Inversions.** First and second inversions, so the leaps are wide.
- **Voice leading.** Each bar ends within a step or two of where the next begins.
- **Seven-fret window per bar.** Enforced by an existing test
  ([`smoke.js:231`](../../../tests/smoke.js)). Wide intervals must come from string-skipping inside one
  position, not hand shifts. This binds the "angular leaps" requirement to something playable.
- **On the neck in all twelve keys.** The existing octave-drop rule
  ([`index.html:4940`](../../../index.html)) keeps frets in 0–23; new études must satisfy it too.

## Testing

`tests/smoke.js` enforces four invariants over the étude library that this feature touches.

**Must be made per-étude:**

- [`smoke.js:221`](../../../tests/smoke.js) — `groups.length !== 4 || g.length !== ET_NOTES_PER_BAR`.
  Becomes: bar count equals the chord count, and every bar holds `etNpb(e)` notes.
- [`smoke.js:360`](../../../tests/smoke.js) — `run.notes === 12 * 4 * 8`. Becomes
  `12 * bars * etNpb`.

**Must be made device-appropriate:**

- [`smoke.js:233`](../../../tests/smoke.js) — every note in `QUALITIES[e.qual]` or a semitone approach.
  `qual` is **test-only metadata**: nothing renders from it, and neither `etudeIn` nor `etudeCard`
  reads it. For `tech === 'triadpair'` this is replaced by a stricter, more meaningful check —
  **every note in bar N is a chord tone of one of bar N's two declared triads**, with the same
  semitone-approach escape hatch. That is the definition of triad-pair writing, and unlike a single
  parent scale it covers études that switch device mid-progression.

**Holds as-is, and constrains the design:**

- [`smoke.js:252`](../../../tests/smoke.js) — exactly three per technique per level. This is what fixes
  the set at nine, 3/3/3, rather than "about nine".
- [`smoke.js:231`](../../../tests/smoke.js) — seven-fret window per bar.
- [`smoke.js:217`](../../../tests/smoke.js) — `TECH_TIPS[e.tech]` must exist; the new tip satisfies it.
- [`smoke.js:270-297`](../../../tests/smoke.js) — the transposition suite runs all études in all twelve
  keys. It covers the new ones unchanged.

**New assertions:**

- Every `tp` entry parses, has exactly two triads per bar, and has one entry per bar.
- Triad pairs transpose with the same interval as the chords, in all twelve keys.
- Stacked labels render a sub-line on triad-pair cards and not on the other 45.
- A triplet étude's follow-along highlight tracks at triplet speed while the Exercises tab is left
  on another note value — the existing per-étude-subdivision assertion at
  [`smoke.js:314-320`](../../../tests/smoke.js), extended to triplets.

## Risks

- **Relaxing the 4×8 shape check** is the one place this weakens an existing guarantee. Mitigated by
  making it per-étude rather than removing it: the shape is still asserted, just against the
  étude's own declaration.
- **Hand-written notation is the failure surface.** A fret typo is a wrong note. The triad-membership
  check catches exactly this class of error, and catches it more precisely than the scale check it
  replaces.
- **Nine études is a lot of hand-written data.** Levels are ordered beginner-first so a partial
  landing is still a coherent set, though the three-per-level test means the feature is not green
  until all nine exist.
