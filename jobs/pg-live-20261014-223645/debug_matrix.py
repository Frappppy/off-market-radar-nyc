"""Isolation matrix: find what kills the connection right after txn1 commit."""
import time

import psycopg

DSN = "postgresql://postgres@localhost:55432/postgres"


def probe(name, work_sql, use_executemany=False, params=None):
    t0 = time.time()
    conn = psycopg.connect(DSN, connect_timeout=10)
    try:
        with conn:
            with conn.cursor() as cur:
                if use_executemany:
                    cur.executemany(work_sql, params or [])
                else:
                    cur.execute(work_sql, params)
                    cur.fetchone() if work_sql.strip().upper().startswith("SELECT") else None
        t1 = time.time()
        time.sleep(1.5)  # idle gap like the real store's mapping phase
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    cur.fetchone()
            print(f"{name:38s} txn1={t1-t0:5.2f}s  SURVIVED idle 1.5s", flush=True)
        except Exception as e:
            print(f"{name:38s} txn1={t1-t0:5.2f}s  DIED during idle: {type(e).__name__}: {e}", flush=True)
    except Exception as e:
        print(f"{name:38s} txn1 FAILED: {type(e).__name__}: {e}", flush=True)
    finally:
        try:
            conn.close()
        except Exception:
            pass


probe("A SELECT 1 only", "SELECT 1")
probe("B INSERT pipeline_runs", "INSERT INTO pipeline_runs (run_id, started_at, status) VALUES ('iso-B', now(), 'running') ON CONFLICT (run_id) DO UPDATE SET started_at=now()")
probe("C INSERT listings+commit", "INSERT INTO listings (source, listing_id) VALUES ('zillow','iso-C') ON CONFLICT (source,listing_id) DO UPDATE SET last_seen_at=now()")
probe("D multi-statement DDL", "SELECT 1; SELECT 2;")
probe("E executemany INSERT listings", "INSERT INTO listings (source, listing_id) VALUES (%s,%s) ON CONFLICT (source,listing_id) DO UPDATE SET last_seen_at=now()", use_executemany=True, params=[("zillow", "iso-E1"), ("zillow", "iso-E2")])
probe("F INSERT + SELECT after 1.5s", "INSERT INTO listings (source, listing_id) VALUES ('zillow','iso-F') ON CONFLICT (source,listing_id) DO UPDATE SET last_seen_at=now()")
