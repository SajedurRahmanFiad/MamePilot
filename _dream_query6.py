import sqlite3
import json
import os

DB_PATH = r"C:\Users\Sajedur Rahman Fiad\.local\share\mimocode\mimocode.db"
PROJECT_ID = "143fe4f6-d8bf-4733-8262-8f1be987a756"

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Get all user messages from recent sessions - full text for rule extraction
# Focus on sessions with "always", "never", "make sure", "should", "please"
session_ids = [
    "ses_09feed7e6ffew69YlLwb07D5Xi",  # manual courier text field
    "ses_09feed7c9ffeBH9Lb9sFGzUFvI",  # complete order modal tabbed
    "ses_09feed66fffe1ZUm4ym3x7n6rK",  # broken images/attachments
    "ses_09feed4e4ffeC3jG6M2Nr5U1Y7",  # images uploaded but broken display
    "ses_09feed409ffeeiJxc72rPyU2BV",  # restructure meta ads dashboard
    "ses_09feedf38ffeNo0cxdH1NZbkB9",  # meta ads different data
    "ses_09feeddeeffeNHthdvcPv4arXi",  # filtering today wrong
    "ses_09feedaa7ffePRqzlatRXumxKU",  # audit dynamic filterbar
    "ses_09feed900ffeJO3UCj70KbUZVE",  # order badge showing wrong
    "ses_09feedfdeffen7hDGOedi74iZu",  # exchange courier button
    "ses_09feee180ffea9Pjg2abfz5AB8",  # ship exchange rename
    "ses_09feed4aaffef9u7cTDyUuugmF",  # difference deliver exchange
    "ses_09feee19fffepiict5ihcO9UHb",  # Inter font
    "ses_09feedb3affeue64tP86EPMIBk",  # live server SQL error
    "ses_09feed640ffehvRrmdHk2YKXJr",  # exchange delivered filter
    "ses_09feedf00ffe55OlWC45rTglzu",  # Co-Pilot plan capabilities
    "ses_09feed531ffe9BryxZ9zKcj732",  # notifications not reaching users
    "ses_09feee3afffe1VFf1jpiorvcYL",  # audit orders bills mechanism
    "ses_09feee267ffe3m6iHC7WtePlf7",  # Grow your business page
    "ses_09feee056ffeEW66hhFtZm8JpQ",  # categoryForm error
    "ses_09feed383ffeFkb6TEaVe3UH1L",  # Hi
    "ses_09feee1a5ffeScVomuEapZROLq",  # Claude Code session
    "ses_09feed7ddffeN0tZFbnt2crx97",  # cash flow widget
    "ses_09feed640ffehvRrmdHk2YKXJr",  # exchange delivered filter
]

for sid in session_ids:
    cur.execute("""
        SELECT p.data
        FROM message m
        JOIN part p ON p.message_id = m.id
        WHERE m.session_id = ?
        AND json_extract(m.data, '$.role') = 'user'
        AND json_extract(p.data, '$.type') = 'text'
        ORDER BY m.time_created
    """, (sid,))
    
    parts = []
    for r in cur.fetchall():
        d = json.loads(r['data'])
        text = d.get('text', '')
        # Skip system reminders and task notifications
        if text.startswith('<system-reminder>') or text.startswith('<task-notification>'):
            # Extract the user text after system stuff
            if '</system-reminder>' in text:
                text = text.split('</system-reminder>')[-1].strip()
            elif '<task-notification>' in text:
                continue
            else:
                continue
        if text.strip():
            parts.append(text.strip())
    
    if parts:
        # Get session title
        cur.execute("SELECT title FROM session WHERE id = ?", (sid,))
        row = cur.fetchone()
        title = row[0] if row else "Unknown"
        print(f"\n{'='*60}")
        print(f"SESSION: {title}")
        print(f"ID: {sid}")
        for i, p in enumerate(parts):
            print(f"  User msg {i+1}: {p[:500]}")
            if len(p) > 500:
                print(f"  ... (truncated)")

conn.close()
