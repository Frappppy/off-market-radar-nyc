"""Detached raw-socket echo server (mimics the detached postgres postmaster).
Run this, then later run debug_rawsock_client.py to test cross-command flow survival.
Listens on ::1 port 55498. Logs each accepted exchange to a file."""
import datetime
import socket
import threading

LOG = r"C:\Users\omisg\AppData\Local\Temp\opencode\pglive\rawsrv.log"


def log(msg):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{datetime.datetime.now().isoformat()} {msg}\n")


srv = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("::1", 55498))
srv.listen(4)
log("listening on ::1:55498")


def handle(conn):
    conn.settimeout(30)
    try:
        while True:
            data = conn.recv(1024)
            if not data:
                log("EOF from client")
                break
            log(f"got {data!r}")
            conn.sendall(b"pong")
    except Exception as e:
        log(f"error {e}")


while True:
    c, addr = srv.accept()
    log(f"accepted from {addr}")
    threading.Thread(target=handle, args=(c,), daemon=True).start()
