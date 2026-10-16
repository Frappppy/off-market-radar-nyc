"""Detect WHO closes and HOW: poll the psycopg socket after txn1 with select/recv."""
import select
import socket
import time

import psycopg

t0 = time.time()
conn = psycopg.connect("postgresql://postgres@127.0.0.1:55432/postgres", connect_timeout=10)
with conn, conn.cursor() as cur:
    cur.execute("SELECT 1")
    cur.fetchone()
print(f"{time.time()-t0:.3f}s txn1 done; polling socket ...", flush=True)

sock = socket.socket(fileno=conn.fileno())  # wrap psycopg's fd (we won't close it)
sock.setblocking(False)
deadline = time.time() + 6
while time.time() < deadline:
    r, _, x = select.select([sock], [], [sock], 0.05)
    if r or x:
        try:
            data = sock.recv(4096)
            if data == b"":
                print(f"{time.time()-t0:.3f}s FIN received (recv returned empty)", flush=True)
                break
            print(f"{time.time()-t0:.3f}s data: {data[:60]!r}", flush=True)
        except (ConnectionResetError, OSError) as e:
            print(f"{time.time()-t0:.3f}s RESET/ERROR: {type(e).__name__}: {e}", flush=True)
            break
else:
    print(f"{time.time()-t0:.3f}s no socket event in 6s (flow still open?)", flush=True)

sock.detach()  # give the fd back to psycopg
try:
    conn.close()
except Exception:
    pass
