"""Raw python socket speaking just enough postgres v3 protocol: does the flow survive idle?"""
import socket
import struct
import time

HOST, PORT = "127.0.0.1", 55432
t0 = time.time()


def log(m):
    print(f"{time.time()-t0:6.3f}s {m}", flush=True)


def startup(user="postgres", database="postgres"):
    params = b"user\0" + user.encode() + b"\0database\0" + database.encode() + b"\0\0"
    body = struct.pack("!i", 196608) + params
    return struct.pack("!i", len(body) + 4) + body


def query(q):
    body = q.encode() + b"\0"
    return b"Q" + struct.pack("!i", len(body) + 4) + body


def read_until_ready(sock, label):
    """Read messages until ReadyForQuery ('Z')."""
    buf = b""
    while True:
        chunk = sock.recv(65536)
        if not chunk:
            log(f"{label}: EOF from server while reading!")
            return False
        buf += chunk
        while len(buf) >= 5:
            mtype = buf[0:1]
            mlen = struct.unpack("!i", buf[1:5])[0]  # includes the 4 length bytes, not the type byte
            if len(buf) < 1 + mlen:
                break
            payload, buf = buf[5 : 1 + mlen], buf[1 + mlen :]
            if mtype == b"Z":
                log(f"{label}: ReadyForQuery")
                return True
            if mtype == b"E":
                log(f"{label}: ErrorResponse: {payload[:120]!r}")


s = socket.create_connection((HOST, PORT), timeout=10)
log("connected")
s.sendall(startup())
assert read_until_ready(s, "startup")
s.sendall(query("SELECT 1"))
assert read_until_ready(s, "query1")
log("idling 3s with idle backend ...")
time.sleep(3)
try:
    s.sendall(query("SELECT 2"))
    ok = read_until_ready(s, "query2")
    log("RESULT: raw-python->postgres SURVIVED idle" if ok else "RESULT: died at query2")
except Exception as e:
    log(f"RESULT: raw-python->postgres FAILED: {type(e).__name__}: {e}")
s.close()
