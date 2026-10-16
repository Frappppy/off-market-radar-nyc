"""ctypes + conda libpq (no psycopg at all): simple vs extended query protocol, watch who closes first."""
import ctypes
import select
import socket
import time
from ctypes import c_char_p, c_int, c_void_p

BIN = r"C:\Users\omisg\AppData\Local\Temp\opencode\pglive\Library\bin\libpq.dll"
lib = ctypes.CDLL(BIN)

lib.PQconnectdb.argtypes = [c_char_p]
lib.PQconnectdb.restype = c_void_p
lib.PQstatus.argtypes = [c_void_p]
lib.PQstatus.restype = c_int
lib.PQexec.argtypes = [c_void_p, c_char_p]
lib.PQexec.restype = c_void_p
lib.PQexecParams.argtypes = [c_void_p, c_char_p, c_int, c_void_p, c_void_p, c_void_p, c_void_p, c_int]
lib.PQexecParams.restype = c_void_p
lib.PQresultStatus.argtypes = [c_void_p]
lib.PQresultStatus.restype = c_int
lib.PQclear.argtypes = [c_void_p]
lib.PQfinish.argtypes = [c_void_p]
lib.PQsocket.argtypes = [c_void_p]
lib.PQsocket.restype = c_int
lib.PQerrorMessage.argtypes = [c_void_p]
lib.PQerrorMessage.restype = c_char_p

CONN_OK = 0  # libpq C enum: CONNECTION_OK=0, CONNECTION_BAD=1
DSN = b"host=127.0.0.1 port=55432 dbname=postgres user=postgres connect_timeout=10"


def monitor(pgconn, seconds, label):
    """Poll fd readability + PQstatus; report the first event."""
    fd = lib.PQsocket(pgconn)
    if fd < 0:
        print(f"  {label}: PQsocket={fd} (dead already)", flush=True)
        return "bad"
    s = socket.socket(fileno=fd)
    t0 = time.time()
    verdict = "alive"
    try:
        while time.time() - t0 < seconds:
            r, _, _ = select.select([s], [], [], 0.05)
            st = lib.PQstatus(pgconn)
            if r:
                try:
                    data = s.recv(65536)
                except Exception as e:
                    print(f"  {label}: {time.time()-t0:.3f}s RESET/ERR {type(e).__name__}: {e}", flush=True)
                    verdict = "reset"
                    break
                if data == b"":
                    print(f"  {label}: {time.time()-t0:.3f}s FIN from peer (recv=0), PQstatus={st}", flush=True)
                    verdict = "fin-from-server"
                    break
                print(f"  {label}: {time.time()-t0:.3f}s DATA {data[:50]!r}", flush=True)
            if st != CONN_OK:
                print(f"  {label}: {time.time()-t0:.3f}s PQstatus={st} (BAD), no fd event -> local close?", flush=True)
                verdict = "local-close"
                break
        else:
            print(f"  {label}: survived {seconds}s, PQstatus={lib.PQstatus(pgconn)}", flush=True)
    finally:
        s.detach()  # hand fd back to libpq
    return verdict


def run(label, extended):
    print(f"=== {label} (extended={extended}) ===", flush=True)
    pgconn = lib.PQconnectdb(DSN)
    if lib.PQstatus(pgconn) != CONN_OK:
        print("  connect failed:", lib.PQerrorMessage(pgconn), flush=True)
        lib.PQfinish(pgconn)
        return
    if extended:
        res = lib.PQexecParams(pgconn, b"SELECT 1", 0, None, None, None, None, 0)
    else:
        res = lib.PQexec(pgconn, b"SELECT 1")
    print(f"  txn1 resultStatus={lib.PQresultStatus(res)}", flush=True)
    lib.PQclear(res)
    v = monitor(pgconn, 3.0, "idle")
    if v == "alive":
        if extended:
            res = lib.PQexecParams(pgconn, b"SELECT 2", 0, None, None, None, None, 0)
        else:
            res = lib.PQexec(pgconn, b"SELECT 2")
        ok = lib.PQresultStatus(res)
        print(f"  txn2 resultStatus={ok} ({'WORKED' if ok == 2 else 'FAILED'})", flush=True)
        lib.PQclear(res)
    lib.PQfinish(pgconn)


run("A simple PQexec", extended=False)
run("B extended PQexecParams", extended=True)
