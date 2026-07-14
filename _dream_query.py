import sqlite3
import json
import os

DB_PATH = r"C:\Users\Sajedur Rahman Fiad\.local\share\mimocode\mimocode.db"
WORKSPACE = "G:\\Projects\\React\\MamePilot"

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# 1. List tables
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in cur.fetchall()]
print("=== TABLES ===")
print(tables)

# 2. Schema for key tables
for t in ['session', 'message', 'part', 'task', 'task_event', 'actor_registry']:
    if t in tables:
        cur.execute(f"PRAGMA table_info({t})")
        cols = [(r['name'], r['type']) for r in cur.fetchall()]
        print(f"\n=== SCHEMA: {t} ===")
        print(cols)

# 3. List recent sessions (last 7 days)
print("\n=== RECENT SESSIONS ===")
cur.execute("""
    SELECT id, directory, title, time_created
    FROM session
    WHERE directory LIKE ?
    ORDER BY time_created DESC
    LIMIT 20
""", (f"%{WORKSPACE}%",))
for r in cur.fetchall():
    print(f"  {r['id']} | {r['title']} | {r['directory']} | {r['time_created']}")

# 4. If no workspace sessions, list all
cur.execute("SELECT COUNT(*) FROM session WHERE directory LIKE ?", (f"%{WORKSPACE}%",))
if cur.fetchone()[0] == 0:
    print("\n=== ALL SESSIONS (no workspace match) ===")
    cur.execute("SELECT id, directory, title, time_created FROM session ORDER BY time_created DESC LIMIT 20")
    for r in cur.fetchall():
        print(f"  {r['id']} | {r['title']} | {r['directory']} | {r['time_created']}")

conn.close()
