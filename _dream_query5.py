import sqlite3
import json
import os

DB_PATH = r"C:\Users\Sajedur Rahman Fiad\.local\share\mimocode\mimocode.db"
WORKSPACE = "G:\\Projects\\React\\MamePilot"
PROJECT_ID = "143fe4f6-d8bf-4733-8262-8f1be987a756"

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Get assistant messages with key patterns (errors, decisions, architecture)
print("=== Assistant messages with architecture/errors/decisions ===")
cur.execute("""
    SELECT s.title, s.id as session_id, m.id as msg_id, p.data
    FROM message m
    JOIN part p ON p.message_id = m.id
    JOIN session s ON s.id = m.session_id
    WHERE m.session_id IN (
        SELECT id FROM session WHERE project_id = ? ORDER BY time_created DESC LIMIT 20
    )
    AND json_extract(m.data, '$.role') = 'assistant'
    AND json_extract(p.data, '$.type') = 'text'
    AND (
        json_extract(p.data, '$.text') LIKE '%architecture%'
        OR json_extract(p.data, '$.text') LIKE '%error%'
        OR json_extract(p.data, '$.text') LIKE '%fixed%'
        OR json_extract(p.data, '$.text') LIKE '%solution%'
        OR json_extract(p.data, '$.text') LIKE '%migration%'
        OR json_extract(p.data, '$.text') LIKE '%database%'
        OR json_extract(p.data, '$.text') LIKE '%supabase%'
    )
    ORDER BY m.time_created DESC
    LIMIT 30
""", (PROJECT_ID,))

seen = set()
for r in cur.fetchall():
    d = json.loads(r['data'])
    text = d.get('text', '')[:300]
    key = (r['session_id'], text[:100])
    if key not in seen:
        seen.add(key)
        print(f"\n  [{r['title'][:50]}] {text}")

# Get task events for completed tasks
print("\n\n=== Task events (completed tasks) ===")
cur.execute("""
    SELECT t.id, t.session_id, t.summary, t.status, t.created_at, t.ended_at,
           e.kind, e.summary as event_summary
    FROM task t
    JOIN task_event e ON e.task_id = t.id
    WHERE t.session_id IN (
        SELECT id FROM session WHERE project_id = ? ORDER BY time_created DESC LIMIT 20
    )
    AND t.status = 'completed'
    ORDER BY t.ended_at DESC
    LIMIT 20
""", (PROJECT_ID,))
for r in cur.fetchall():
    print(f"  Task {r['id'][:20]} | {r['summary'][:80]} | {r['event_summary'][:80]}")

# Check CLAUDE.md for rules
print("\n\n=== CLAUDE.md rules ===")
claude_path = os.path.join(WORKSPACE, "CLAUDE.md")
if os.path.isfile(claude_path):
    with open(claude_path, 'r', encoding='utf-8') as f:
        content = f.read()
        print(content)

# Check existing memory directory
print("\n\n=== Check memory directory under .mimocode ===")
mimocode_dir = os.path.join(WORKSPACE, ".mimocode")
if os.path.isdir(mimocode_dir):
    for item in os.listdir(mimocode_dir):
        p = os.path.join(mimocode_dir, item)
        if os.path.isdir(p):
            print(f"  dir: {item}/")
            for sub in os.listdir(p)[:5]:
                sp = os.path.join(p, sub)
                if os.path.isfile(sp):
                    print(f"    {sub} ({os.path.getsize(sp)} bytes)")
                else:
                    print(f"    {sub}/")
        else:
            print(f"  file: {item} ({os.path.getsize(p)} bytes)")

conn.close()
