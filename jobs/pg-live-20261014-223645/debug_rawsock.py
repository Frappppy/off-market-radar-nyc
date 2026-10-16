"""Bare-socket localhost test: is the TCP flow itself killed, or is it postgres-specific?"""
import socket
import threading
import time

srv = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("::1", 55499))
srv.listen(1)

results = []


def server():
    conn, addr = srv.accept()
    conn.settimeout(10)
    try:
        while True:
            data = conn.recv(1024)
            if not data:
                results.append("server: EOF (client side closed)")
                break
            results.append(f"server: got {data!r} at t={time.time()-t0:.3f}")
            conn.sendall(b"pong")
    except socket.timeout:
        results.append("server: recv timeout")
    except Exception as e:
        results.append(f"server: error {e}")


t0 = time.time()
th = threading.Thread(target=server, daemon=True)
th.start()

c = socket.create_connection(("::1", 55499), timeout=10)
c.sendall(b"ping1")
time.sleep(0.3)
try:
    c.sendall(b"ping2")
    results.append(f"client: ping2 sent at t={time.time()-t0:.3f}")
except Exception as e:
    results.append(f"client: ping2 FAILED at t={time.time()-t0:.3f}: {e}")
time.sleep(0.6)
try:
    c.sendall(b"ping3-after-0.6s-idle")
    results.append(f"client: ping3 sent at t={time.time()-t0:.3f}")
except Exception as e:
    results.append(f"client: ping3 FAILED at t={time.time()-t0:.3f}: {e}")
time.sleep(1.5)
try:
    c.sendall(b"ping4-after-1.5s-idle")
    results.append(f"client: ping4 sent at t={time.time()-t0:.3f}")
except Exception as e:
    results.append(f"client: ping4 FAILED at t={time.time()-t0:.3f}: {e}")

for r in results:
    print(r, flush=True)
c.close()
srv.close()
