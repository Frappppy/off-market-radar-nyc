"""Raw client WITH Windows keepalive (SIO_KEEPALIVE_VALS, 1s idle) to raw server, idle 3s."""
import socket
import struct
import threading
import time

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", 55497))
srv.listen(1)
server_got = []


def server():
    c, _ = srv.accept()
    c.settimeout(15)
    try:
        while True:
            d = c.recv(1024)
            if not d:
                server_got.append("EOF")
                break
            server_got.append(f"got {d!r} at {time.time()-t0:.3f}")
            c.sendall(b"pong")
    except Exception as e:
        server_got.append(f"err {e}")


t0 = time.time()
threading.Thread(target=server, daemon=True).start()

c = socket.create_connection(("127.0.0.1", 55497), timeout=10)
# enable keepalive with 1s idle / 1s interval (like libpq keepalives)
c.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
try:
    # struct tcp_keepalive { u_long onoff, keepalivetime, keepaliveinterval }
    aiob = struct.pack("III", 1, 1000, 1000)
    c.ioctl(socket.SIO_KEEPALIVE_VALS, aiob)
    print("SIO_KEEPALIVE_VALS set (idle=1s, interval=1s)", flush=True)
except Exception as e:
    print(f"SIO_KEEPALIVE_VALS failed: {e}", flush=True)

c.sendall(b"ping")
time.sleep(0.2)
try:
    print(f"recv: {c.recv(1024)!r}", flush=True)
except Exception as e:
    print(f"recv failed: {e}", flush=True)
print("idling 3s ...", flush=True)
time.sleep(3)
try:
    c.sendall(b"after-idle")
    print("after-idle send OK", flush=True)
    print(f"recv: {c.recv(1024)!r}", flush=True)
except Exception as e:
    print(f"after-idle FAILED: {e}", flush=True)
time.sleep(0.3)
print("server side:", server_got, flush=True)
c.close()
srv.close()
