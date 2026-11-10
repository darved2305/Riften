import csv
import io
import json
import logging
import os
import re
import math
import mimetypes
from urllib.parse import quote
from datetime import date
from pathlib import Path
from typing import Literal
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select, func
from sqlalchemy.orm import Session as DB
from sqlalchemy.exc import IntegrityError
from .db import Session, ROOT, DATA_ROOT, session
from .models import *
from .ingestion import extract, safe_fetch, digest, annex_snapshots, normalize, LIMIT
from .intelligence import compare, interpret, Rule, evaluate, model_id, textual_finding, verify_source_rule
from .nugen import nugen, NugenError

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
log = logging.getLogger('riften')
app = FastAPI(title='Riften', version='0.1.0')
app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:5173','http://localhost:5173'], allow_methods=['*'], allow_headers=['*'])

@app.exception_handler(NugenError)
async def nugen_error(_, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=502, content={'detail':str(exc)})

@app.exception_handler(ValueError)
async def value_error(_, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=422, content={'detail':str(exc)})

@app.exception_handler(IntegrityError)
async def constraint_error(_, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=409, content={'detail':'A duplicate or conflicting operation was blocked by the database. Refresh the workspace before retrying.'})

def row(obj):
    return {c.name:getattr(obj,c.name) for c in obj.__table__.columns}
def rows(db, query): return [row(x) for x in db.scalars(query)]
def need(db, cls, id):
    obj = db.get(cls,id)
    if not obj: raise HTTPException(404,f'{cls.__name__} not found')
    return obj
def activity(db, wid, text, obj=None, detail=None):
    db.add(Activity(workspace_id=wid,action=text,object_id=obj,detail=detail or {}))
def workspace(db,wid): return need(db,Workspace,wid)
def wid_for_change(db,cid): return need(db,Assessment,need(db,Change,cid).assessment_id).workspace_id

@app.get('/api/health')
def health(db:DB=Depends(session)):
    db.execute(select(1)); return {'status':'ok','product':'Riften','mode':'hosted single operator' if os.getenv('VERCEL') else 'local single operator','nugen_configured':bool(os.getenv('NUGEN_API_KEY')),'max_upload_bytes':LIMIT}

class WorkspaceIn(BaseModel): name:str=Field(min_length=1,max_length=160)
@app.get('/api/workspaces')
def workspaces(include_archived:bool=False,db:DB=Depends(session)):
    query=select(Workspace).order_by(Workspace.created_at)
    if not include_archived:query=query.where(Workspace.archived==False)
    return rows(db,query)

class WorkspaceArchiveIn(BaseModel):archived:bool
@app.patch('/api/workspaces/{id}')
def archive_workspace(id:str,body:WorkspaceArchiveIn,db:DB=Depends(session)):
    w=need(db,Workspace,id);w.archived=body.archived
    activity(db,w.id,'Archived workspace' if body.archived else 'Restored workspace',w.id)
    db.commit();return row(w)
@app.post('/api/workspaces')
def create_workspace(body:WorkspaceIn,db:DB=Depends(session)):
    w=Workspace(name=body.name.strip()); db.add(w); db.flush(); activity(db,w.id,'Created workspace',w.id); db.commit(); return row(w)

@app.get('/api/overview')
def overview(workspace_id:str,db:DB=Depends(session)):
    workspace(db,workspace_id)
    docs=list(db.scalars(select(Document).where(Document.workspace_id==workspace_id)))
    assessments=list(db.scalars(select(Assessment).where(Assessment.workspace_id==workspace_id)))
    changes=list(db.scalars(select(Change).join(Assessment).where(Assessment.workspace_id==workspace_id)))
    tasks=list(db.scalars(select(Task).where(Task.workspace_id==workspace_id)))
    results=list(db.scalars(select(ReplayResult).join(Replay).join(Assessment).where(Assessment.workspace_id==workspace_id)))
    return {'metrics':{'sources':len(docs),'changes_analyzed':sum(c.analysis_status=='complete' for c in changes),'awaiting_review':sum(a.status in ('needs_review','analysis_failed','compared') for a in assessments),'affected_records':len({x.entity_id for x in results if x.outcome=='requires_review'}),'open_tasks':sum(t.status!='done' for t in tasks),'records':db.scalar(select(func.count()).select_from(Entity).where(Entity.workspace_id==workspace_id,Entity.kind=='record'))},'deadlines':[row(t) for t in tasks if t.due_date and t.status!='done'],'assessments':[row(a) for a in assessments[::-1]],'activity':rows(db,select(Activity).where(Activity.workspace_id==workspace_id).order_by(Activity.created_at.desc()).limit(30)),'change_types':[{ 'name':k,'count':sum(c.classification==k for c in changes)} for k in sorted({c.classification for c in changes})]}

def add_version(db,doc,data,filename,label,content_type='',provenance=None,custom_sections=None,legal_status='unverified',effective=None):
    hashed=digest(data)
    existing=db.scalar(select(Version).where(Version.document_id==doc.id,Version.content_hash==hashed))
    if existing: return existing,True
    hosted=os.getenv('VERCEL') or os.getenv('RIFTEN_ORIGINAL_STORAGE')=='database'
    path=DATA_ROOT/'originals'/(uid()+Path(filename).suffix.lower())
    if not hosted:path.write_bytes(data)
    v=Version(document_id=doc.id,label=label,content_hash=hashed,original_path='database' if hosted else str(path),provenance=provenance or 'User upload. Legal status and effective date unverified.',legal_status=legal_status,effective_date=effective)
    db.add(v); db.flush()
    if hosted:
        v.original_path='database:'+v.id
        db.add(SourceOriginal(version_id=v.id,filename=Path(filename).name[:300],data=data,media_type=mimetypes.guess_type(filename)[0] or 'application/octet-stream',content_hash=hashed))
    try:
        sections,warnings=(custom_sections,[]) if custom_sections else extract(data,filename,content_type)
        v.text='\n\n'.join(s[1] for s in sections)
        v.status='manual_review' if warnings else 'ready'; v.error='\n'.join(warnings) or None
        for i,(ref,text,page) in enumerate(sections):db.add(Section(version_id=v.id,reference=ref,ordinal=i,text=text,page=page))
    except Exception as e:
        v.status,v.error='failed',str(e)
    activity(db,doc.workspace_id,f'Imported {label}: {v.status}',v.id)
    db.flush(); return v,False

def source_node(db,doc):
    n=db.scalar(select(Node).where(Node.document_id==doc.id))
    if not n: n=Node(workspace_id=doc.workspace_id,kind='regulation',label=doc.title,document_id=doc.id);db.add(n);db.flush()
    return n

@app.get('/api/sources')
def sources(workspace_id:str,db:DB=Depends(session)):
    return [{**row(d),'authority':db.get(Authority,d.authority_id).name if d.authority_id else 'Unverified authority','versions':rows(db,select(Version).where(Version.document_id==d.id).order_by(Version.created_at))} for d in db.scalars(select(Document).where(Document.workspace_id==workspace_id).order_by(Document.created_at.desc()))]

@app.post('/api/sources/upload')
async def upload(workspace_id:str=Form(...),title:str=Form(...),label:str=Form('Uploaded version'),document_id:str|None=Form(None),file:UploadFile=File(...),db:DB=Depends(session)):
    workspace(db,workspace_id)
    if not file.filename or not file.filename.lower().endswith(('.txt','.pdf','.docx')):raise HTTPException(422,'Upload PDF, DOCX, or UTF-8 TXT.')
    data=await file.read(LIMIT+1)
    if len(data)>LIMIT:raise HTTPException(413,f'Maximum upload size is {LIMIT//(1024*1024)} MB.')
    if document_id:
        doc=need(db,Document,document_id)
        if doc.workspace_id!=workspace_id:raise HTTPException(404,'Document not in selected workspace')
    else:
        doc=Document(workspace_id=workspace_id,title=title[:300]);db.add(doc);db.flush();source_node(db,doc)
    v,duplicate=add_version(db,doc,data,file.filename,label[:160]);db.commit();return {**row(v),'duplicate':duplicate}

class URLIn(BaseModel):
    workspace_id:str
    url:str=Field(max_length=2000)
    title:str=Field(min_length=1,max_length=300)
    label:str='Official URL import'
@app.post('/api/sources/url')
def import_url(body:URLIn,db:DB=Depends(session)):
    workspace(db,body.workspace_id); data,ctype=safe_fetch(body.url)
    doc=db.scalar(select(Document).where(Document.workspace_id==body.workspace_id,Document.url==body.url))
    if not doc:doc=Document(workspace_id=body.workspace_id,title=body.title,url=body.url);db.add(doc);db.flush();source_node(db,doc)
    filename=url_filename(body.url,ctype)
    v,duplicate=add_version(db,doc,data,filename,body.label,ctype,provenance=f'Fetched from {body.url}. Verify legal status and effective date.')
    db.add(Fetch(document_id=doc.id,status=v.status,content_hash=digest(data),error=v.error));db.commit();return {**row(v),'duplicate':duplicate}

def url_filename(url,ctype): return 'source.pdf' if 'pdf' in ctype else 'source.docx' if 'wordprocessingml' in ctype else 'source.txt' if 'text/plain' in ctype else 'source.html'

@app.post('/api/sources/{document_id}/check')
def check_source(document_id:str,db:DB=Depends(session)):
    doc=need(db,Document,document_id)
    if not doc.url:raise HTTPException(422,'This source has no trusted URL to check.')
    try:
        data,ctype=safe_fetch(doc.url); hashed=digest(data)
        known=db.scalar(select(Version).where(Version.document_id==doc.id,Version.content_hash==hashed))
        if not known:
            extracted,warnings=extract(data,url_filename(doc.url,ctype),ctype)
            if not warnings:
                canonical=normalize('\n\n'.join(s[1] for s in extracted))
                known=next((v for v in db.scalars(select(Version).where(Version.document_id==doc.id)) if normalize(v.text)==canonical),None)
        status='unchanged' if known else 'changed'
        if not known:add_version(db,doc,data,url_filename(doc.url,ctype),'Checked '+date.today().isoformat(),ctype)
        f=Fetch(document_id=doc.id,status=status,content_hash=hashed);db.add(f);activity(db,doc.workspace_id,'Checked official source: '+status,doc.id);db.commit();return row(f)
    except Exception as e:
        f=Fetch(document_id=doc.id,status='failed',error=str(e));db.add(f);db.commit();raise HTTPException(422,str(e))

@app.get('/api/sources/{document_id}/history')
def fetch_history(document_id:str,db:DB=Depends(session)):return rows(db,select(Fetch).where(Fetch.document_id==document_id).order_by(Fetch.created_at.desc()))

@app.get('/api/versions/{id}')
def version(id:str,db:DB=Depends(session)):
    v=need(db,Version,id);return {**row(v),'sections':rows(db,select(Section).where(Section.version_id==id).order_by(Section.ordinal)),'document':row(need(db,Document,v.document_id))}
@app.get('/api/versions/{id}/original')
def original(id:str,db:DB=Depends(session)):
    v=need(db,Version,id)
    blob=db.get(SourceOriginal,id)
    if blob:return Response(blob.data,media_type=blob.media_type,headers={'Content-Disposition':"attachment; filename*=UTF-8''"+quote(blob.filename)})
    p=Path(v.original_path)
    if not p.is_file():raise HTTPException(404,'Original file missing')
    return FileResponse(p,filename='riften-source'+p.suffix)

class CompareIn(BaseModel): workspace_id:str;old_version_id:str;new_version_id:str
@app.post('/api/assessments')
def create_assessment(body:CompareIn,db:DB=Depends(session)):
    workspace(db,body.workspace_id)
    a,b=need(db,Version,body.old_version_id),need(db,Version,body.new_version_id)
    for v in (a,b):
        if need(db,Document,v.document_id).workspace_id!=body.workspace_id:raise HTTPException(404,'Version outside workspace')
        if v.status!='ready':raise HTTPException(422,'Resolve parsing or scanned-page review before comparing this version.')
    if a.id==b.id:raise HTTPException(422,'Select two different versions.')
    assessment=Assessment(workspace_id=body.workspace_id,old_version_id=a.id,new_version_id=b.id,title=need(db,Document,b.document_id).title)
    db.add(assessment);db.flush();compare(db,assessment)
    sn=source_node(db,need(db,Document,b.document_id))
    for c in db.scalars(select(Change).where(Change.assessment_id==assessment.id)):
        n=db.scalar(select(Node).where(Node.change_id==c.id));db.add(Dependency(source_id=sn.id,target_id=n.id,rationale='Change extracted from this source version comparison.',verified=True))
    activity(db,body.workspace_id,'Created clause comparison',assessment.id);db.commit();return assessment_detail(db,assessment)

@app.get('/api/assessments')
def assessments(workspace_id:str,db:DB=Depends(session)):return rows(db,select(Assessment).where(Assessment.workspace_id==workspace_id).order_by(Assessment.created_at.desc()))
def assessment_detail(db,a):
    cs=[]
    for c in db.scalars(select(Change).where(Change.assessment_id==a.id).order_by(Change.created_at)):
        req=db.scalar(select(Requirement).where(Requirement.change_id==c.id))
        old_s,new_s=(db.get(Section,c.old_section_id) if c.old_section_id else None),(db.get(Section,c.new_section_id) if c.new_section_id else None)
        cs.append({**row(c),'textual_finding':textual_finding(old_s.text if old_s else '',new_s.text if new_s else ''),'old_section':row(old_s) if old_s else None,'new_section':row(new_s) if new_s else None,'evidence':[{**row(e),'version_id':need(db,Section,e.section_id).version_id} for e in db.scalars(select(Evidence).where(Evidence.change_id==c.id))],'requirement':row(req) if req else None})
    return {**row(a),'changes':cs,'old_version':row(need(db,Version,a.old_version_id)),'new_version':row(need(db,Version,a.new_version_id))}
@app.get('/api/assessments/{id}')
def assessment(id:str,db:DB=Depends(session)):return assessment_detail(db,need(db,Assessment,id))

def analysis_job(id):
    with Session() as db:
        a=need(db,Assessment,id)
        try:interpret(db,a);activity(db,a.workspace_id,'Nugen analysis '+a.status,a.id);db.commit()
        except Exception as e:
            log.exception('Assessment analysis failed %s',id);a.status,a.error='analysis_failed',str(e);db.commit()
@app.post('/api/assessments/{id}/analyze')
def analyze(id:str,bg:BackgroundTasks,db:DB=Depends(session)):
    a=need(db,Assessment,id);model_id(db,a.workspace_id)
    if a.status=='analyzing':raise HTTPException(409,'Analysis is already running.')
    a.status='analyzing';db.commit();bg.add_task(analysis_job,id);return row(a)

class ReviewIn(BaseModel): status:Literal['accepted','needs_review','rejected'];note:str=Field(min_length=5,max_length=3000)
@app.patch('/api/changes/{id}/review')
def review_change(id:str,body:ReviewIn,db:DB=Depends(session)):
    c=need(db,Change,id);c.status=body.status
    a=need(db,Assessment,c.assessment_id);db.flush()
    states=list(db.scalars(select(Change.status).where(Change.assessment_id==a.id)))
    if states and all(s in ('accepted','rejected') for s in states):a.status='reviewed'
    activity(db,a.workspace_id,'Reviewed change: '+body.status,id,{'note':body.note});db.commit();return row(c)

class RuleIn(BaseModel): rule:Rule;verification_note:str=Field(min_length=20,max_length=3000)
@app.put('/api/changes/{id}/rule')
def verify_rule(id:str,body:RuleIn,db:DB=Depends(session)):
    c=need(db,Change,id);req=db.scalar(select(Requirement).where(Requirement.change_id==id))
    old_s,new_s=(db.get(Section,c.old_section_id) if c.old_section_id else None),(db.get(Section,c.new_section_id) if c.new_section_id else None)
    verify_source_rule(body.rule,old_s.text if old_s else '',new_s.text if new_s else '')
    if not req:req=Requirement(change_id=id,text=c.explanation or 'Reviewer formalized condition');db.add(req)
    req.rule=body.rule.model_dump();req.verified=True;req.verification_note=body.verification_note
    activity(db,wid_for_change(db,id),'Verified executable replay rule',id,{'note':body.verification_note,'rule':body.rule.model_dump()});db.commit();return row(req)

@app.post('/api/changes/{id}/propose-rule')
def propose_rule(id:str,db:DB=Depends(session)):
    c=need(db,Change,id);wid=wid_for_change(db,id);mid=model_id(db,wid)
    old,new=(db.get(Section,c.old_section_id) if c.old_section_id else None),(db.get(Section,c.new_section_id) if c.new_section_id else None)
    attrs=list(db.scalars(select(Entity.attributes).where(Entity.workspace_id==wid,Entity.kind=='record').limit(50)))
    fields=sorted({key for record in attrs for key in record})
    if not fields:raise HTTPException(422,'Import record attributes before proposing a condition.')
    example={'field':'amount_inr','operator':'lte','old_value':0,'new_value':0,'scope':[{'field':'holder_type','op':'eq','value':'individual'}],'expect':{'field':'premature_withdrawal','value':True},'note':'Draft condition. Applicability must be independently verified.'}
    prompt='Propose one bounded numeric assessment rule from the two source clauses. Only use supplied record field names. Return ONLY a JSON object with this schema, using correct source-supported values: '+json.dumps(example)+'. Operator is lte, lt, gte or gt. Monetary values are rupees. Do not invent source facts. Include unresolved applicability in note. Never return executable code. This is an unverified proposal, not law. If no numeric rule is supportable, return {}.'
    text,run=nugen.chat(db,wid,mid,[{'role':'system','content':prompt},{'role':'user','content':json.dumps({'old':old.text if old else None,'new':new.text if new else None,'record_fields':fields})}],'rule_proposal',490)
    try:
        cleaned=re.sub(r'^```(?:json)?\s*|\s*```$','',text.strip());rule=Rule.model_validate_json(cleaned)
        referenced={rule.field,rule.expect.field}|{s.field for s in rule.scope}
        if not referenced.issubset(set(fields)):raise ValueError('Model proposed attributes absent from imported records.')
        verify_source_rule(rule,old.text if old else '',new.text if new else '')
    except Exception as e:
        run.status='invalid_output';run.error=str(e);db.commit();raise HTTPException(422,'Nugen proposal rejected: '+str(e)+'. Raw output was preserved. No executable rule was saved.')
    return {'rule':rule.model_dump(),'verified':False,'inference_id':run.id,'warning':'Schema validation does not prove correct interpretation. Review every value and applicability condition before approval.'}

@app.post('/api/versions/{id}/embeddings')
def index_version(id:str,db:DB=Depends(session)):
    v=need(db,Version,id);wid=need(db,Document,v.document_id).workspace_id;mid=model_id(db,wid)
    sections=list(db.scalars(select(Section).where(Section.version_id==id).order_by(Section.ordinal)))
    if not sections or len(sections)>50:raise HTTPException(422,'Indexing supports 1 to 50 passages per version in this demo.')
    if all(s.embedding for s in sections):raise HTTPException(409,'This version already has persisted embeddings.')
    payload={'model':mid,'input':[s.text for s in sections]}
    run=Inference(workspace_id=wid,model_id=mid,purpose='section_embeddings',status='running',request=payload);db.add(run);db.commit()
    try:
        result=nugen.request('POST','/inference/embeddings',json=payload);run.response=result
        vectors=sorted(result.get('data',[]),key=lambda x:x['index'])
        if len(vectors)!=len(sections):raise ValueError('Embedding count does not match source passage count.')
        dimensions=None
        for i,item in enumerate(vectors):
            vec=item.get('embedding')
            if item['index']!=i or not isinstance(vec,list) or not vec or not all(isinstance(x,(int,float)) and math.isfinite(x) for x in vec):raise ValueError('Invalid embedding vector or source index.')
            if dimensions is not None and len(vec)!=dimensions:raise ValueError('Embedding dimensions differ within the response.')
            dimensions=len(vec)
        for s,item in zip(sections,vectors):s.embedding=item['embedding']
        run.status='succeeded';activity(db,wid,'Indexed source passages with Nugen embeddings',v.id);db.commit()
    except Exception as e:run.status='failed';run.error=str(e);db.commit();raise HTTPException(502,str(e))
    return {'indexed':len(sections),'dimensions':dimensions,'inference_id':run.id}

@app.get('/api/assessments/{id}/export')
def export_assessment(id:str,db:DB=Depends(session)):
    a=need(db,Assessment,id);output=assessment_detail(db,a)
    output['replays']=[replay_detail(db,r) for r in db.scalars(select(Replay).where(Replay.assessment_id==id))]
    output['tasks']=rows(db,select(Task).where(Task.change_id.in_([c['id'] for c in output['changes']])))
    return Response(json.dumps(output,indent=2),media_type='application/json',headers={'Content-Disposition':'attachment; filename="riften-assessment.json"'})

class EntityIn(BaseModel):
    workspace_id:str
    kind:Literal['policy','process','control','record']
    name:str=Field(min_length=1,max_length=300)
    description:str=Field(default='',max_length=5000)
    attributes:dict=Field(default_factory=dict)
    synthetic:bool=False
@app.get('/api/entities')
def entities(workspace_id:str,db:DB=Depends(session)):return rows(db,select(Entity).where(Entity.workspace_id==workspace_id).order_by(Entity.created_at))
@app.post('/api/entities')
def create_entity(body:EntityIn,db:DB=Depends(session)):
    workspace(db,body.workspace_id);e=Entity(**body.model_dump());db.add(e);db.flush();db.add(Node(workspace_id=e.workspace_id,kind=e.kind,label=e.name,entity_id=e.id));activity(db,e.workspace_id,'Created '+e.kind,e.id);db.commit();return row(e)

@app.post('/api/entities/import')
async def import_entities(workspace_id:str=Form(...),synthetic:bool=Form(False),mapping:str=Form('{}'),file:UploadFile=File(...),db:DB=Depends(session)):
    workspace(db,workspace_id);import_limit=min(5*1024*1024,LIMIT)
    data=await file.read(import_limit+1)
    if len(data)>import_limit:raise HTTPException(413,f'Import maximum is {import_limit//(1024*1024)} MB.')
    try:
        text=data.decode('utf-8-sig'); items=json.loads(text) if file.filename.lower().endswith('.json') else list(csv.DictReader(io.StringIO(text)))
        mapping_obj=json.loads(mapping)
    except Exception as e:raise HTTPException(422,'Invalid UTF-8 CSV, JSON array, or field mapping.') from e
    if not isinstance(items,list) or len(items)>5000:raise HTTPException(422,'Import an array with at most 5000 rows.')
    errors,validated=[],[]
    seen=set()
    for i,item in enumerate(items,1):
        try:
            if not isinstance(item,dict):raise ValueError('Row must be an object')
            record={mapping_obj.get(k,k):v for k,v in item.items()}
            external=str(record.get('external_id','')).strip();name=str(record.get('name',external)).strip()
            if not external or not name:raise ValueError('external_id and name are required')
            if external in seen or db.scalar(select(Entity.id).where(Entity.workspace_id==workspace_id,Entity.kind=='record',Entity.external_id==external)):raise ValueError('Duplicate external_id')
            seen.add(external)
            attrs={k:v for k,v in record.items() if k not in ('external_id','name')}
            for k,v in list(attrs.items()):
                if isinstance(v,str):
                    if v.lower() in ('true','false'):attrs[k]=v.lower()=='true'
                    elif v.strip()=='':attrs[k]=None
                    elif re.fullmatch(r'-?\d+(\.\d+)?',v):attrs[k]=float(v) if '.' in v else int(v)
            if attrs.get('amount_inr') is not None and (isinstance(attrs['amount_inr'],bool) or not isinstance(attrs['amount_inr'],(float,int)) or attrs['amount_inr']<0):raise ValueError('amount_inr must be a nonnegative number')
            validated.append((external,name,attrs))
        except ValueError as e:errors.append({'row':i,'error':str(e)})
    if errors:raise HTTPException(422,{'message':'Import rejected. No rows were saved. Correct row errors and retry.','errors':errors})
    for external,name,attrs in validated:
        e=Entity(workspace_id=workspace_id,kind='record',external_id=external,name=name,attributes=attrs,synthetic=synthetic);db.add(e);db.flush();db.add(Node(workspace_id=workspace_id,kind='record',label=name,entity_id=e.id))
    activity(db,workspace_id,f'Imported {len(validated)} '+('synthetic test ' if synthetic else '')+'operational records');db.commit();return {'imported':len(validated),'synthetic':synthetic}

@app.get('/api/graph')
def graph(workspace_id:str,db:DB=Depends(session)):
    ns=list(db.scalars(select(Node).where(Node.workspace_id==workspace_id)));ids=[n.id for n in ns]
    return {'nodes':[row(n) for n in ns],'edges':rows(db,select(Dependency).where(Dependency.source_id.in_(ids),Dependency.target_id.in_(ids)))}

@app.get('/api/graph/nodes/{id}')
def graph_node_details(id:str,db:DB=Depends(session)):
    n=need(db,Node,id);result=row(n)
    if n.entity_id:result['entity']=row(need(db,Entity,n.entity_id))
    if n.change_id:
        c=need(db,Change,n.change_id);result['change']=row(c);result['evidence']=rows(db,select(Evidence).where(Evidence.change_id==c.id))
    if n.document_id:result['document']=row(need(db,Document,n.document_id))
    if n.task_id:result['task']=row(need(db,Task,n.task_id))
    return result
class LinkIn(BaseModel): source_id:str;target_id:str;rationale:str=Field(min_length=10,max_length=3000);verified:bool=True
@app.post('/api/graph/edges')
def link(body:LinkIn,db:DB=Depends(session)):
    a,b=need(db,Node,body.source_id),need(db,Node,body.target_id)
    if a.workspace_id!=b.workspace_id:raise HTTPException(422,'Cannot link different workspaces.')
    if a.id==b.id:raise HTTPException(422,'Cannot link a node to itself.')
    # Reject cycles, making dependency propagation finite and explainable.
    edges=list(db.scalars(select(Dependency).join(Node,Dependency.source_id==Node.id).where(Node.workspace_id==a.workspace_id)))
    reachable={b.id}
    for _ in range(len(edges)+1):
        next_set=reachable|{e.target_id for e in edges if e.source_id in reachable}
        if next_set==reachable:break
        reachable=next_set
    if a.id in reachable:raise HTTPException(422,'This relationship would create a dependency cycle.')
    if db.scalar(select(Dependency).where(Dependency.source_id==a.id,Dependency.target_id==b.id)):raise HTTPException(409,'Relationship already exists.')
    e=Dependency(**body.model_dump());db.add(e);activity(db,a.workspace_id,'Verified dependency mapping',e.id,body.model_dump());db.commit();return row(e)
@app.delete('/api/graph/edges/{id}')
def unlink(id:str,db:DB=Depends(session)):
    e=need(db,Dependency,id);wid=need(db,Node,e.source_id).workspace_id;db.delete(e);activity(db,wid,'Removed dependency',id);db.commit();return {'deleted':id}

@app.post('/api/changes/{id}/replay')
def replay(id:str,db:DB=Depends(session)):
    c=need(db,Change,id);a=need(db,Assessment,c.assessment_id);req=db.scalar(select(Requirement).where(Requirement.change_id==id))
    if not req or not req.verified or not req.rule:raise HTTPException(422,'A reviewer must verify the executable rule before replay.')
    rule=Rule.model_validate(req.rule);r=Replay(assessment_id=a.id,requirement_id=req.id,rule_snapshot=req.rule);db.add(r);db.flush()
    # Only mapped records may be evaluated. Traverse verified edges from this requirement.
    start=db.scalar(select(Node).where(Node.change_id==id));ns=list(db.scalars(select(Node).where(Node.workspace_id==a.workspace_id)));ids=[n.id for n in ns]
    edges=list(db.scalars(select(Dependency).where(Dependency.source_id.in_(ids),Dependency.verified==True)))
    reachable={start.id} if start else set()
    while True:
        next_ids=reachable|{e.target_id for e in edges if e.source_id in reachable}
        if next_ids==reachable:break
        reachable=next_ids
    mapped={n.entity_id for n in ns if n.id in reachable and n.entity_id}
    records=list(db.scalars(select(Entity).where(Entity.workspace_id==a.workspace_id,Entity.kind=='record')))
    if not records:raise HTTPException(422,'Import operational records before replay.')
    for record in records:
        if record.id not in mapped:
            old=new='unknown';explanation='No verified dependency path connects this record to the changed requirement.';outcome='unconnected'
        else:
            old,_=evaluate(record.attributes,rule,rule.old_value);new,explanation=evaluate(record.attributes,rule,rule.new_value)
            outcome='evidence_gap' if new=='unknown' else 'requires_review' if new=='review' else 'no_action'
        db.add(ReplayResult(replay_id=r.id,entity_id=record.id,old_result=old,new_result=new,outcome=outcome,explanation=explanation,record_snapshot=record.attributes))
    activity(db,a.workspace_id,f'Evaluated {len(records)} records in impact replay',r.id);db.commit();return replay_detail(db,r)

def replay_detail(db,r):return {**row(r),'results':[{**row(x),'record':row(need(db,Entity,x.entity_id))} for x in db.scalars(select(ReplayResult).where(ReplayResult.replay_id==r.id))]}
@app.get('/api/replays')
def replays(workspace_id:str,db:DB=Depends(session)):return [replay_detail(db,r) for r in db.scalars(select(Replay).join(Assessment).where(Assessment.workspace_id==workspace_id).order_by(Replay.created_at.desc()))]

class TaskIn(BaseModel):
    workspace_id:str;title:str=Field(min_length=3,max_length=300)
    change_id:str|None=None;entity_id:str|None=None
    assignee:str=Field(default='Local reviewer',min_length=1,max_length=160)
    priority:Literal['low','medium','high']='medium'
    due_date:date|None=None
    evidence:str=Field(default='',max_length=5000)
@app.post('/api/tasks')
def create_task(body:TaskIn,db:DB=Depends(session)):
    workspace(db,body.workspace_id)
    if body.change_id and wid_for_change(db,body.change_id)!=body.workspace_id:raise HTTPException(422,'Change outside workspace')
    if body.entity_id and need(db,Entity,body.entity_id).workspace_id!=body.workspace_id:raise HTTPException(422,'Record outside workspace')
    data=body.model_dump();data['due_date']=body.due_date.isoformat() if body.due_date else None
    t=Task(**data);db.add(t);db.flush();n=Node(workspace_id=t.workspace_id,kind='action',label=t.title,task_id=t.id);db.add(n);db.flush()
    parent=db.scalar(select(Node).where(Node.entity_id==t.entity_id)) if t.entity_id else db.scalar(select(Node).where(Node.change_id==t.change_id)) if t.change_id else None
    if parent:db.add(Dependency(source_id=parent.id,target_id=n.id,rationale='Remediation task explicitly created for this linked object.',verified=True))
    activity(db,t.workspace_id,'Created review task',t.id);db.commit();return row(t)
@app.get('/api/tasks')
def tasks(workspace_id:str,db:DB=Depends(session)):
    return [{**row(t),'comments':rows(db,select(Comment).where(Comment.task_id==t.id)),'history':rows(db,select(Activity).where(Activity.object_id==t.id).order_by(Activity.created_at))} for t in db.scalars(select(Task).where(Task.workspace_id==workspace_id).order_by(Task.created_at.desc()))]
class TaskUpdate(BaseModel):status:Literal['open','in_progress','done'];comment:str=Field(min_length=3,max_length=5000)
@app.patch('/api/tasks/{id}')
def update_task(id:str,body:TaskUpdate,db:DB=Depends(session)):
    t=need(db,Task,id);previous=t.status;t.status=body.status
    db.add(Comment(task_id=id,text=body.comment));activity(db,t.workspace_id,f'Task {previous} to {t.status}',id,{'comment':body.comment});db.commit();return row(t)

class AskIn(BaseModel):workspace_id:str;question:str=Field(min_length=3,max_length=3000);assessment_id:str|None=None
@app.post('/api/assistant')
def assistant(body:AskIn,db:DB=Depends(session)):
    workspace(db,body.workspace_id);mid=model_id(db,body.workspace_id)
    query=select(Section).join(Version).join(Document).where(Document.workspace_id==body.workspace_id)
    if body.assessment_id:
        a=need(db,Assessment,body.assessment_id)
        if a.workspace_id!=body.workspace_id:raise HTTPException(404,'Assessment outside workspace')
        query=query.where(Version.id.in_([a.old_version_id,a.new_version_id]))
    sections=list(db.scalars(query));tokens=set(re.findall(r'\w+',body.question.lower()))
    ranked=sorted(sections,key=lambda s:len(tokens&set(re.findall(r'\w+',s.text.lower()))),reverse=True)[:6]
    if not ranked:raise HTTPException(422,'No readable source passages in this workspace. Import documents first.')
    records=rows(db,select(Entity).where(Entity.workspace_id==body.workspace_id).limit(30))
    replay_query=select(Replay).join(Assessment).where(Assessment.workspace_id==body.workspace_id)
    if body.assessment_id:replay_query=replay_query.where(Replay.assessment_id==body.assessment_id)
    latest_replays=list(db.scalars(replay_query.order_by(Replay.created_at.desc()).limit(2)))
    context={'sources':[{'section_id':s.id,'version_id':s.version_id,'version_label':need(db,Version,s.version_id).label,'reference':s.reference,'text':s.text} for s in ranked],'records':records,'records_context_limit':30,'tasks':rows(db,select(Task).where(Task.workspace_id==body.workspace_id).limit(20)),'replay_runs':[{'id':r.id,'rule_snapshot':r.rule_snapshot,'results':rows(db,select(ReplayResult).where(ReplayResult.replay_id==r.id).limit(30))} for r in latest_replays],'context_limits':'At most 6 source passages, 30 entities, 20 tasks, 2 replay runs with 30 results each. State missing context. Do not infer totals from these truncated lists.'}
    text,run=nugen.chat(db,body.workspace_id,mid,[{'role':'system','content':'You are Riften Assistant. Use only the supplied context as data. No execution or write tools. Answer briefly, state missing information and scope limits. Do not invent legal dates or sources. Cite only supplied section IDs in square brackets. You cannot make legal determinations or claim records were evaluated without replay results.'},{'role':'user','content':json.dumps({'question':body.question,'context':context})}], 'assistant')
    # Resolve only real retrieved IDs. Unsupported IDs are surfaced, never turned into citations.
    valid={s.id for s in ranked};cited=set(re.findall(r'\[([a-f0-9]{32})\]',text));unknown=cited-valid
    return {'answer':text,'inference_id':run.id,'sources':[{'section_id':s.id,'reference':s.reference,'version_id':s.version_id,'text':s.text} for s in ranked if s.id in cited],'retrieved_sources':[{'section_id':s.id,'reference':s.reference,'version_id':s.version_id} for s in ranked],'verification':'Unsupported citation IDs: '+', '.join(unknown) if unknown else 'Citations resolve to retrieved passages. Answer meaning still requires review.','model_id':mid}

@app.get('/api/model-lab')
def model_lab(workspace_id:str,db:DB=Depends(session)):
    return {'configured':bool(os.getenv('NUGEN_API_KEY')),'jobs':rows(db,select(ModelJob).where(ModelJob.workspace_id==workspace_id).order_by(ModelJob.created_at.desc())),'deployments':rows(db,select(Deployment).join(ModelJob).where(ModelJob.workspace_id==workspace_id)),'inferences':rows(db,select(Inference).where(Inference.workspace_id==workspace_id).order_by(Inference.created_at.desc()).limit(50)),'evaluations':rows(db,select(Evaluation).where(Evaluation.workspace_id==workspace_id))}

@app.get('/api/model-lab/base-models')
def base_models():return nugen.request('GET','/models/base')

class AlignUpload(BaseModel):workspace_id:str;version_id:str
@app.post('/api/model-lab/documents')
def alignment_upload(body:AlignUpload,db:DB=Depends(session)):
    v=need(db,Version,body.version_id)
    if need(db,Document,v.document_id).workspace_id!=body.workspace_id:raise HTTPException(404,'Source outside workspace')
    if v.status!='ready':raise HTTPException(422,'Only successfully extracted documents can be uploaded.')
    if len(v.text.split())<500:raise HTTPException(422,f'Document has {len(v.text.split())} words. Nugen requires at least 500 words. No padding will be added.')
    existing=db.scalar(select(ModelJob).where(ModelJob.workspace_id==body.workspace_id,ModelJob.kind=='document',ModelJob.request['version_id'].as_string()==v.id))
    if existing:raise HTTPException(409,'This version has already been submitted. Refresh its processing status.')
    j=ModelJob(workspace_id=body.workspace_id,kind='document',status='SUBMITTING',request={'version_id':v.id});db.add(j);db.commit()
    try:
        result=nugen.request('POST','/documents/create',files={'files':('riften-corpus.txt',v.text.encode(),'text/plain')},data={'names':v.label})
        j.remote_id=result['document_ids'][0];j.status='QUEUED';j.response=result
    except Exception as e:j.status='failed';j.error=str(e);db.commit();raise
    db.commit();return row(j)

class AlignmentIn(BaseModel):workspace_id:str;base_model_id:str;document_ids:list[str]=Field(min_length=1,max_length=5);alignment_name:str=Field(min_length=3,max_length=160)
@app.post('/api/model-lab/align')
def align(body:AlignmentIn,db:DB=Depends(session)):
    workspace(db,body.workspace_id)
    if db.scalar(select(ModelJob).where(ModelJob.workspace_id==body.workspace_id,ModelJob.kind=='alignment')):raise HTTPException(409,'An alignment already exists in this workspace. Reuse it; repeated paid jobs are disabled in this demo.')
    for id in body.document_ids:
        doc=db.scalar(select(ModelJob).where(ModelJob.workspace_id==body.workspace_id,ModelJob.kind=='document',ModelJob.remote_id==id))
        if not doc or doc.status!='READY':raise HTTPException(422,'Every alignment document must be processed and READY.')
    payload=body.model_dump(exclude={'workspace_id'})
    j=ModelJob(workspace_id=body.workspace_id,kind='alignment',status='SUBMITTING',request=payload);db.add(j);db.commit()
    try:r=nugen.request('POST','/alignment-projects/create',json=payload);j.response=r;j.remote_id=r['alignment_id'];j.status=r['status']
    except Exception as e:j.status='submission_unknown';j.error=str(e);db.commit();raise
    db.commit();return row(j)

@app.post('/api/model-lab/jobs/{id}/refresh')
def refresh_model(id:str,db:DB=Depends(session)):
    j=need(db,ModelJob,id)
    if not j.remote_id:raise HTTPException(422,'No remote ID. Inspect remote account state before resubmission.')
    path=('/documents/' if j.kind=='document' else '/alignment-projects/' if j.kind=='alignment' else '/benchmarks/')+j.remote_id
    status=nugen.request('GET',path+'/status');j.status=status['status'];j.error=status.get('error')
    if j.kind=='alignment':
        details=nugen.request('GET',path);j.model_id=details.get('model_id');j.response={'status':status,'detail':details}
    else:j.response=status
    db.commit();return row(j)

@app.post('/api/model-lab/jobs/{id}/deploy')
def deploy(id:str,db:DB=Depends(session)):
    j=need(db,ModelJob,id)
    if j.kind!='alignment' or j.status!='READY' or not j.model_id:raise HTTPException(422,'Alignment must be READY and have an aligned model ID.')
    existing=db.scalar(select(Deployment).where(Deployment.job_id==j.id))
    if existing:raise HTTPException(409,'Deployment already submitted. Refresh its status instead.')
    d=Deployment(job_id=j.id,model_id=j.model_id,status='SUBMITTING');db.add(d);db.commit()
    try:r=nugen.request('POST',f'/models/{j.model_id}/deployment');d.response=r;d.status='DEPLOYING'
    except Exception as e:d.status='submission_unknown';d.response={'error':str(e)};db.commit();raise
    db.commit();return row(d)
@app.post('/api/model-lab/deployments/{id}/refresh')
def refresh_deployment(id:str,db:DB=Depends(session)):
    d=need(db,Deployment,id);r=nugen.request('GET',f'/models/{d.model_id}/deployment/status');d.status=r['status'];d.response=r;db.commit();return row(d)

class TestIn(BaseModel):workspace_id:str;prompt:str=Field(min_length=3,max_length=5000)
@app.post('/api/model-lab/inference')
def test_inference(body:TestIn,db:DB=Depends(session)):
    mid=model_id(db,body.workspace_id);text,run=nugen.chat(db,body.workspace_id,mid,[{'role':'user','content':body.prompt}],'model_test');return {'answer':text,'run':row(run)}

class BenchmarkIn(BaseModel):workspace_id:str;document_id:str
@app.post('/api/model-lab/benchmark')
def create_benchmark(body:BenchmarkIn,db:DB=Depends(session)):
    doc=db.scalar(select(ModelJob).where(ModelJob.workspace_id==body.workspace_id,ModelJob.kind=='document',ModelJob.remote_id==body.document_id,ModelJob.status=='READY'))
    if not doc:raise HTTPException(422,'Select a READY alignment document.')
    if db.scalar(select(ModelJob).where(ModelJob.workspace_id==body.workspace_id,ModelJob.kind=='benchmark')):raise HTTPException(409,'A benchmark exists. Reuse it.')
    payload={'document_ids':[body.document_id],'n_samples':5,'benchmark_name':'Riften five-question source benchmark'}
    j=ModelJob(workspace_id=body.workspace_id,kind='benchmark',status='SUBMITTING',request=payload);db.add(j);db.commit()
    try:r=nugen.request('POST','/benchmarks/create',json=payload);j.remote_id=r['benchmark_id'];j.status=r['status'];j.response=r
    except Exception as e:j.status='submission_unknown';j.error=str(e);db.commit();raise
    db.commit();return row(j)

class EvalIn(BaseModel):workspace_id:str;benchmark_id:str;baseline_model_id:str|None=None
@app.post('/api/model-lab/evaluations')
def create_eval(body:EvalIn,db:DB=Depends(session)):
    mid=model_id(db,body.workspace_id)
    bench=db.scalar(select(ModelJob).where(ModelJob.workspace_id==body.workspace_id,ModelJob.kind=='benchmark',ModelJob.remote_id==body.benchmark_id,ModelJob.status=='READY'))
    if not bench:raise HTTPException(422,'Benchmark must be READY.')
    if db.scalar(select(Evaluation).where(Evaluation.workspace_id==body.workspace_id)):raise HTTPException(409,'An evaluation exists. Reuse it to avoid duplicate charges.')
    payload={'model_id':mid,'benchmark_id':body.benchmark_id,'evaluation_name':'Riften evidence interpretation'}
    if body.baseline_model_id:payload['baseline_model_id']=body.baseline_model_id
    e=Evaluation(workspace_id=body.workspace_id,status='SUBMITTING',request=payload,response={});db.add(e);db.commit()
    try:
        result=nugen.request('POST','/evaluations/create',json=payload);e.remote_id=result['evaluation_id'];e.status=result['status'];e.response=result
    except Exception as exc:e.status='submission_unknown';e.response={'error':str(exc)};db.commit();raise
    db.commit();return row(e)
@app.post('/api/model-lab/evaluations/{id}/refresh')
def refresh_eval(id:str,db:DB=Depends(session)):
    e=need(db,Evaluation,id)
    if not e.remote_id:raise HTTPException(422,'Submission outcome is unknown. Inspect the Nugen account before any new evaluation.')
    status=nugen.request('GET',f'/evaluations/{e.remote_id}/status');e.status=status['status'];e.response={'status':status,'detail':nugen.request('GET',f'/evaluations/{e.remote_id}')}
    if e.status=='READY':e.response={**e.response,'results':nugen.request('GET',f'/evaluations/{e.remote_id}/results')}
    db.commit();return row(e)

class RetrievalIn(BaseModel):workspace_id:str;text:str=Field(min_length=3,max_length=5000);mode:Literal['embeddings','rerank']='embeddings'
@app.post('/api/model-lab/retrieval')
def retrieval(body:RetrievalIn,db:DB=Depends(session)):
    mid=model_id(db,body.workspace_id)
    if body.mode=='embeddings':path='/inference/embeddings';payload={'model':mid,'input':body.text}
    else:
        passages=list(db.scalars(select(Section).join(Version).join(Document).where(Document.workspace_id==body.workspace_id).limit(15)))
        if not passages:raise HTTPException(422,'No source passages available.')
        path='/inference/reranker';payload={'model':mid,'query':body.text,'documents':[s.text for s in passages]}
    run=Inference(workspace_id=body.workspace_id,model_id=mid,purpose=body.mode,status='running',request=payload);db.add(run);db.commit()
    try:result=nugen.request('POST',path,json=payload);run.response=result;run.status='succeeded'
    except Exception as e:run.status='failed';run.error=str(e);db.commit();raise
    db.commit();return row(run)

class DemoIn(BaseModel):workspace_id:str
@app.post('/api/demo/regulation')
def import_demo(body:DemoIn,db:DB=Depends(session)):
    workspace(db,body.workspace_id)
    url='https://rbi.org.in/scripts/NotificationUser.aspx?Id=12555&Mode=0'
    if db.scalar(select(Document).where(Document.workspace_id==body.workspace_id,Document.url==url)):raise HTTPException(409,'This official demonstration is already imported.')
    data,ctype=safe_fetch(url);pairs=annex_snapshots(data)
    authority=db.scalar(select(Authority).where(Authority.name=='Reserve Bank of India'))
    if not authority:authority=Authority(name='Reserve Bank of India');db.add(authority);db.flush()
    doc=Document(workspace_id=body.workspace_id,title='Non-callable term deposits',url=url,authority_id=authority.id);db.add(doc);db.flush();source_node(db,doc)
    full,_=add_version(db,doc,data,'rbi-circular.html','Official circular and annex',ctype,provenance='Complete RBI/2023-24/74 circular, 26 October 2023. Historical issued amendment; subsequent changes not verified.',legal_status='issued_historical',effective='2023-10-26')
    db.add(Fetch(document_id=doc.id,status=full.status,content_hash=digest(data)))
    versions=[]
    for col,label in [(1,'Existing provisions, official annex'),(2,'Amended provisions, 26 Oct 2023')]:
        sections=[(ref,pair[col],None) for pair in pairs for ref in [pair[0]]]
        text='\n\n'.join(s[0]+'\n'+s[1] for s in sections).encode()
        v,_=add_version(db,doc,text,'annex-column.txt',label,provenance=f'Historical clause snapshot extracted from the {"Existing" if col==1 else "Amended"} Provisions column of the official RBI annex. Original full circular retained as version {full.id}. Not a complete master direction.',custom_sections=sections,legal_status='historical_clause_snapshot',effective='2023-10-26' if col==2 else None);versions.append(v)
    db.commit()
    result=create_assessment(CompareIn(workspace_id=body.workspace_id,old_version_id=versions[0].id,new_version_id=versions[1].id),db)
    for change in result['changes']:
        # Curated, non-executable draft for the exact official domestic individual-deposit clause.
        if change['new_section']['reference'].split('/')[-1].replace(' ','').startswith('7(a)(iii)'):
            rule={'field':'amount_inr','operator':'lte','old_value':1500000,'new_value':10000000,'scope':[{'field':'holder_type','op':'eq','value':'individual'},{'field':'deposit_type','op':'eq','value':'domestic'},{'field':'applicability_confirmed','op':'eq','value':True}],'expect':{'field':'premature_withdrawal','value':True},'note':'Curated draft for RBI annex section 7(a)(iii), not a Nugen inference. Reviewer must confirm institution, product, contract-date applicability and exclusion scope. No assumption of retroactivity.'}
            db.add(Requirement(change_id=change['id'],text='Draft domestic individual term-deposit withdrawal condition. Requires verification.',rule=rule,verified=False))
    activity(db,body.workspace_id,'Imported authentic RBI annex comparison',result['id']);db.commit();return result

@app.post('/api/model-lab/adopt-local-run')
def adopt_run(body:DemoIn,db:DB=Depends(session)):
    """Adopt the single live setup run created by this checkout, never another user's models."""
    workspace(db,body.workspace_id);folder=ROOT/'data'/'nugen'
    if not (folder/'alignment-projects_create.json').is_file():raise HTTPException(404,'No local live run to adopt.')
    if db.scalar(select(ModelJob).where(ModelJob.kind=='alignment')):raise HTTPException(409,'The local alignment is already adopted by a workspace.')
    upload=json.loads((folder/'documents_create.json').read_text())['body']
    for did in upload['document_ids']:
        r=nugen.request('GET',f'/documents/{did}/status');db.add(ModelJob(workspace_id=body.workspace_id,kind='document',remote_id=did,status=r['status'],request={'origin':'Official RBI circular, 878 words; local setup run'},response=r))
    aid=json.loads((folder/'alignment-projects_create.json').read_text())['body']['alignment_id'];detail=nugen.request('GET',f'/alignment-projects/{aid}')
    j=ModelJob(workspace_id=body.workspace_id,kind='alignment',remote_id=aid,status=detail['status'],model_id=detail.get('model_id'),request={'base_model_id':'Qwen/Qwen2.5-1.5B-Instruct','document_ids':upload['document_ids']},response=detail);db.add(j);db.flush()
    if j.model_id:
        dep=nugen.request('GET',f'/models/{j.model_id}/deployment/status');db.add(Deployment(job_id=j.id,model_id=j.model_id,status=dep['status'],response=dep))
    activity(db,body.workspace_id,'Connected live Nugen alignment and deployment',j.id);db.commit();return row(j)
