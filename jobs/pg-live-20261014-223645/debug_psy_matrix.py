"""Matrix: what survives - autocommit, keepalives off, keepalives 2h."""
import time

import psycopg

DSN = "postgresql://postgres@127.0.0.1:55432/postgres"


def probe(name, **kwargs):
    t0 = time.time()
    try:
        conn = psycopg.connect(DSN, connect_timeout=10, **kwargs)
    except Exception as e:
        print(f"{name:30s} CONNECT FAILED: {e}", flush=True)
        return
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        time.sleep(2.5)
        with conn, conn.cursor() as cur:
            cur.execute("SELECT 2")
            cur.fetchone()
        print(f"{name:30s} SURVIVED 2.5s idle ({time.time()-t0:.2f}s)", flush=True)
    except Exception as e:
        print(f"{name:30s} DIED: {type(e).__name__}: {e} ({time.time()-t0:.2f}s)", flush=True)
    finally:
        try:
            conn.close()
        except Exception:
            pass


probe("A default")
probe("B autocommit=True", autocommit=True)
probe("C keepalives=0", keepalives=0)
probe("D ka idle=7200", keepalives=1, keepalives_idle=7200, keepalives_interval=10, keepalives_count=6)
probe("E default again", autocommit=False)
