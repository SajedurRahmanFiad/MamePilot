import re, json, urllib.request, urllib.error

key = ''
with open('.env', 'r', encoding='utf-8') as f:
    for line in f:
        m = re.match(r'GEMINI_API_KEY=(.*)', line)
        if m:
            key = m.group(1).strip()
            break

print('KEY_PRESENT', bool(key))
endpoints = [
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5:generateContent',
    'https://generativelanguage.googleapis.com/v1beta2/models/gemini-1.5:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta2/models/gemini-3.5-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.0:generateContent',
    'https://generativelanguage.googleapis.com/v1beta2/models/gemini-1.0:generateContent',
    'https://generativelanguage.googleapis.com/v1beta2/models/gemini-1.5:generateMessage',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5:generateMessage',
]
for endpoint in endpoints:
    data = json.dumps({'contents': [{'parts': [{'text': 'Hello'}]}]}).encode('utf-8')
    req = urllib.request.Request(endpoint, data=data, headers={'x-goog-api-key': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode('utf-8', errors='replace')
            print('OK', endpoint, r.status, body[:200])
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print('ERR', endpoint, e.code, body[:200])
    except Exception as e:
        print('FAIL', endpoint, str(e))
