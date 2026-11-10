import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const {url,bypass,ownerToken}=JSON.parse(raw);
const browser=await chromium.launch({headless:true,channel:'chromium'});
await fs.mkdir('research/verification',{recursive:true});
const observations=[];
try {
  for (const [name,viewport,denyStorage] of [
    ['desktop',{width:1440,height:960},false],
    ['mobile',{width:390,height:844},false],
    ['restricted-storage',{width:1280,height:800},true],
  ]) {
    const context=await browser.newContext({viewport});
    const page=await context.newPage(),errors=[],failed=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400)failed.push({path:new URL(r.url()).pathname,status:r.status()});});
    if(bypass)await page.route(url+'/**',r=>r.continue({headers:{...r.request().headers(),'x-vercel-protection-bypass':bypass}}));
    if(denyStorage)await page.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage denied','SecurityError');}}));
    const root=await page.goto(url);
    await expect(page).toHaveTitle('Riften');
    await expect(page.locator('.connection')).toHaveText('Nugen aligned model',{timeout:60000});
    await expect(page.locator('.demo-banner')).toContainText('Public demo');
    await expect(page.locator('.assessment-card')).toHaveCount(1);
    await page.screenshot({path:`research/verification/public-${name}.png`,fullPage:true});
    await page.locator('nav').getByTitle('Impact replay',{exact:true}).click();
    await expect(page.locator('.replay-counts')).toContainText('2requires review');
    await page.reload();
    await expect(page.locator('.connection')).toHaveText('Nugen aligned model');
    if(!denyStorage)await expect(page.locator('.replay-counts')).toContainText('2requires review');
    if(errors.length||failed.length)throw new Error(JSON.stringify({name,errors,failed}));
    observations.push({name,status:root.status(),console_errors:[...errors],failed_requests:[...failed]});
    if(name==='desktop') {
      await page.getByRole('button',{name:'Owner access',exact:true}).click();
      await expect(page.getByRole('dialog')).toContainText('Owner key');
      await page.getByRole('button',{name:'Close dialog'}).click();
      const blocked=await page.evaluate(async()=>{
        const paths=['/api/workspaces','/api/assistant','/api/model-lab/inference','/api/model-lab/align'];
        return Promise.all(paths.map(async path=>({path,status:(await fetch(path,{method:'POST'})).status})));
      });
      if(blocked.some(r=>r.status!==403))throw new Error('Public mutation was not blocked');
      if(ownerToken) {
        const login=await page.evaluate(async token=>({status:(await fetch('/api/access/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})})).status}),ownerToken);
        if(login.status!==200)throw new Error('Owner login failed');
        await page.reload();
        await expect(page.getByRole('button',{name:'Lock editing',exact:true})).toBeVisible();
        const cookies=await context.cookies();
        if(!cookies.some(c=>c.name==='riften_owner'&&c.httpOnly&&c.secure))throw new Error('Owner cookie flags missing');
        await page.getByRole('button',{name:'Lock editing',exact:true}).click();
        await expect(page.locator('.demo-banner')).toBeVisible();
        observations.push({owner_login:true,owner_logout:true,public_paid_requests_blocked:true});
      }
    }
    await context.close();
  }
  const context=await browser.newContext();const page=await context.newPage();
  if(bypass)await page.route(url+'/**',r=>r.continue({headers:{...r.request().headers(),'x-vercel-protection-bypass':bypass}}));
  await page.route('**/assets/*.js',r=>r.abort());
  await page.goto(url);
  await expect(page.locator('#startup')).toBeVisible();
  await expect(page.getByRole('link',{name:'Reload workspace'})).toBeVisible();
  observations.push({failed_bundle_has_visible_recovery:true});
  const report={url,verified_at:new Date().toISOString(),public_entry:!bypass,observations};
  await fs.writeFile('docs/public-access-verification.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {await browser.close();}
