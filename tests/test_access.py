import hashlib
import hmac
import time
import pytest
from backend.access import COOKIE

@pytest.fixture
def public_demo(monkeypatch):
    monkeypatch.setenv('RIFTEN_PUBLIC_DEMO', '1')
    monkeypatch.setenv('RIFTEN_OWNER_TOKEN', 'isolated-owner-test-key')
    monkeypatch.delenv('VERCEL', raising=False)

@pytest.mark.parametrize('method,path', [
    ('post','/api/workspaces'), ('post','/api/assistant'),
    ('post','/api/model-lab/align'), ('post','/api/model-lab/inference'),
    ('post','/api/model-lab/evaluations'), ('post','/api/entities/import'),
    ('put','/api/changes/anything/rule'), ('patch','/api/tasks/anything'),
    ('delete','/api/graph/edges/anything'),
])
def test_public_mutations_blocked_before_processing(client, public_demo, method, path):
    assert getattr(client, method)(path).status_code == 403
    assert client.get('/api/workspaces').json() == []

def test_owner_session_login_logout(client, public_demo):
    assert client.get('/api/access').json() == {'public_demo':True,'editing_allowed':False}
    assert client.post('/api/access/login',json={'token':'wrong'}).status_code == 401
    r=client.post('/api/access/login',json={'token':'isolated-owner-test-key'})
    assert r.status_code == 200
    assert 'httponly' in r.headers['set-cookie'].lower()
    assert 'samesite=strict' in r.headers['set-cookie'].lower()
    assert client.get('/api/access').json()['editing_allowed']
    assert client.post('/api/workspaces',json={'name':'Owner test workspace'}).status_code == 200
    client.post('/api/access/logout')
    assert not client.get('/api/access').json()['editing_allowed']
    assert client.post('/api/workspaces',json={'name':'Blocked'}).status_code == 403

@pytest.mark.parametrize('offset,valid_signature', [(-1,True),(60,False),(20000,True)])
def test_expired_forged_and_unbounded_sessions_denied(client, public_demo, offset, valid_signature):
    expires=str(int(time.time())+offset)
    signature=hmac.new(b'isolated-owner-test-key',expires.encode(),hashlib.sha256).hexdigest() if valid_signature else 'forged'
    client.cookies.set(COOKIE,expires+'.'+signature)
    assert client.post('/api/workspaces').status_code == 403

def test_missing_key_fails_closed(client, public_demo, monkeypatch):
    monkeypatch.delenv('RIFTEN_OWNER_TOKEN')
    assert client.post('/api/access/login',json={'token':'anything'}).status_code == 401
    assert client.post('/api/assistant').status_code == 403

def test_hosted_cookie_is_secure(client, public_demo, monkeypatch):
    monkeypatch.setenv('VERCEL','1')
    response=client.post('/api/access/login',json={'token':'isolated-owner-test-key'})
    assert 'secure' in response.headers['set-cookie'].lower()
