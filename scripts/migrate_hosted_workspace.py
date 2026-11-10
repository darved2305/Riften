"""Copy a selected real local workspace to a new, empty hosted PostgreSQL database."""
import os
import sys
import json
import hashlib
import mimetypes
from pathlib import Path
from dotenv import dotenv_values
from sqlalchemy import create_engine, select, func

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
config=dotenv_values(ROOT/'.env.hosted')
os.environ['DATABASE_URL']=config['DATABASE_URL_UNPOOLED']
from backend.db import engine as target,Base
from backend import models

wid=json.loads((ROOT/'data/demo-workspace.json').read_text())['workspace_id']
source=create_engine('sqlite:///'+str(ROOT/'data/riften.db').replace('\\','/'))
with source.connect() as conn:
    data={table.name:[dict(r) for r in conn.execute(select(table)).mappings()] for table in Base.metadata.sorted_tables}
keep={}
def retain(table,predicate):
    data[table]=[r for r in data[table] if predicate(r)]
    keep[table]={r.get('id',r.get('version_id')) for r in data[table]}
retain('workspaces',lambda r:r['id']==wid)
for table in ['source_documents','organization_entities','impact_assessments','review_tasks','activity_history','model_alignment_jobs','inference_runs','evaluation_results','graph_nodes']:
    retain(table,lambda r:r['workspace_id']==wid)
parents={'document_versions':('document_id','source_documents'),'document_sections':('version_id','document_versions'),'regulatory_changes':('assessment_id','impact_assessments'),'assessment_evidence':('change_id','regulatory_changes'),'requirements':('change_id','regulatory_changes'),'dependency_relationships':('source_id','graph_nodes'),'replay_runs':('assessment_id','impact_assessments'),'replay_results':('replay_id','replay_runs'),'review_comments':('task_id','review_tasks'),'source_fetch_history':('document_id','source_documents'),'model_deployments':('job_id','model_alignment_jobs'),'source_originals':('version_id','document_versions')}
for table,(column,parent) in parents.items():retain(table,lambda r,c=column,p=parent:r[c] in keep[p])
retain('authorities',lambda r:r['id'] in {d['authority_id'] for d in data['source_documents']})
blobs={r['version_id'] for r in data['source_originals']}
for v in data['document_versions']:
    if v['id'] not in blobs:
        path=Path(v['original_path']);raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=v['content_hash']:raise RuntimeError('Original source hash mismatch: '+v['id'])
        data['source_originals'].append({'version_id':v['id'],'filename':path.name,'data':raw,'media_type':mimetypes.guess_type(path.name)[0] or 'application/octet-stream','content_hash':v['content_hash']})
    v['original_path']='database:'+v['id']
with target.begin() as conn:
    count=conn.scalar(select(func.count()).select_from(models.Workspace))
    if count:raise SystemExit('Target is not empty. Refusing to duplicate or overwrite hosted records.')
    for table in Base.metadata.sorted_tables:
        records=data[table.name]
        if records:conn.execute(table.insert(),records)
        print(table.name,len(records))
print('Imported selected workspace and verified original bytes. No alignment or paid inference jobs created.')
