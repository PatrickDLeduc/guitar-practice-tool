# An exercise spec travels as a positional array

An exercise spec is a named object in memory, but every persisted and shared form of it — the `#ex=` link, saved favourites, logged practice sessions, and Today's Practice block definitions — is a positional array of string values whose slot order is fixed by `EX_FIELDS` in `index.html`. The obvious alternative, storing self-describing objects, was rejected: shared links are a documented feature, and the app is an offline-capable PWA whose service worker can keep an old build running indefinitely on one device while a newer build syncs the same cloud blob through `mergeProgress`. Self-describing storage would therefore need to accept both shapes forever anyway, so it would buy readability at the cost of a permanent second code path.

## Consequences

`EX_FIELDS` is **append-only**. Inserting or reordering a field silently reinterprets every link, favourite and session already in the wild — including ones on other people's devices and in the cloud. New fields go on the end, and `decode()` fills missing trailing slots from defaults, which is what makes short links and older arrays keep working.

Instrument is deliberately not a slot, even though appending it would have been safe. It arrived with piano support and already had two homes — `i=p` in the hash and `d.instr` in the store — so adding a third would have meant three places to disagree about which instrument an exercise is for.
