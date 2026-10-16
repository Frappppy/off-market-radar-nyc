"""Dual-stack check: 127.0.0.1 (IPv4) vs localhost (maybe ::1) with the idle-death pattern."""
import socket
import time

import psycopg

print("localhost resolves to:", socket.getaddrinfo("localhost", 55432, type=socket.SOCK_STREAM)[0][4], flush=True)


def probe(name, host):
    dsn = f"postgresql://postgres@{host}:55432/postgres"
    t0 = time.time()
    try:
        conn = psycopg.connect(dsn, connect_timeout=10)
    except Exception as e:
        print(f"{name:24s} CONNECT FAILED: {e}", flush=True)
        return
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        time.sleep(3)
        with conn, conn.cursor() as cur:
            cur.execute("SELECT 2")
            cur.fetchone()
        print(f"{name:24s} SURVIVED 3s idle ({time.time()-t0:.2f}s)", flush=True)
    except Exception as e:
        print(f"{name:24s} DIED: {type(e).__name__}: {e} ({time.time()-t0:.2f}s)", flush=True)
    finally:
        try:
            conn.close()
        except Exception:
            pass


probe("IPv4 127.0.0.1", "127.0.0.1")
probe("IPv6 ::1", "[::1]")
probe("localhost", "localhost")
