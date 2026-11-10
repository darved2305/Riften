import hashlib
import http.client
import ipaddress
import io
import re
import socket
import ssl
import os
from urllib.parse import urlsplit
from bs4 import BeautifulSoup
from docx import Document as Docx
from pypdf import PdfReader

LIMIT = (4 if os.getenv('VERCEL') else 15) * 1024 * 1024
TRUSTED = {'rbi.org.in', 'www.rbi.org.in', 'rbidocs.rbi.org.in', 'sebi.gov.in', 'www.sebi.gov.in'}

def digest(data: bytes): return hashlib.sha256(data).hexdigest()
def normalize(text: str): return re.sub(r'\s+', ' ', text).strip()

def safe_fetch(url: str) -> tuple[bytes, str]:
    u = urlsplit(url)
    if u.scheme != 'https' or u.hostname not in TRUSTED or u.port not in (None, 443) or u.username or u.password or u.fragment:
        raise ValueError('Use an HTTPS URL on an approved RBI or SEBI domain, without credentials, fragments, or custom ports.')
    addresses = socket.getaddrinfo(u.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Source resolved to a non-public address.')
    # Pin validated DNS result while retaining TLS hostname verification and SNI.
    ip = addresses[0][4][0]
    class PinnedHTTPS(http.client.HTTPSConnection):
        def connect(self):
            self.sock = ssl.create_default_context().wrap_socket(socket.create_connection((ip, 443), timeout=20), server_hostname=u.hostname)
    conn = PinnedHTTPS(u.hostname, timeout=20)
    try:
        conn.request('GET', (u.path or '/') + ('?' + u.query if u.query else ''), headers={'User-Agent': 'Riften/0.1 official-source-review', 'Accept-Encoding': 'identity'})
        r = conn.getresponse()
        if r.status != 200:
            raise ValueError(f'Source returned HTTP {r.status}. Redirects and access restrictions are not bypassed.')
        if int(r.getheader('Content-Length') or 0) > LIMIT: raise ValueError(f'Source exceeds {LIMIT//(1024*1024)} MB limit.')
        data = r.read(LIMIT + 1)
        if len(data) > LIMIT: raise ValueError(f'Source exceeds {LIMIT//(1024*1024)} MB limit.')
        return data, r.getheader('Content-Type') or ''
    finally:
        conn.close()

def extract(data: bytes, filename: str, content_type=''):
    if len(data) > LIMIT: raise ValueError(f'Maximum upload size is {LIMIT//(1024*1024)} MB.')
    name = filename.lower()
    sections, warnings = [], []
    if name.endswith('.pdf') or 'application/pdf' in content_type:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted: raise ValueError('Encrypted PDF. Upload an unlocked document.')
        if len(reader.pages) > 300: raise ValueError('Maximum 300 pages per import.')
        for n, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ''
            if len(re.findall(r'\w+', text)) < 15:
                warnings.append(f'Page {n}: insufficient extractable text. Scanned or unreadable; manual review required. OCR is unavailable.')
            for ref, paragraph in split_text(text): sections.append((ref, paragraph, n))
    elif name.endswith('.docx'):
        import zipfile
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if sum(x.file_size for x in z.infolist()) > 80 * 1024 * 1024: raise ValueError('DOCX expands beyond safe processing limit.')
        doc = Docx(io.BytesIO(data))
        text = '\n\n'.join([p.text for p in doc.paragraphs] + [' | '.join(c.text for c in row.cells) for t in doc.tables for row in t.rows])
        sections = [(ref, text, None) for ref, text in split_text(text)]
    elif name.endswith('.txt'):
        try: text = data.decode('utf-8-sig')
        except UnicodeError: raise ValueError('TXT must use UTF-8 encoding.')
        sections = [(ref, text, None) for ref, text in split_text(text)]
    elif 'text/html' in content_type or name.endswith('.html'):
        soup = BeautifulSoup(data, 'html.parser')
        for tag in soup(['script', 'style', 'nav', 'header', 'footer']): tag.decompose()
        candidate = soup.select_one('main') or soup.select_one('article') or soup.body or soup
        tables = [t for t in candidate.find_all('table') if 'Existing Provisions' in t.get_text()]
        text = min([t.get_text('\n', strip=True) for t in tables if len(t.get_text()) > 4500], key=len) if tables else candidate.get_text('\n', strip=True)
        if any(x in text.lower() for x in ['access denied', 'verify you are human', 'captcha']): raise ValueError('Source access restriction detected. Import a manually downloaded official file.')
        sections = [(ref, text, None) for ref, text in split_text(text)]
    else: raise ValueError('Supported files: PDF, DOCX, UTF-8 TXT. Official URL imports also accept HTML.')
    if not sections: raise ValueError('No readable text extracted. Manual review required; no text has been invented.')
    return sections, warnings

def split_text(text):
    paragraphs = [normalize(p) for p in re.split(r'\n\s*\n|\n(?=\d+[.\)])', text) if normalize(p)]
    result = []
    for paragraph in paragraphs:
        # Bound retrieval and alignment passages while retaining full stored text.
        pieces = [paragraph[i:i+2200] for i in range(0, len(paragraph), 2200)]
        for piece in pieces:
            m = re.match(r'^(?:Section\s+|Clause\s+)?(\d+(?:\.\d+)*(?:\s*\([a-z0-9]+\))*)[.\s:)]', piece, re.I)
            result.append((m.group(1).strip() if m else f'Passage {len(result)+1}', piece))
    return result

def annex_snapshots(data):
    soup = BeautifulSoup(data, 'html.parser')
    pairs = []
    for table in soup.find_all('table'):
        table_text=table.get_text(' ',strip=True)
        category='Commercial banks' if re.search(r'15\s*\(\s*c\s*\)',table_text) else 'Co-operative banks' if re.search(r'14\s*\(\s*c\s*\)',table_text) else None
        rows = table.find_all('tr', recursive=False)
        if not rows:
            body = table.find('tbody', recursive=False)
            rows = body.find_all('tr', recursive=False) if body else []
        for row in rows:
            cells = row.find_all(['td', 'th'], recursive=False)
            if len(cells) == 3 and not any(c.find('table') for c in cells):
                ref, old, new = [normalize(c.get_text(' ', strip=True)) for c in cells]
                if old and new and 'Existing Provisions' not in old and re.match(r'^\d', ref): pairs.append(((category+' / ' if category else '')+ref, old, new))
    if not pairs: raise ValueError('Official existing/amended provision columns could not be located.')
    return pairs
