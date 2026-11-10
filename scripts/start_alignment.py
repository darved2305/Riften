"""One-shot live alignment, explicit invocation only. Never auto retries creation."""
import json
import pathlib
import requests
from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'nugen'
OUT.mkdir(parents=True, exist_ok=True)
key = dict(x.split('=', 1) for x in (ROOT / '.env').read_text().splitlines() if '=' in x)['NUGEN_API_KEY']
session = requests.Session()
session.headers['Authorization'] = 'Bearer ' + key

def call(method, path, **kw):
    r = session.request(method, 'https://api.nugen.in/api/v3/' + path, timeout=90, **kw)
    body = r.json()
    (OUT / (path.replace('/', '_') + '.json')).write_text(json.dumps({'http_status': r.status_code, 'body': body}, indent=2), encoding='utf8')
    r.raise_for_status()
    return body

if (OUT / 'alignment-projects_create.json').exists():
    raise SystemExit('A creation response already exists. Inspect it before any new alignment.')
soup = BeautifulSoup((ROOT / 'research/rbi-original.html').read_bytes(), 'html.parser')
tables = [t for t in soup.find_all('table') if 'Existing Provisions' in t.get_text()]
text = min((t.get_text('\n', strip=True) for t in tables if len(t.get_text()) > 4500), key=len)
(OUT / 'rbi-circular.txt').write_text(text, encoding='utf8')
print('Official corpus word count:', len(text.split()), flush=True)
if len(text.split()) < 500:
    raise SystemExit('Corpus does not meet Nugen minimum; no padding is permitted.')
upload_path = OUT / 'documents_create.json'
if upload_path.exists():
    upload = json.loads(upload_path.read_text())['body']
else:
    upload = call('POST', 'documents/create', files={'files': ('rbi-circular.txt', text.encode(), 'text/plain')}, data={'names': 'RBI non-callable deposits official circular and annex'})
print('Upload:', upload, flush=True)
ids = upload['document_ids']
statuses = [call('GET', f'documents/{i}/status') for i in ids]
print('Processing:', statuses, flush=True)
if not all(x.get('status') == 'READY' for x in statuses):
    raise SystemExit('Documents still processing. Re-run after READY; upload will be reused.')
result = call('POST', 'alignment-projects/create', json={'alignment_name': 'Riften RBI deposit obligations', 'base_model_id': 'Qwen/Qwen2.5-1.5B-Instruct', 'document_ids': ids, 'description': 'One bounded demonstration alignment. Interpret historical RBI clause changes with evidence and abstention.'})
print('Alignment:', result, flush=True)
