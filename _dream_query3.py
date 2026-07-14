import sqlite3
import json

DB_PATH = r"C:\Users\Sajedur Rahman Fiad\.local\share\mimocode\mimocode.db"

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Project schema
cur.execute("PRAGMA table_info(project)")
print("=== PROJECT SCHEMA ===")
print([(r['name'], r['type']) for r in cur.fetchall()])

# All projects
cur.execute("SELECT * FROM project LIMIT 5")
print("\n=== PROJECTS ===")
for r in cur.fetchall():
    print(f"  {dict(r)}")

# Session schema has project_id, workspace_id, directory
# Find sessions for this workspace
cur.execute("SELECT id, project_id, workspace_id, directory, title, time_created FROM session WHERE directory LIKE '%MamePilot%' ORDER BY time_created DESC LIMIT 25")
print("\n=== ALL MAMEPILOT SESSIONS ===")
for r in cur.fetchall():
    print(f"  {r['id']} | proj={r['project_id']} | ws={r['workspace_id']} | {r['title'][:80]} | {r['time_created']}")

# Check workspace table
cur.execute("PRAGMA table_info(workspace)")
print("\n=== WORKSPACE SCHEMA ===")
print([(r['name'], r['type']) for r in cur.fetchall()])

cur.execute("SELECT * FROM workspace LIMIT 5")
print("\n=== WORKSPACES ===")
for r in cur.fetchall():
    print(f"  {dict(r)}")

# Check memory table
if 'memory_fts' in [t[1] for t in cur.execute("SELECT * FROM sqlite_master WHERE type='table'").fetchall()]:
    pass

# Check memory in the data dir
print("\n=== Checking memory data storage ===")
# Memory might be stored differently - let's check the snapshot dir
import os
snap = r"C:\Users\Sajedur Rahman Fiad\.local\share\mimocode\snapshot"
if os.path.isdir(snap):
    for item in os.listdir(snap):
        p = os.path.join(snap, item)
        if os.path.isdir(p):
            print(f"  dir: {item}/")
            for sub in os.listdir(p)[:5]:
                print(f"    {sub}")
        else:
            print(f"  file: {item} ({os.path.getsize(p)} bytes)")

conn.close()
