"""Granular tracing of the store connection lifecycle (debug only, throwaway)."""
import time
import traceback

import psycopg

t0 = time.time()


def log(msg: str) -> None:
    print(f"{time.time() - t0:6.3f}s {msg}", flush=True)


conn = psycopg.connect("postgresql://postgres@localhost:55432/postgres", connect_timeout=10)
log("connected")

sql = open("sql/schema.sql", encoding="utf-8").read()
try:
    with conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        log("schema applied")
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO pipeline_runs (run_id, started_at, status, source) "
                "VALUES ('dbg-granular', now(), 'running', 'zillow') "
                "ON CONFLICT (run_id) DO UPDATE SET started_at=now()"
            )
        log("pipeline_runs insert done")
    log("txn1 committed")
except Exception:
    traceback.print_exc()

try:
    with conn:
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO listings (source, listing_id) VALUES (%s,%s) "
                "ON CONFLICT (source,listing_id) DO UPDATE SET last_seen_at=now()",
                [("zillow", "L1")],
            )
        log("executemany done")
    log("txn2 committed")
except Exception as e:
    log(f"txn2 FAILED: {type(e).__name__}: {e}")
    log(f"conn.closed={conn.closed} txn_status={conn.info.transaction_status}")

try:
    conn.close()
except Exception:
    pass
log("closed")
