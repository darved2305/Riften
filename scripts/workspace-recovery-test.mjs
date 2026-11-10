import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const {workspace_id:wid}=JSON.parse(await fs.readFile('data/demo-workspace.json','utf8'));
const all=await fetch('http://127.0.0.1:8000/api/workspaces?include_archived=true').then(r=>r.json());
const archived=all.find(w=>w.archived);
if(!archived)throw new Error('An archived QA workspace is required for this regression.');
const browser=await chromium.launch({headless:true,channel:'chromium'});
try{
 for(const direct of [false,true]){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(({saved})=>{if(!sessionStorage.getItem('initialized')){localStorage.setItem('riften-workspace',saved);localStorage.setItem('riften-page','Home');sessionStorage.setItem('initialized','true')}},{saved:archived.id});
  const page=await context.newPage();
  await page.goto('http://127.0.0.1:5173/'+(direct?'?workspace='+wid:''));
  await expect(page.getByLabel('Workspace',{exact:true})).toHaveValue(wid);
  await expect(page.locator('.connection')).toHaveText('Nugen aligned model');
  await expect(page.locator('.assessment-card')).toHaveCount(1);
  await expect(page.locator('.source-row')).toHaveCount(1);
  await page.getByRole('button',{name:'Select aligned model'}).click();
  await expect(page.locator('.model-menu')).toContainText('Qwen/Qwen2.5-1.5B-Instruct');
  await expect(page.locator('.model-menu')).not.toContainText('No deployed aligned model.');
  await page.screenshot({path:'research/verification/workspace-recovery-'+(direct?'direct':'saved')+'.png',fullPage:true});
  await page.reload();await expect(page.locator('.connection')).toHaveText('Nugen aligned model');await expect(page.locator('.assessment-card')).toHaveCount(1);
  await context.close();
 }
 console.log('Saved QA workspace and explicit-link recovery both pass, including reload, model selector, assessment and source.');
}finally{await browser.close()}
