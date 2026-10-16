"""Force psycopg pure-python impl (PSYCOPG_IMPL=python) + conda libpq on PATH, then probe idle survival."""
import os
import sys
import time

os.environ["PSYCOPG_IMPL"] = "python"
conda_bin = r"C:\Users\omisg\AppData\Local\Temp\opencode\pglive\Library\bin"
os.add_dll_directory(conda_bin)
os.environ["PATH"] = conda_bin + os.pathsep + os.environ["PATH"]

import psycopg  # noqa: E402
from psycopg import pq  # noqa: E402

print("impl:", pq.__impl__, "libpq:", pq.version(), flush=True)

t0 = time.time()
conn = psycopg.connect("postgresql://postgres@127.0.0.1:55432/postgres", connect_timeout=10)
with conn, conn.cursor() as cur:
    cur.execute("SELECT 1")
    cur.fetchone()
print(f"{time.time()-t0:.2f}s txn1 ok; idling 4s ...", flush=True)
time.sleep(4)
try:
    with conn, conn.cursor() as cur:
        cur.execute("SELECT 2")
        cur.fetchone()
    print(f"{time.time()-t0:.2f}s PASS: survived idle with python impl + conda libpq", flush=True)
except Exception as e:
    print(f"{time.time()-t0:.2f}s FAIL: {type(e).__name__}: {e}", flush=True)
finally:
    try:
        conn.close()
    except Exception:
        pass
sys.exit(0)
