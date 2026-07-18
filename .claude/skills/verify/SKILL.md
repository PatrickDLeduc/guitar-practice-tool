---
name: verify
description: Build/launch/drive recipe for verifying changes to the Guitar Practice Helper single-file PWA.
---

# Verifying Guitar Practice Helper

Static single-file app — no build step.

## Launch
```bash
python -m http.server 8741   # from repo root, background it
```

## Drive (headless Chrome via playwright-core)
Install `playwright-core` in the scratchpad (NOT the repo — it stays dependency-free) and launch with `chromium.launch({ channel: 'chrome', headless: true })` — uses installed Chrome, no browser download.

Capture `pageerror` and console `error` events on every page; a favicon 404 on load is pre-existing noise.

## Flows worth driving
- Logged out: `.keyblock` count > 0 proves notation rendered; `#logBtn` click logs a session to localStorage key `gph`.
- Accounts (Supabase project `dlvdhuadhnglggayndgo`): `#acctBtn` → modal (`#acctEmail`, `#acctPass`, `#acctDoIn`/`#acctDoUp`, `#acctOut`). Cloud push is debounced 3s — wait ~4.5s before checking the `progress` table.
- Signup requires email confirmation; for test accounts, confirm via SQL: `update auth.users set email_confirmed_at = now() where email = ...`, then sign in. Delete test users afterward (`delete from auth.users where email like 'gph.test.%'` — cascades).
- Merge check: seed a second context's localStorage with a fake history, sign in, assert union in `gph` and in the Progress tab.
- Offline/CDN probe: `ctx.route('**/cdn.jsdelivr.net/**', r => r.abort())` — app must fully work, `#acctBtn` hidden, no page errors.

## Gotchas
- The account modal blocks clicks on the toolbar underneath — close it (`#acctClose`) before clicking `#logBtn`.
- App state lives in the URL hash; auth uses PKCE (`?code=`) so they don't collide — don't "fix" this.
