import sqlite3
import json
import os

DB_PATH = r"C:\Users\Sajedur Rahman Fiad\.local\share\mimocode\mimocode.db"
WORKSPACE = "G:\\Projects\\React\\MamePilot"
PROJECT_ID = "143fe4f6-d8bf-4733-8262-8f1be987a756"

# Check snapshot directory for this project
snap_base = r"C:\Users\Sajedur Rahman Fiad\.local\share\mimocode\snapshot"
proj_snap = os.path.join(snap_base, PROJECT_ID)
print(f"=== Snapshot directory: {proj_snap} ===")
if os.path.isdir(proj_snap):
    for root, dirs, files in os.walk(proj_snap):
        level = root.replace(proj_snap, '').count(os.sep)
        indent = ' ' * 2 * level
        print(f'{indent}{os.path.basename(root)}/')
        subindent = ' ' * 2 * (level + 1)
        for file in files[:10]:
            fp = os.path.join(root, file)
            print(f'{subindent}{file} ({os.path.getsize(fp)} bytes)')
else:
    print("  No snapshot directory found")

# Check CLAUDE.md for existing project memory
print("\n=== CLAUDE.md ===")
claude_path = os.path.join(WORKSPACE, "CLAUDE.md")
if os.path.isfile(claude_path):
    with open(claude_path, 'r', encoding='utf-8') as f:
        print(f.read()[:2000])

# Query user messages from recent sessions for durable facts
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Get user messages from recent sessions with key patterns
print("\n=== User messages with rules/decisions ===")
cur.execute("""
    SELECT s.title, m.id, p.data
    FROM message m
    JOIN part p ON p.message_id = m.id
    JOIN session s ON s.id = m.session_id
    WHERE m.session_id IN (
        SELECT id FROM session WHERE project_id = ? ORDER BY time_created DESC LIMIT 20
    )
    AND json_extract(m.data, '$.role') = 'user'
    AND json_extract(p.data, '$.type') = 'text'
    AND (
        json_extract(p.data, '$.text') LIKE '%always%'
        OR json_extract(p.data, '$.text') LIKE '%never%'
        OR json_extract(p.data, '$.text') LIKE '%remember%'
        OR json_extract(p.data, '$.text') LIKE '%rule%'
        OR json_extract(p.data, '$.text') LIKE '%decision%'
        OR json_extract(p.data, '$.text') LIKE '%decided%'
        OR json_extract(p.data, '$.text') LIKE '%please%'
        OR json_extract(p.data, '$.text') LIKE '%should%'
        OR json_extract(p.data, '$.text') LIKE '%make sure%'
    )
    ORDER BY m.time_created DESC
    LIMIT 30
""", (PROJECT_ID,))
for r in cur.fetchall():
    d = json.loads(r['data'])
    text = d.get('text', '')[:200]
    print(f"\n  [{r['title'][:50]}] {text}")

conn.close()
