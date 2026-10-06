import path from 'node:path';import assert from 'node:assert/strict';import {revisionBrowserFixture} from './encounter-revision-browser-fixture.mjs';
export async function testRevisionBrowser(browser,root,base,output){
 const p=await browser.newPage({viewport:{width:1440,height:1200}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(base,{waitUntil:'networkidle'});await p.addScriptTag({path:path.join(root,'data.js')});await p.evaluate(source=>{document.getElementById('clinicianSignIn').hidden=true;document.documentElement.classList.add('clinician-authenticated');eval('('+source+')(window)');},revisionBrowserFixture.toString());
  for(const n of ['theme.js','note-drafting-ui.js','encounter-actions-ui.js','encounter-coordinator-ui.js','agent-map-ui.js','encounter-review-ui.js','orchestrator-commands.js','orchestrator-voice-ui.js','encounter-revision-ui.js'])await p.addScriptTag({path:path.join(root,n)});
  await p.locator('[data-note]').waitFor();await p.locator('[data-agent="orchestrator"] strong').click();await p.locator('[data-command]').fill('Change follow-up to three months and update patient instructions.');await p.locator('[data-run]').click();await p.locator('[data-revision]').waitFor({state:'visible'});
  assert.equal(await p.locator('[data-revision] article').count(),3);assert.match(await p.locator('[data-note]').inputValue(),/follow-up in 6 months/);assert.equal(await p.locator('.coordinator-finalize').isDisabled(),true);
  for(const theme of ['dark','light'])for(const width of [1440,760,390,320]){
   await p.setViewportSize({width,height:1200});await p.evaluate(value=>document.documentElement.dataset.theme=value,theme);await p.locator('[data-revision]').scrollIntoViewIfNeeded();
   const m=await p.locator('[data-revision]').evaluate(n=>({page:document.documentElement.scrollWidth,viewport:innerWidth,width:n.clientWidth,scroll:n.scrollWidth,buttons:[...n.querySelectorAll('button')].map(b=>b.getBoundingClientRect().height)}));assert(m.page<=m.viewport+1,JSON.stringify(m));assert(m.scroll<=m.width+1,JSON.stringify(m));assert(m.buttons.every(h=>h>=44),JSON.stringify(m));await p.locator('[data-revision]').screenshot({path:path.join(output,theme+'-'+width+'-coordinated-revisions.png')});
  }
  await p.locator('[data-revision-apply]').focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('[data-revision]').hidden);assert.match(await p.locator('[data-note]').inputValue(),/follow-up in 3 months/);assert.match(await p.locator('[data-note]').inputValue(),/BMP in 6 months/);assert.equal(await p.locator('[data-instructions-reviewed]').isChecked(),false);assert.equal(await p.locator('.coordinator-finalize').isDisabled(),true);
  assert.equal(await p.evaluate(()=>window.revisionTest.requests.some(r=>r.body?.action==='finalize')),false);assert.deepEqual(errors,[]);
  console.log('Revision Chromium passed: real coordinated command/proposal/keyboard approval, unchanged BMP, separate signing gate, dark/light 1440/760/390/320px overflow and touch targets; synthetic backend.');
 }catch(e){await p.screenshot({path:path.join(output,'revision-failure.png'),fullPage:true}).catch(()=>{});throw e;}finally{await p.close();}
}
