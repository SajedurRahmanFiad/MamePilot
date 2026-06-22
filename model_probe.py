import re, json, urllib.request, urllib.error

with open('.env', 'r', encoding='utf-8') as f:
    env = {m[1]: m[2] for line in f if (m := re.match(r'([^=]+)=(.*)', line))}

gemini_key = env.get('GEMINI_API_KEY', '').strip()
openrouter_key = env.get('OPENROUTER_API_KEY', '').strip()

print('GEMINI_KEY_PRESENT', bool(gemini_key))
print('OPENROUTER_KEY_PRESENT', bool(openrouter_key))

if gemini_key:
    print('\n=== Gemini v1beta models/gemini-3.5-flash:generateContent ===')
    body = {'contents': [{'role': 'system', 'parts': [{'text': 'Say hi.'}]}, {'role': 'user', 'parts': [{'text': 'Hello?'}]}]}
    for extra in [None, {'temperature': 0.3}, {'temperature':0.3, 'top_p':0.95, 'candidate_count':1}, {'temperature': 0.3, 'topP':0.95, 'candidateCount':1}]:
        req_body = body.copy()
        if extra:
            req_body.update(extra)
        data = json.dumps(req_body).encode('utf-8')
        endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent'
        req = urllib.request.Request(endpoint, data=data, headers={'x-goog-api-key': gemini_key, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                out = r.read().decode('utf-8', errors='replace')
                print('OK', extra, r.status, out[:500])
        except urllib.error.HTTPError as e:
            out = e.read().decode('utf-8', errors='replace')
            print('ERR', extra, e.code, out[:500])
        except Exception as e:
            print('FAIL', extra, str(e))

if openrouter_key:
    print('\n=== OpenRouter Chat Completions ===')
    payload = {
        'model': 'nex-agi/nex-n2-pro:free',
        'messages': [
            {'role': 'system', 'content': 'You are a helpful assistant.'},
            {'role': 'user', 'content': 'Hello from test.'}
        ],
        'max_tokens': 32,
    }
    data = json.dumps(payload).encode('utf-8')
    endpoint = 'https://openrouter.ai/v1/chat/completions'
    req = urllib.request.Request(endpoint, data=data, headers={'Authorization': f'Bearer {openrouter_key}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            out = r.read().decode('utf-8', errors='replace')
            print('OK', r.status, out[:1500])
    except urllib.error.HTTPError as e:
        out = e.read().decode('utf-8', errors='replace')
        print('ERR', e.code, out[:1500])
    except Exception as e:
        print('FAIL', str(e))
