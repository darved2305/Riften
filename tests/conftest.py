import os
import tempfile
from pathlib import Path

# Isolated, disposable DB and corpus directory. Tests never touch live workspace data.
TEST_ROOT=Path(tempfile.mkdtemp(prefix='riften-tests-'))
os.environ['DATABASE_URL']='sqlite:///'+str(TEST_ROOT/'test.db').replace('\\','/')

import pytest
from fastapi.testclient import TestClient
from backend.db import Base,engine,Session
from backend.main import app
from backend import main

@pytest.fixture(autouse=True)
def isolated_db(monkeypatch):
    Base.metadata.create_all(engine)
    (TEST_ROOT/'data'/'originals').mkdir(parents=True,exist_ok=True)
    monkeypatch.setattr(main,'ROOT',TEST_ROOT)
    monkeypatch.setattr(main,'DATA_ROOT',TEST_ROOT/'data')
    yield
    Base.metadata.drop_all(engine)

@pytest.fixture
def client():
    with TestClient(app) as c:yield c

@pytest.fixture
def workspace(client):return client.post('/api/workspaces',json={'name':'Isolated QA'}).json()['id']

@pytest.fixture
def comparison(client,workspace):
    versions=[]
    for name,text in [('old','1. Individuals with amount up to 15 shall supply evidence.'),('new','1. Individuals with amount up to 100 shall supply evidence.')]:
        r=client.post('/api/sources/upload',data={'workspace_id':workspace,'title':'Isolated fixture policy','label':name},files={'file':(name+'.txt',text.encode(),'text/plain')})
        assert r.status_code==200
        versions.append(r.json()['id'])
    r=client.post('/api/assessments',json={'workspace_id':workspace,'old_version_id':versions[0],'new_version_id':versions[1]})
    assert r.status_code==200
    return r.json()
