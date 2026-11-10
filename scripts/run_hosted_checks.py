"""Run private-deployment QA without printing or storing its access secret."""
import json,subprocess,shutil,pathlib
cmd=shutil.which('vercel.cmd') or shutil.which('vercel')
r=subprocess.run([cmd,'api','/v9/projects/prj_AB68jbYomCaOM8ATjxQ4FI8pLBcV','--raw'],capture_output=True,text=True,check=True)
project=json.loads(r.stdout)
tokens=project.get('protectionBypass',{})
if not tokens:raise SystemExit('No test access is configured. Run the supported Vercel curl check first.')
wid=json.loads(pathlib.Path('data/demo-workspace.json').read_text())['workspace_id']
payload={'url':'https://riften-regulatory.vercel.app','wid':wid,'bypass':next(iter(tokens))}
subprocess.run(['node','scripts/hosted-test.mjs'],input=json.dumps(payload),text=True,check=True)
