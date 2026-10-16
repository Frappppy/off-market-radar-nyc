"""Stability probe: txn1, idle 3s, txn2 — the pattern that failed before."""
import time

import psycopg

t0 = time.time()
conn = psycopg.connect("postgresql://postgres@127.0.0.1:55432/postgres", connect_timeout=10)
with conn:
    with conn.cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
print(f"{time.time()-t0:.2f}s txn1 ok; idling 3s ...", flush=True)
time.sleep(3)
try:
    with conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 2")
            cur.fetchone()
    print(f"{time.time()-t0:.2f}s PASS: txn2 ok after idle", flush=True)
except Exception as e:
    print(f"{time.time()-t0:.2f}s FAIL: {type(e).__name__}: {e}", flush=True)
finally:
    try:
        conn.close()
    except Exception:
        pass
