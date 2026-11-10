import json
import io
import pytest
from pypdf import PdfWriter
from pydantic import ValidationError
from backend.intelligence import Rule,evaluate,parse_analysis,semantic_issues
from backend.intelligence import verify_source_rule
from backend.ingestion import extract,safe_fetch
from backend.nugen import NugenError,nugen
from backend.db import Session
from backend.models import Entity,Node,Inference,Assessment,Change,Deployment,ModelJob
from sqlalchemy import select

RULE={'field':'amount_inr','operator':'lte','old_value':1500000,'new_value':10000000,'scope':[{'field':'holder_type','op':'eq','value':'individual'}],'expect':{'field':'premature_withdrawal','value':True},'note':'Isolated threshold test, not legal advice.'}

@pytest.mark.parametrize('amount,expected',[(1499999,'review'),(1500000,'review'),(1500001,'review'),(10000000,'review'),(10000001,'not_triggered')])
def test_inclusive_boundary(amount,expected):
    assert evaluate({'amount_inr':amount,'holder_type':'individual','premature_withdrawal':False},Rule(**RULE),10000000)[0]==expected

@pytest.mark.parametrize('record,expected',[({},'unknown'),({'holder_type':'company'},'out_of_scope'),({'holder_type':'individual','amount_inr':5000000},'unknown'),({'holder_type':'individual','amount_inr':True},'unknown'),({'holder_type':'individual','amount_inr':float('inf')},'unknown'),({'holder_type':'individual','amount_inr':5000000,'premature_withdrawal':True},'satisfied')])
def test_missing_evidence_is_never_pass(record,expected):assert evaluate(record,Rule(**RULE),10000000)[0]==expected

@pytest.mark.parametrize('url',['http://rbi.org.in/','https://127.0.0.1/','https://rbi.org.in.evil.example/','https://rbi.org.in:8000/','https://user:pass@rbi.org.in/','https://169.254.169.254/metadata','file:///etc/passwd','https://localhost/'])
def test_ssrf(url):
    with pytest.raises(ValueError):safe_fetch(url)

def test_missing_source_and_unchanged(client,workspace):
    assert client.get('/api/versions/missing').status_code==404
    v=[]
    for _ in range(2):
        r=client.post('/api/sources/upload',data={'workspace_id':workspace,'title':'Unchanged fixture'},files={'file':('policy.txt',b'1. This requirement remains unchanged.')});v.append(r.json()['id'])
    r=client.post('/api/assessments',json={'workspace_id':workspace,'old_version_id':v[0],'new_version_id':v[1]})
    assert r.json()['status']=='unchanged' and r.json()['changes']==[]
    assert r.json()['new_version']['effective_date'] is None

def test_duplicate_version(client,workspace):
    payload={'workspace_id':workspace,'title':'Duplicate fixture'}
    r=client.post('/api/sources/upload',data=payload,files={'file':('p.txt',b'1. Same text')});v=r.json()
    r=client.post('/api/sources/upload',data={**payload,'document_id':v['document_id']},files={'file':('p.txt',b'1. Same text')})
    assert r.json()['duplicate'] and r.json()['id']==v['id']

def test_invalid_import_is_atomic(client,workspace):
    data=b'external_id,name,amount_inr\nA,Good,1000\nB,Bad,-1\n'
    r=client.post('/api/entities/import',data={'workspace_id':workspace},files={'file':('records.csv',data)})
    assert r.status_code==422 and r.json()['detail']['errors'][0]['row']==2
    assert client.get('/api/entities',params={'workspace_id':workspace}).json()==[]

def test_duplicate_import(client,workspace):
    data=b'external_id,name\nA,One\nA,Two\n'
    r=client.post('/api/entities/import',data={'workspace_id':workspace},files={'file':('r.csv',data)})
    assert r.status_code==422

def test_scanned_pdf_and_invalid_formats(client,workspace):
    writer=PdfWriter();writer.add_blank_page(width=612,height=792);buf=io.BytesIO();writer.write(buf)
    r=client.post('/api/sources/upload',data={'workspace_id':workspace,'title':'Scanned fixture'},files={'file':('scan.pdf',buf.getvalue())})
    assert r.status_code==200 and r.json()['status']=='failed' and 'No readable text' in r.json()['error']
    assert client.post('/api/sources/upload',data={'workspace_id':workspace,'title':'Invalid'},files={'file':('binary.exe',b'x')}).status_code==422

def test_replay_requires_verification(client,comparison):
    c=comparison['changes'][0]
    assert client.post('/api/changes/'+c['id']+'/replay').status_code==422

def test_verified_replay_snapshots_and_unconnected(client,workspace,comparison):
    c=comparison['changes'][0];cid=c['id']
    r=client.put('/api/changes/'+cid+'/rule',json={'rule':RULE,'verification_note':'Isolated test rule checked against test fixture scope and numeric boundaries.'})
    assert r.status_code==200
    record=client.post('/api/entities',json={'workspace_id':workspace,'kind':'record','name':'Test record','attributes':{'amount_inr':5000000,'holder_type':'individual','premature_withdrawal':False},'synthetic':True}).json()
    r=client.post('/api/changes/'+cid+'/replay');assert r.json()['results'][0]['outcome']=='unconnected'
    graph=client.get('/api/graph',params={'workspace_id':workspace}).json();a=next(n for n in graph['nodes'] if n['change_id']==cid);b=next(n for n in graph['nodes'] if n['entity_id']==record['id'])
    assert client.post('/api/graph/edges',json={'source_id':a['id'],'target_id':b['id'],'rationale':'Verified isolated test relationship','verified':True}).status_code==200
    r=client.post('/api/changes/'+cid+'/replay').json();result=r['results'][0]
    assert result['outcome']=='requires_review' and result['old_result']=='not_triggered'
    assert result['record_snapshot']['amount_inr']==5000000 and r['rule_snapshot']==RULE

def test_cross_workspace_and_cycle_rejection(client,workspace,comparison):
    other=client.post('/api/workspaces',json={'name':'Other'}).json()['id']
    e=client.post('/api/entities',json={'workspace_id':other,'kind':'control','name':'Other control'}).json()
    g=client.get('/api/graph',params={'workspace_id':workspace}).json();g2=client.get('/api/graph',params={'workspace_id':other}).json()
    assert client.post('/api/graph/edges',json={'source_id':g['nodes'][0]['id'],'target_id':g2['nodes'][0]['id'],'rationale':'Invalid cross workspace link'}).status_code==422
    edge=g['edges'][0]
    assert client.post('/api/graph/edges',json={'source_id':edge['target_id'],'target_id':edge['source_id'],'rationale':'Cycle must be rejected'}).status_code==422

def test_task_update_is_audited(client,workspace,comparison):
    t=client.post('/api/tasks',json={'workspace_id':workspace,'title':'Isolated fixture review','change_id':comparison['changes'][0]['id']}).json()
    assert client.patch('/api/tasks/'+t['id'],json={'status':'done','comment':'Isolated test completion evidence.'}).status_code==200
    tasks=client.get('/api/tasks',params={'workspace_id':workspace}).json();assert tasks[0]['status']=='done' and len(tasks[0]['history'])==2 and tasks[0]['comments'][0]['author']=='Local reviewer'

def test_model_schema_and_source_verification():
    payload={'classification':'threshold','explanation':'The threshold was increased.','business_area':'Test','old_quote':'Original test clause','new_quote':'Updated test clause','unresolved':[]}
    assert parse_analysis(json.dumps(payload),'Original test clause','Updated test clause').classification=='threshold'
    with pytest.raises(ValueError):parse_analysis(json.dumps({**payload,'new_quote':'Invented source'}),'Original test clause','Updated test clause')
    with pytest.raises(ValidationError):parse_analysis(json.dumps({**payload,'fake_citation':'x'}),'Original test clause','Updated test clause')
    assert semantic_issues('The new rule lowers the limit.','fifteen lakh','one crore shall have premature-withdrawal-facility')

def test_nugen_failure_is_preserved(client,workspace,monkeypatch):
    def fail(*args,**kwargs):raise NugenError('Isolated simulated API 503')
    monkeypatch.setattr(nugen,'request',fail)
    with Session() as db:
        j=ModelJob(workspace_id=workspace,kind='alignment',status='READY',model_id='isolated-test-model');db.add(j);db.flush();db.add(Deployment(job_id=j.id,model_id=j.model_id,status='DEPLOYED'));db.commit()
    r=client.post('/api/model-lab/inference',json={'workspace_id':workspace,'prompt':'Isolated test question'})
    assert r.status_code==502
    with Session() as db:
        run=db.scalar(select(Inference));assert run.status=='failed' and run.response is None and '503' in run.error

def test_short_alignment_document_and_no_model(client,workspace):
    v=client.post('/api/sources/upload',data={'workspace_id':workspace,'title':'Short fixture'},files={'file':('p.txt',b'One short policy.')}).json()
    assert client.post('/api/model-lab/documents',json={'workspace_id':workspace,'version_id':v['id']}).status_code==422
    assert client.post('/api/model-lab/inference',json={'workspace_id':workspace,'prompt':'Test question'}).status_code==502

def test_unsupported_executable_rule_is_rejected():
    with pytest.raises(ValidationError):Rule(**{**RULE,'operator':'eval'})
    with pytest.raises(ValidationError):Rule(**{**RULE,'new_value':float('nan')})
    with pytest.raises(ValidationError):Rule(**{**RULE,'python':'import os'})

def test_model_rule_contradiction_cannot_be_approved(client,workspace):
    versions=[]
    for text in ['1. Rupees fifteen lakh and below shall have premature-withdrawal-facility.','1. Rupees one crore and below shall have premature-withdrawal-facility.']:
        r=client.post('/api/sources/upload',data={'workspace_id':workspace,'title':'RBI wording guard fixture'},files={'file':('test.txt',text.encode())});versions.append(r.json()['id'])
    a=client.post('/api/assessments',json={'workspace_id':workspace,'old_version_id':versions[0],'new_version_id':versions[1]}).json();cid=a['changes'][0]['id']
    r=client.put('/api/changes/'+cid+'/rule',json={'rule':{**RULE,'operator':'gte'},'verification_note':'Attempt to approve an invalid source contradiction should be blocked.'})
    assert r.status_code==422 and 'contradicts' in r.json()['detail']

def test_conflicting_section_labels_require_review(client,workspace):
    versions=[]
    for text in ['1. The fixture threshold is 10.','1. The fixture threshold is 20.\n\n1. The fixture threshold is 30.']:
        r=client.post('/api/sources/upload',data={'workspace_id':workspace,'title':'Conflicting fixture'},files={'file':('test.txt',text.encode())});versions.append(r.json()['id'])
    a=client.post('/api/assessments',json={'workspace_id':workspace,'old_version_id':versions[0],'new_version_id':versions[1]}).json()
    assert a['changes'][0]['classification']=='ambiguous' and a['changes'][0]['unresolved']

def test_boolean_is_not_numeric_rule_value():
    with pytest.raises(ValidationError):Rule(**{**RULE,'old_value':True})
    with pytest.raises(ValidationError):Rule(**{**RULE,'scope':[{'field':'holder_type','op':'in','value':'individual'}]})

def test_source_rule_verification_never_approves():
    rule=Rule(**RULE)
    assert verify_source_rule(rule,'Rupees fifteen lakh and below','Rupees one crore and below') is rule
    assert 'verified' not in rule.model_dump()

def test_monitor_ignores_html_chrome_changes(client,workspace,monkeypatch):
    from backend import main
    body=b'<html><body><article>1. This fixture obligation is unchanged.</article><script>var transient=1</script></body></html>'
    monkeypatch.setattr(main,'safe_fetch',lambda _: (body,'text/html'))
    r=client.post('/api/sources/url',json={'workspace_id':workspace,'url':'https://rbi.org.in/fixture','title':'Isolated monitoring fixture'})
    did=r.json()['document_id']
    changed=body.replace(b'transient=1',b'transient=2')
    monkeypatch.setattr(main,'safe_fetch',lambda _: (changed,'text/html'))
    r=client.post('/api/sources/'+did+'/check')
    assert r.status_code==200 and r.json()['status']=='unchanged'
    assert len(client.get('/api/sources',params={'workspace_id':workspace}).json()[0]['versions'])==1

def test_archived_workspaces_do_not_capture_workspace_picker(client,workspace):
    other=client.post('/api/workspaces',json={'name':'Disposable browser QA'}).json()['id']
    assert client.patch('/api/workspaces/'+other,json={'archived':True}).status_code==200
    assert [w['id'] for w in client.get('/api/workspaces').json()]==[workspace]
    assert other in [w['id'] for w in client.get('/api/workspaces?include_archived=true').json()]
    assert client.patch('/api/workspaces/'+other,json={'archived':False}).status_code==200
    assert len(client.get('/api/workspaces').json())==2

def test_hosted_original_bytes_survive_without_local_files(client,workspace,monkeypatch):
    monkeypatch.setenv('RIFTEN_ORIGINAL_STORAGE','database')
    content=b'1. This is a durable original source fixture, saved separately from extracted text.'
    r=client.post('/api/sources/upload',data={'workspace_id':workspace,'title':'Persistent original fixture'},files={'file':('original.txt',content,'text/plain')})
    assert r.status_code==200 and r.json()['original_path'].startswith('database:')
    original=client.get('/api/versions/'+r.json()['id']+'/original')
    assert original.status_code==200 and original.content==content
