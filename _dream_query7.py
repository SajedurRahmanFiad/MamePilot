import sqlite3
import json

DB_PATH = r"C:\Users\Sajedur Rahman Fiad\.local\share\mimocode\mimocode.db"
PROJECT_ID = "143fe4f6-d8bf-4733-8262-8f1be987a756"

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# 1. Architecture decisions from session ses_09feedb3affeue64tP86EPMIBk (migration fix)
print("=" * 70)
print("SESSION: Migration fix - detailed assistant analysis")
print("=" * 70)
cur.execute("""
    SELECT m.id, p.data
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE m.session_id = 'ses_09feedb3affeue64tP86EPMIBk'
    AND json_extract(m.data, '$.role') = 'assistant'
    AND json_extract(p.data, '$.type') = 'text'
    ORDER BY m.time_created
""")
for r in cur.fetchall():
    d = json.loads(r['data'])
    text = d.get('text', '')
    if len(text) > 100:
        print(f"\n--- Assistant msg {r['id'][:20]} ---")
        print(text[:2000])

# 2. Key decisions from ses_09feed4aaffef9u7cTDyUuugmF (exchange flow)
print("\n" + "=" * 70)
print("SESSION: Exchange flow design decisions")
print("=" * 70)
cur.execute("""
    SELECT m.id, p.data
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE m.session_id = 'ses_09feed4aaffef9u7cTDyUuugmF'
    AND json_extract(m.data, '$.role') = 'assistant'
    AND json_extract(p.data, '$.type') = 'text'
    ORDER BY m.time_created
""")
for r in cur.fetchall():
    d = json.loads(r['data'])
    text = d.get('text', '')
    if len(text) > 200:
        print(f"\n--- Assistant msg {r['id'][:20]} ---")
        print(text[:1500])

# 3. Image handling from ses_09feed66fffe1ZUm4ym3x7n6rK
print("\n" + "=" * 70)
print("SESSION: Image handling fix")
print("=" * 70)
cur.execute("""
    SELECT m.id, p.data
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE m.session_id = 'ses_09feed66fffe1ZUm4ym3x7n6rK'
    AND json_extract(m.data, '$.role') = 'assistant'
    AND json_extract(p.data, '$.type') = 'text'
    ORDER BY m.time_created
""")
for r in cur.fetchall():
    d = json.loads(r['data'])
    text = d.get('text', '')
    if len(text) > 200:
        print(f"\n--- Assistant msg {r['id'][:20]} ---")
        print(text[:1500])

# 4. Meta ads dashboard decisions
print("\n" + "=" * 70)
print("SESSION: Meta ads dashboard restructuring")
print("=" * 70)
cur.execute("""
    SELECT m.id, p.data
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE m.session_id = 'ses_09feed409ffeeiJxc72rPyU2BV'
    AND json_extract(m.data, '$.role') = 'assistant'
    AND json_extract(p.data, '$.type') = 'text'
    ORDER BY m.time_created
""")
for r in cur.fetchall():
    d = json.loads(r['data'])
    text = d.get('text', '')
    if len(text) > 300:
        print(f"\n--- Assistant msg {r['id'][:20]} ---")
        print(text[:2000])

conn.close()
