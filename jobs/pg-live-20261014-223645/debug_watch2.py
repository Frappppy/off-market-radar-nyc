"""EXACT debug_stability pattern (with conn: blocks) + fd watcher: does txn2 die, and what does the socket see?"""
import select
import socket
import threading
import time

import psycopg

t0 = time.time()


def log(msg):
    print(f"{time.time()-t0:7.3f}s {msg}", flush=True)


conn = psycopg.connect("postgresql://postgres@127.0.0.1:55432/postgres", connect_timeout=10)
log("connected")
fd = conn.pgconn.socket
watcher_sock = socket.socket(fileno=fd)
events = []
stop = threading.Event()


def watch():
    while not stop.is_set():
        try:
            r, _, _ = select.select([watcher_sock], [], [], 0.001)
        except OSError as e:
            events.append((time.time() - t0, f"select OSError {e}"))
            return
        if r:
            try:
                data = watcher_sock.recv(65536, socket.MSG_PEEK)
            except OSError as e:
                if getattr(e, "winerror", None) == 10035:
                    continue
                events.append((time.time() - t0, f"recv OSError {e}"))
                return
            if data == b"":
                events.append((time.time() - t0, "FIN from peer (recv=0)"))
                return
            events.append((time.time() - t0, f"data pending ({len(data)}B)"))
        try:
            st = conn.pgconn.status
        except Exception as e:
            events.append((time.time() - t0, f"pgconn.status raised {e}"))
            return
        if st != 0:
            events.append((time.time() - t0, f"pgconn.status={st} (BAD)"))
            return
    events.append((time.time() - t0, "no event before stop (still alive)"))


threading.Thread(target=watch, daemon=True).start()

with conn:
    with conn.cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
log("txn1 committed (with conn:)")

time.sleep(3)
log("waking, trying txn2 ...")
try:
    with conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 2")
            cur.fetchone()
    log("txn2 OK")
except Exception as e:
    log(f"txn2 FAILED: {type(e).__name__}: {e}")
    try:
        log(f"  conn.closed={conn.closed} pgconn.status={conn.pgconn.status}")
    except Exception as e2:
        log(f"  status check raised: {e2}")

stop.set()
time.sleep(0.05)
for ts, ev in events:
    print(f"   EVENT +{ts:6.3f}s: {ev}", flush=True)
try:
    watcher_sock.detach()
except Exception:
    pass
try:
    conn.close()
except Exception:
    pass
