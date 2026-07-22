# Polyrhythm Visualizer — Design

Date: 2026-07-21

## Context

Guitar Practice Helper is a single 3,150-line vanilla HTML/CSS/JS file (`index.html`), no build step, no TypeScript, no framework. Tabs are `<button class="tabbtn" data-tab="...">` + a matching `<div id="view...">` panel, toggled by one click handler (`index.html:1708`). Audio features share one lazily-created `AudioContext` (`metro.ctx`, via `ensureAudio()` at `index.html:1850`) and a compressor bus (`metro.bus`), rather than each feature owning its own context. The metronome (`index.html:2725`) uses a lookahead scheduler: `setInterval` every `LOOKAHEAD_MS`, scheduling audio events into a window `AHEAD` seconds ahead of `ctx.currentTime`. The music-theory "ENGINE" section (`index.html:660-1309`) holds pure, Node-testable functions. Tests are one Playwright script (`tests/smoke.js`) driving the real page in headless Chrome, calling internal functions directly via `page.evaluate` (e.g. `parseMeterSeq`, `detectPitch`) alongside UI-interaction assertions. `localStorage` persistence goes through a tiny `store` object (`index.html:1735`).

This spec adapts the requested feature (originally scoped as a React/TypeScript multi-file build) to that architecture. Deviations from the original ask, and why, are called out inline.

## Goal

Add a "Poly" tab: an interactive polyrhythm (A:B) visualizer/trainer — accurate synchronized clicks, circular + linear-grid animated views, a timing-analysis panel, and practice modes — usable on desktop and mobile, keyboard-accessible, consistent with the rest of the app.

## Math module

Pure functions, colocated near (not necessarily inside) the existing `ENGINE` section so they stay Node-testable the same way:

```js
gcdOf(a, b)
lcmOf(a, b)
simplifyRatio(a, b)                 // {a, b} reduced, or same values if already simplified
polyPulses(a, b)                    // {lcm, a: [subdivision indices...], b: [...]}
polyPulseTimes(a, b, cycleMs)       // {a: [ms...], b: [ms...], shared: [ms...]}
polyPattern(a, b)                   // {lineA, lineB, lineCombined} — ASCII, per spec's "X . . ." example
```

Validation: inputs clamped to 1–16 in the UI; `a === b` is allowed but the UI labels it "not a polyrhythm — both rhythms play together" rather than rejecting it.

Internally, all scheduling/timestamps are computed from exact fractions of the cycle (`cycleMs * i / a`, etc.) — never derived from rounded pixel/grid positions.

## Audio scheduler

Reuses the app's single shared `AudioContext` (`ensureAudio()`) and `metro.bus` — this app never runs two `AudioContext`s. A new `poly` state object mirrors `metro`'s scheduler shape:

```js
const poly = {
  ctx: null, playing: false, a: 3, b: 4, bpm: 90, bpmRef: 'cycle', // 'a'|'b'|'cycle'
  cycleMs: 0, cycleStartTime: 0, cycleCount: 0,
  events: [], eventIdx: 0,           // one cycle's worth, precomputed & sorted
  LOOKAHEAD_MS: 25, AHEAD: 0.1,
  gainA: null, gainB: null, muteA: false, muteB: false, soloA: false, soloB: false,
};
```

`events` is recomputed whenever `a`, `b`, `bpm`, `bpmRef`, or phase offset changes. The scheduler loop (`setInterval`, same cadence as the metronome's) walks `events` circularly, computing each absolute schedule time as `cycleStartTime + cycleCount*cycleMs/1000 + event.tSec`, scheduling into the `AHEAD` window, and incrementing `cycleCount` (+ any cycle-boundary hooks: practice-mode logic, cycle counter UI) on wraparound. This avoids per-beat incremental math bugs since the whole cycle's timing is known upfront — simpler than the main metronome's beat-by-beat approach, appropriate since a polyrhythm cycle is a fixed, fully-known pattern.

Only one of {main metronome, poly scheduler} runs at a time: starting one stops the other (both write to the same audio output; concurrent schedulers would just be layered noise, and the spec explicitly requires no duplicate/overlapping schedulers). Tempo changes recompute `events`/timing without tearing down and recreating the `setInterval` — same guard pattern the metronome doesn't currently need but poly does, since ratio changes mid-play must not double-schedule.

`bpmRef` selects what BPM means: Rhythm A's pulse rate, Rhythm B's, or one shared cycle per beat — all three derive `cycleMs` differently but the UI always shows the resulting cycle duration and both pulse intervals in the analysis panel, so it's never ambiguous.

Distinct timbre: rhythm A and B clicks differ in oscillator frequency/type (small preset picker, 2–3 options each, not a synth designer — no existing UI pattern for that here). Simultaneous strikes schedule one combined click, louder/brighter, instead of two overlapping ones.

Tab visibility: on `visibilitychange` to hidden, keep the scheduler running (Web Audio timing is unaffected by rAF throttling) but skip visual updates; on return, the next rAF just re-reads current `ctx.currentTime` and snaps the playhead back in sync — no drift accumulates since position is always derived from absolute time, never accumulated.

## Visualization

Two SVG views (hand-rolled SVG, matching the app's existing fretboard/notation rendering — no canvas, no chart library):

- **Circular**: shared cycle as a circle, rhythm A pulses on the outer ring, rhythm B on an inner ring, rotating playhead line, pulses flash on strike, shared strikes get a distinct marker (shape, not just color — accessibility requirement).
- **Linear grid**: LCM subdivision columns, two rows (A/B), playhead as a vertical line, shared-alignment columns highlighted. Rendered as SVG rects/lines (not one DOM element per subdivision as HTML), so even the worst case in the 1–16 range (`lcm(15,16)=240`) stays cheap.

Both driven by `requestAnimationFrame`, position computed each frame as `(poly.ctx.currentTime - cycleStartTime) / (cycleMs/1000)` mod 1 — never frame-incremented, so it can't drift from the audio clock and self-corrects after tab-throttling.

`prefers-reduced-motion`: replace the continuously moving playhead with a discrete per-pulse highlight (light up the current step only, no interpolated motion) in both views.

## Analysis panel

Ratio, simplified ratio, GCD, LCM, subdivision count, cycle duration, A/B pulse intervals — each shown in ms and as a fraction where relevant. ASCII pattern lines per the spec's `3:4` example, with a legend. Collapsible table (event #, time ms, % cycle, A/B/shared flags) — plain text/HTML table, no virtualization needed at these sizes.

## Practice modes (5 of the spec's 6)

1. **Listen & follow** — both play, either mutable, visualization stays on.
2. **Rhythm isolation** — user picks a side; its gain ramps to zero over N cycles while its visual pulse keeps flashing.
3. **Alternating focus** — emphasize A for N cycles, then B for N cycles, then both equally, repeating; driven off the scheduler's cycle-boundary hook.
4. **Progressive tempo** — bump `poly.bpm` by a configurable step (1/2/5/10) after N completed cycles, up to a max BPM. Reuses the scheduler's existing tempo-recompute path, so it's cheap to add.
5. **Random challenge** — generate `a`, `b` within configurable min/max and max-LCM, tempo range, optionally excluding reducible ratios; optional hide-ratio-until-reveal.

**Dropped for v1: tap accuracy / MIDI.** The app has no tap-input or MIDI infrastructure today (verified: no `MIDIAccess` usage anywhere), and reliable timing-error measurement needs its own input-latency-aware subsystem — the spec itself flags this as easy to overclaim precision on. Building it well is a separate, self-contained feature; bolting on a rough version just to check a box would be the "shaky feature" this app's existing quality bar (see the smoke test's precision checks on pitch detection and audio buffers) argues against. Five modes clears the "≥4 functional" acceptance bar with features that are fully groundable in what the app already does.

## Advanced controls (subset)

- Phase offset for rhythm B, with four synced representations (degrees / subdivisions / ms / % of cycle) — one is the source of truth per edit, the other three recompute on change.
- Delayed entry: rhythm B can be gated to start after N cycles instead of immediately.
- Count-in (one shared cycle, click-only, before rhythm playback starts).
- Keyboard shortcuts scoped to when the Poly tab is active and focus isn't in a text input: space = play/pause (`preventDefault` so it doesn't scroll), arrow up/down = tempo ±1.

Dropped: reverse/rotate visual pattern, arbitrary per-pulse accenting beyond the shared-strike accent. Low value for the added UI surface; not required by acceptance criteria.

## Persistence

New `localStorage` key (e.g. `gphPoly`), through a two-function wrapper mirroring the existing `store` object (`index.html:1735`) — no new abstraction beyond what's already there. Saves ratio, BPM/bpmRef, mode, volumes/mute/solo, phase offset.

## Testing

Extended in `tests/smoke.js`, following the existing style (call internals via `page.evaluate`, drive the real UI for interaction/cleanup checks):

- Math: `gcdOf`/`lcmOf` known values, `polyPulses`/`polyPulseTimes` for 2:3, 3:4, 4:5, and a reducible case (4:6), alignment/shared points, invalid input (0, negative, >16) handling.
- Exercise generation: random-challenge respects min/max/maxLCM/tempo bounds over repeated draws; progressive tempo stops at configured max; alternating-focus cycle sequencing.
- UI: preset buttons set the ratio; swap button swaps it; mute/solo toggle instantly; play → stop leaves no running interval (no duplicate clicks on restart); switching tabs away mid-playback stops the scheduler and cancels the rAF loop; a11y label check (already generic in the smoke test) covers the new controls for free.

## Acceptance mapping

All 12 criteria from the original ask are met except tap-accuracy-specific claims, which are out of scope per the practice-modes decision above; "≥4 practice modes functional" is met with 5.
