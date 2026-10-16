"""Drive psql.exe as a subprocess: one session, 3s full idle between statements."""
import subprocess
import time

pgbin = r"C:\Users\omisg\AppData\Local\Temp\opencode\pglive\Library\bin"
psql = pgbin + r"\psql.exe"

t0 = time.time()
p = subprocess.Popen(
    [psql, "-h", "127.0.0.1", "-p", "55432", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)
p.stdin.write("SELECT 1 AS step1;\n")
p.stdin.flush()
print(f"{time.time()-t0:.2f}s sent step1", flush=True)
time.sleep(3)
print(f"{time.time()-t0:.2f}s sending step2 after 3s idle ...", flush=True)
try:
    p.stdin.write("SELECT 2 AS step2;\n")
    p.stdin.close()
except Exception as e:
    print(f"write failed: {e}", flush=True)
out = p.stdout.read()
rc = p.wait(timeout=10)
print(f"{time.time()-t0:.2f}s psql rc={rc}", flush=True)
print("output:", out, flush=True)
if "step2" in out and rc == 0:
    print("RESULT: psql session SURVIVED 3s idle", flush=True)
else:
    print("RESULT: psql session FAILED after idle", flush=True)
