"""Watch psycopg's socket fd (MSG_PEEK, non-consuming) during/after commit: who closes, when."""
import socket
import threading
import time

import psycopg

t0 = time.time()


def log(msg):
    print(f"{time.time()-t0:7.3f}s {msg}", flush=True)


conn = psycopg.connect("postgresql://postgres@127.0.0.1:55432/postgres", connect_timeout=10)
log(f"connected, pgconn.status={conn.pgconn.status}")

cur = conn.cursor()
cur.execute("SELECT 1")
cur.fetchone()
log(f"txn1 fetched, pgconn.status={conn.pgconn.status}")

fd = conn.pgconn.socket
log(f"fd={fd} captured pre-commit")
watcher_sock = socket.socket(fileno=fd)
events = []
stop = threading.Event()


def watch():
    while not stop.is_set():
        try:
            r, _, _ = select_select([watcher_sock], [], [], 0.001)
        except OSError as e:
            events.append((time.time() - t0, f"select OSError {e} -> fd closed locally?"))
            return
        if r:
            try:
                data = watcher_sock.recv(65536, socket.MSG_PEEK)
            except OSError as e:
                if getattr(e, "winerror", None) == 10035:
                    continue  # WSAEWOULDBLOCK: raced with psycopg's own read
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


def select_select(r, w, x, t):
    import select as _select

    return _select.select(r, w, x, t)


threading.Thread(target=watch, daemon=True).start()

try:
    conn.commit()
    log("commit() returned OK")
except Exception as e:
    log(f"commit() raised: {type(e).__name__}: {e}")

time.sleep(3)
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
except Exception as e:
    log(f"conn.close() -> {type(e).__name__}: {e}")
