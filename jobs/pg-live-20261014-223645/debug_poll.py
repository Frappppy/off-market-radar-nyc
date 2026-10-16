"""Compare yesterday's surviving poll pattern vs today's instant death + dump suspicious GUCs."""
import time

import psycopg

DSN = "postgresql://postgres@localhost:127.0.0.1:55432/postgres".replace("127.0.0.1:", "")


def show_gucs():
    conn = psycopg.connect(DSN, connect_timeout=10)
    with conn, conn.cursor() as cur:
        cur.execute(
            "SELECT name, setting, unit, source FROM pg_settings "
            "WHERE name IN ('tcp_keepalives_idle','tcp_keepalives_interval','tcp_keepalives_count',"
            "'client_connection_check_interval','idle_session_timeout','session_timeout',"
            "'statement_timeout','lock_timeout','idle_in_transaction_session_timeout',"
            "'timezone_abbreviations','log_timezone','restart_after_crash') "
            "ORDER BY name"
        )
        for row in cur.fetchall():
            print(f"  {row[0]:42s} = {row[1]!r:12s} unit={row[2]} src={row[3]}", flush=True)
    conn.close()


print("=== GUCs ===", flush=True)
show_gucs()

print("=== poll pattern (0.5s gaps, 12s) ===", flush=True)
t0 = time.time()
conn = psycopg.connect(DSN, connect_timeout=10)
with conn:
    with conn.cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
print(f"{time.time()-t0:5.2f}s connected+txn1 committed", flush=True)
dead = False
for i in range(24):
    time.sleep(0.5)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception as e:
        print(f"{time.time()-t0:5.2f}s DEAD: {e}", flush=True)
        dead = True
        break
if not dead:
    print(f"{time.time()-t0:5.2f}s SURVIVED all polls", flush=True)
try:
    conn.close()
except Exception:
    pass
