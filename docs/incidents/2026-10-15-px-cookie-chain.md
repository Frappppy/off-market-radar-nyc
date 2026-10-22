# 2026-10-15 — PerimeterX challenged `/homedetails/` requests from cookie-less clients

**Stage:** 1 (scrape) · **Symptom:** the same detail URL answered `403` twice
from cookie-less clients while succeeding when the cookies a search page sets
were carried over. **Code affected:** `src/scrape/http.py` →
`ZillowClient.__init__` (persistent session comment).

## Narrative (moved verbatim from the old `http.py` comment)

> Without them PerimeterX challenged detail pages that pass when the cookie
> chain is intact (verified 2026-10-15: the same detail URL answered 403
> twice from cookie-less clients and 200 from this session).

## Resolution

One persistent `cffi_requests.Session()` per run: real browsers carry the
cookies a search page sets into subsequent `/homedetails/ requests. This is
ordinary browser behavior, never a challenge bypass — any actual challenge
still aborts the run (`CaptchaBlocked` → manifest `status=failed`).

## Where the code lives now

`ZillowClient.__init__` — `src/scrape/http.py`.
