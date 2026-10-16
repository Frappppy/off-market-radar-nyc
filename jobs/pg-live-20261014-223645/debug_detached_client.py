"""Client for the detached echo server: idles 2s then sends again."""
import socket
import time

t0 = time.time()
c = socket.create_connection(("::1", 55498), timeout=10)
c.sendall(b"hello")
time.sleep(0.3)
try:
    r = c.recv(1024)
    print(f"{time.time()-t0:.2f}s recv: {r!r}", flush=True)
except Exception as e:
    print(f"{time.time()-t0:.2f}s recv FAILED: {e}", flush=True)
print(f"{time.time()-t0:.2f}s idling 2.5s ...", flush=True)
time.sleep(2.5)
try:
    c.sendall(b"after-idle")
    print(f"{time.time()-t0:.2f}s after-idle send OK", flush=True)
    r = c.recv(1024)
    print(f"{time.time()-t0:.2f}s recv: {r!r}", flush=True)
except Exception as e:
    print(f"{time.time()-t0:.2f}s FAILED: {e}", flush=True)
c.close()
