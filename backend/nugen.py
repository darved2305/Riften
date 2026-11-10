import os
import time
import httpx
from .models import Inference

BASE = 'https://api.nugen.in/api/v3'
class NugenError(Exception): pass

class Nugen:
    def request(self, method, path, **kw):
        key = os.getenv('NUGEN_API_KEY')
        if not key: raise NugenError('Nugen is not connected. Set NUGEN_API_KEY on the backend.')
        attempts = 3 if method == 'GET' else 1
        for attempt in range(attempts):
            try:
                with httpx.Client(timeout=httpx.Timeout(90, connect=15)) as client:
                    r = client.request(method, BASE + path, headers={'Authorization': 'Bearer ' + key}, **kw)
                if r.status_code in (429, 502, 503, 504) and attempt < attempts-1:
                    time.sleep(min(float(r.headers.get('retry-after', 2)), 5)); continue
                if r.is_error:
                    raise NugenError(f'Nugen HTTP {r.status_code}: {r.text[:800]}')
                return r.json()
            except httpx.HTTPError as e:
                if attempt < attempts-1: time.sleep(1); continue
                raise NugenError(f'Nugen request failed ({type(e).__name__}). Inspect remote state before retrying a creation request.') from e

    def chat(self, db, workspace_id, model_id, messages, purpose='assistant', max_tokens=450):
        payload = {'model': model_id, 'messages': messages, 'stream': False, 'temperature': 0, 'max_tokens': max_tokens, 'prompt_truncate_len': 12000}
        run = Inference(workspace_id=workspace_id, model_id=model_id, purpose=purpose, status='running', request=payload)
        db.add(run); db.commit()
        try:
            response = self.request('POST', '/inference/chat/completions', json=payload)
            if not response.get('choices') or not response['choices'][0].get('message', {}).get('content'):
                raise NugenError('Nugen returned no message content.')
            run.response, run.status = response, 'succeeded'; db.commit()
            return response['choices'][0]['message']['content'], run
        except Exception as e:
            run.status, run.error = 'failed', str(e); db.commit(); raise

nugen = Nugen()
