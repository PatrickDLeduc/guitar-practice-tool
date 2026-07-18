# 🎸 Guitar Practice Helper

A free, open-source practice environment for guitarists — scales, arpeggios, CAGED visualization, chord theory, ear training, jam tracks, and a practice log, all in **a single HTML file** that runs entirely in your browser. No install, no account required (an optional account syncs your progress across devices). Works offline, and installs to your phone's home screen as an app (PWA).

**[▶ Try it live](https://patrickdleduc.github.io/guitar-practice-tool/)**

---

## What it does

Type a request in plain English and get tablature + standard notation:

> *"major 7 arpeggios in 3rds along the cycle of 4ths"*
> *"A minor scale 3 notes per string, legato"*
> *"altered scale in 3rds in G, 3 octaves"*
> *"major scale in 5th position, circle of 4ths"*

Every exercise is rendered as engraved standard notation (written the guitar octave up, spelled correctly per key) aligned column-for-column with tab, with auto-generated fingerings.

## Features

### Exercises
- **Material**: all common arpeggios (triads through 7th chords) and scales (major/minor, all modes, pentatonics, blues, harmonic/melodic minor, whole tone, diminished, altered, bebop, and more)
- **Patterns**: straight, in 3rds, in 4ths, groups of 3/4 — ascending, descending (from the top note), or both
- **Key sequences**: single key, cycle of 4ths/5ths, chromatic, whole steps
- **Fingering modes**: auto position playing, 3-notes-per-string, or *one fixed neck position for all 12 keys* (the classic "play the whole cycle without moving your hand" drill)
- **Variations & technique focus**: reversed/zigzag groups, pedal root; coaching tips for alternate, economy, legato, sweep, and hybrid picking
- **CAGED visualization**: the five shapes as separate diagrams, or one full-neck map with labeled shape brackets and interval-colored dots
- **Playback**: hear any exercise as plucked-string synthesis (Karplus-Strong) at the metronome tempo, with count-in and looping; sustain a root drone for mode practice
- **Hands-free cycle drill**: auto-advance and auto-scroll to the next key every N bars while the metronome runs

### Chord stacking (upper-structure triads)
Pick a base chord and see what every triad superimposed on it produces — added tensions, the resulting chord name (D/Cmaj7 → Cmaj13♯11), slash-chord spelling, and a consonance rating. Hear any stack (pad + arpeggiated triad) or generate a practice exercise from the composite arpeggio.

### Progressions
- Type roman numerals (*ii-V-I in Bb*), chord symbols (*Dm7 G7 Cmaj7*), or *blues in A*
- **Voice-led lines**: each chord's arpeggio starts from the tone nearest the previous note — or switch to **guide tones** (3rds & 7ths only)
- **Harmony games (modal mixture)**: keep the home I chord and borrow the rest from any parallel mode — aeolian through melodic minor, every mode at once, or secondary dominants with automatic resolutions. Classic-move presets (backdoor ♭VII7, minor plagal, maj7 planing) and a borrowed-chord ear quiz
- **Jam tracks**: loop any progression as a backing band — drums, walking-style bass, and soft comping pads (or stabs, or bass & drums only)

### Voicings
Drop 2 (three string sets), drop 3, and shell voicings for nine chord qualities, shown as fretboard grips through every inversion. Click to hear.

### Ear training
Interval, chord, and scale identification at three difficulty levels, with random roots, replay, streaks, and scoring. Intervals can be ascending, descending, or harmonic.

### Metronome
Always available at the bottom: tap tempo, accent patterns for straight and odd meters (5/4, 7/8 in both groupings, 9/8, 11/8), visual beat dots, and a **speed trainer** that steps the tempo automatically every N bars toward a target.

### Progress
Log sessions at your current tempo; the Progress tab tracks personal-best BPM per exercise, practice-day streaks, a 14-day activity chart, and ear-training accuracy. By default all data stays in your browser (localStorage) — nothing is sent anywhere. Optionally, **sign in** (email/password or Google) to sync progress across devices; histories from multiple devices are merged, never overwritten. Logged-out behavior is unchanged.

Exercises are also **shareable**: every setting is encoded in the URL, so you can bookmark drills or send them to a friend.

## Running it

Any of these work:

- **Online**: open the GitHub Pages link above
- **On your phone**: open the link in Chrome → menu (⋮) → **Add to Home screen** / **Install app**. It runs fullscreen like a native app and works offline. The layout is mobile-friendly; the metronome bar shows the essentials, with a ⋯ button for the rest.
- **Locally**: download `index.html` and double-click it (the app itself is still a single file — the extra files in the repo only enable the install/offline behavior)
- **Host your own**: fork this repo → Settings → Pages → deploy from `main`

## Tech

Vanilla HTML/CSS/JavaScript, no build step. The only dependency is supabase-js (one CDN script tag) for the optional accounts/sync — if it fails to load, the app runs exactly as before. Audio is synthesized with the Web Audio API (lookahead-scheduled metronome, Karplus-Strong plucked strings, synthesized drums). Notation and fretboard graphics are hand-rolled SVG. PWA support (offline + home-screen install) is a web manifest and a small network-first service worker (`sw.js`).

> Note: browsers require a user interaction before audio can start — the first click on any play button takes care of it.

## Contributing / tweaking

Everything lives in `index.html`. The music-theory engine (note math, pattern generation, fingering assignment, chord analysis, harmonization) is in the marked `ENGINE` section of the script and is plain-JS testable in Node. PRs and issues welcome.

## License

MIT — use it, fork it, teach with it.
