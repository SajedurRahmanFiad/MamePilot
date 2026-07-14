import sqlite3
import json
import os

DB_PATH = r"C:\Users\Sajedur Rahman Fiad\.local\share\mimocode\mimocode.db"
WORKSPACE = "G:\\Projects\\React\\MamePilot"

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Get project ID
cur.execute("SELECT id FROM project WHERE root LIKE ?", (f"%{WORKSPACE}%",))
projects = [r[0] for r in cur.fetchall()]
print("=== PROJECT IDs ===")
print(projects)

# Get project directory
cur.execute("SELECT * FROM project WHERE root LIKE ?", (f"%{WORKSPACE}%",))
for r in cur.fetchall():
    print(f"  Project: {dict(r)}")

# Check session for this project
if projects:
    for pid in projects:
        cur.execute("SELECT id, title, time_created FROM session WHERE project_id = ? ORDER BY time_created DESC LIMIT 10", (pid,))
        print(f"\n=== Sessions for project {pid} ===")
        for r in cur.fetchall():
            print(f"  {r['id']} | {r['title']} | {r['time_created']}")

# Check memory_fts
print("\n=== Memory FTS entries ===")
cur.execute("SELECT * FROM memory_fts LIMIT 10")
for r in cur.fetchall():
    print(f"  {dict(r)}")

# Check memory tool in parts (recent)
print("\n=== Recent memory tool calls ===")
cur.execute("""
    SELECT p.data
    FROM part p
    WHERE json_extract(p.data, '$.tool') = 'memory'
    ORDER BY p.time_created DESC
    LIMIT 5
""")
for r in cur.fetchall():
    d = json.loads(r['data'])
    inp = d.get('state', {}).get('input', {})
    print(f"  Query: {inp.get('query', 'N/A')} | Scope: {inp.get('scope', 'N/A')}")

conn.close()
