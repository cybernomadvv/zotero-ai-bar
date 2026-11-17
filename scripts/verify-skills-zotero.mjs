/* global console, setTimeout */
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import process from 'node:process';
import {
  createProfile,
  spawnZotero,
} from 'file:///C:/Users/FreeSHR/Documents/claude/zotero-ai-explain-z10-compat-20261116/scripts/zotero-e2e/launch.mjs';

// Deterministic model responses exercise the real SDK loop and native plugin UI.
// This verifies integration, not the quality of a provider's feedback classification.
const root = process.cwd();
const requests = [];
const server = createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const data of request) raw += data;
    const body = JSON.parse(raw);
    requests.push(body);
    const latest = body.messages.at(-1);
    const user = body.messages.findLast((message) => message.role === 'user');
    const text =
      typeof user?.content === 'string'
        ? user.content
        : user?.content
            ?.filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n') || '';
    let name, args;
    if (latest.role !== 'tool') {
      if (text.includes('NATIVE_ADD_SKILL')) {
        name = 'manage_skill';
        args = {
          action: 'save',
          id: null,
          name: '论文方法分解',
          description: '解释论文方法时使用',
          instructions: '先说明输入与输出，再逐步拆解方法。',
          enabled: true,
        };
      } else {
        name = 'learn_explanation_preference';
        const reverse = text.includes('NATIVE_LEARN_REVERSE');
        args = {
          context: 'math',
          dimension: 'structure',
          value: reverse ? '先公式后推导' : '先直觉后公式',
          sourceQuote: reverse ? '先列公式，再给推导' : '先讲直觉，再推公式',
          evidence: reverse ? '用户修改数学解释顺序' : '用户要求数学解释先直觉再公式',
        };
      }
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish_reason = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'native-skills', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
      );
    if (name) {
      assert.ok(
        body.tools?.some((entry) => entry.function.name === name),
        `Missing ${name} in native request`
      );
      send({
        role: 'assistant',
        tool_calls: [{ index: 0, id: `native-call-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      });
      send({}, 'tool_calls');
    } else {
      send({ role: 'assistant', content: 'SKILL_NATIVE_OK：已按你的明确反馈调整。' });
      send({}, 'stop');
    }
    response.end('data: [DONE]\n\n');
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const profileDir = createProfile({
  marionettePort: 2875,
  extraPrefs: {
    'extensions.startupScanScopes': 15,
    'extensions.zotero.${addonRef}.chat.defaultMode': 'normal',
    'extensions.zotero.${addonRef}.translate.enableAuto': false,
  },
});
const resultFile = join(profileDir, 'skills-result.json');
const screenshotFile = join(root, '.scaffold/skills-native.png');
const packagePath = join(profileDir, 'extensions/zaibar@fukeke.com.xpi');
copyFileSync(join(root, '.scaffold/build/zotero-ai-bar.xpi'), packagePath);
const provider = JSON.parse(readFileSync(join(root, 'addon/content/common_providers.min.json'), 'utf8')).magpie;
provider.api = `http://127.0.0.1:${server.address().port}/v1`;
const probe = `async function runSkillsProbe() {
 await Zotero.initializationPromise; await Zotero.uiReadyPromise;
 const win=Zotero.getMainWindow(), delay=ms=>new Promise(resolve=>win.setTimeout(resolve,ms));
 const check=(condition,label)=>{if(!condition)throw new Error(label);};
 const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(await fn())return;await delay(100);}throw new Error('Timeout: '+label);};
 await wait(()=>Zotero.ZAIBar?.data.initialized,'plugin startup');
 const addon=Zotero.ZAIBar, provider=${JSON.stringify(provider)};
 addon.data.commonProviders={...(addon.data.commonProviders||{}),magpie:provider};
 const model=Object.values(provider.models)[0];
 addon.data.userProviderConfigV2={active:{providerId:'magpie',modelId:model.id},env:{magpie:{MAGPIE_API_KEY:'isolated-probe'}},recentUsed:[],addedProviders:{magpie:provider},addedModels:[{...model,providerId:'magpie',enabled:true}]};
 const item=await Zotero.Attachments.linkFromFile({file:'C:/Users/FreeSHR/Documents/claude/zotero-ai-explain-z10-compat-20261116/tests/fixtures/sample.pdf'.replaceAll('/',String.fromCharCode(92))});
 const reader=await Zotero.Reader.open(item.id);const tabID=reader.tabID,sessionID='article:'+tabID;
 await wait(()=>addon.data.sidePaneBodyMap?.has(sessionID),'article chat mounted');
 const session=addon.chatManager.getOrCreateSession({sessionId:sessionID,kind:'article',sourceTabId:tabID,itemId:item.id});
 session.chatMode='normal';
 const statePath=PathUtils.join(PathUtils.profileDir,'zaibar','skills-v1.json');
 const state=()=>IOUtils.readJSON(statePath);
 const send=async userPrompt=>{await addon.chatManager.sendChatRequest({sessionId:sessionID,sessionKind:'article',sourceTabId:tabID,itemId:item.id,userPrompt});await delay(120);};
 await send('NATIVE_LEARN_A 以后数学解释先讲直觉，再推公式。');
 check((await state()).preferences.find(p=>p.status==='active')?.level===0,'first correction not L0');
 await send('NATIVE_LEARN_A 我再强调一次，数学解释先讲直觉，再推公式。');
 check((await state()).preferences.find(p=>p.status==='active')?.level===1,'independent repeat not L1');
 check(session.lastAssistantPop?.isConnected,'no actual assistant bubble for Retry');
 await addon.chatManager.regenerateLastResponse(session);await delay(120);
 check((await state()).preferences.find(p=>p.status==='active')?.level===1,'Retry reinforced the same correction');
 await send('NATIVE_LEARN_REVERSE 以后数学解释先列公式，再给推导。');
 const learned=await state();
 check(learned.preferences.find(p=>p.value==='先直觉后公式')?.status==='superseded','old preference still active');
 check(learned.preferences.find(p=>p.value==='先直觉后公式')?.level===0,'old preference not demoted');
 check(learned.preferences.find(p=>p.status==='active')?.value==='先公式后推导','new preference missing');
 await send('NATIVE_ADD_SKILL 请创建一个论文方法分解技能，以后先说明输入输出，再逐步拆解方法。');
 check((await state()).skills.some(s=>s.name==='论文方法分解'),'assistant skill creation not persisted');
 let system=await addon.chatManager.buildSystemContent({chatMode:'normal',session});
 check(system.includes('先公式后推导')&&system.includes('先说明输入与输出'),'skills not injected into normal chat context');
 let dialog=win.openDialog('chrome://zaibar/content/skillManager.html','zaibar-skills-native-probe','chrome,centerscreen,resizable,dialog=no,width=1020,height=850',{onBodyLoaded:w=>addon.hooks.onPrefsEvent('skillManagerLoad',{window:w})});
 await wait(()=>dialog.document.querySelector('#skill-new')&&!dialog.document.querySelector('#skill-new').disabled,'manager ready');
 let doc=dialog.document;
 const click=id=>doc.getElementById(id).click();
 const idle=async()=>{await delay(60);await wait(()=>doc.getElementById('skill-manager').getAttribute('aria-busy')==='false','manager idle');check(doc.getElementById('skill-status').dataset.error!=='true',doc.getElementById('skill-status').textContent);};
 check(doc.querySelector('[data-skill-id="explanation-preferences"]'),'builtin missing in UI');
 check(doc.getElementById('skill-save').disabled&&doc.getElementById('skill-delete').disabled,'builtin editor writable');
 check(doc.querySelectorAll('[data-preference-id]').length===2,'learned preferences missing from UI');
 click('skill-new');
 for(const [id,value] of [['skill-name','UI 自建技能'],['skill-description','用户通过插件界面添加'],['skill-instructions','解释术语时给出一例。']]){const field=doc.getElementById(id);field.value=value;field.dispatchEvent(new dialog.Event('input',{bubbles:true}));}
 click('skill-save');await idle();
 const userSkill=(await state()).skills.find(s=>s.name==='UI 自建技能');check(userSkill,'UI create not saved');
 doc.getElementById('skill-instructions').value='解释术语时给出两个例子。';doc.getElementById('skill-instructions').dispatchEvent(new dialog.Event('input',{bubbles:true}));click('skill-save');await idle();
 check((await state()).skills.find(s=>s.id===userSkill.id).instructions.includes('两个'),'UI edit not saved');
 click('skill-enabled');await idle();
 check(!(await state()).skills.find(s=>s.id===userSkill.id).enabled,'UI disable not saved');
 system=await addon.chatManager.buildSystemContent({chatMode:'full-text',session});check(!system.includes('给出两个例子'),'disabled skill still in prompt');
 doc.querySelector('[data-skill-id="explanation-preferences"]').click();
 await delay(200);
 let visualCapture;
 try{const canvas=doc.createElement('canvas');canvas.width=dialog.innerWidth;canvas.height=dialog.innerHeight;canvas.getContext('2d').drawWindow(dialog,0,0,canvas.width,canvas.height,'white');const bytes=Uint8Array.from(win.atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));await IOUtils.write(${JSON.stringify(screenshotFile)},bytes);visualCapture=true;}catch(error){visualCapture=String(error);}
 const activeRow=doc.querySelector('[data-preference-id][data-status="active"]');check(activeRow.textContent.includes('L0'),'active level not displayed');activeRow.querySelector('[data-action="forget-preference"]').click();await idle();
 check(!(await state()).preferences.some(p=>p.status==='active'),'forget not persisted');
 system=await addon.chatManager.buildSystemContent({chatMode:'normal',session});check(!system.includes('先公式后推导'),'forgotten preference still in prompt');
 doc.querySelector('[data-skill-id="'+userSkill.id+'"]').click();dialog.confirm=()=>true;click('skill-delete');await idle();check(!(await state()).skills.some(s=>s.id===userSkill.id),'UI delete not saved');
 dialog.close();
 dialog=win.openDialog('chrome://zaibar/content/skillManager.html','zaibar-skills-native-reopen','chrome,centerscreen,resizable,dialog=no,width=1020,height=850',{onBodyLoaded:w=>addon.hooks.onPrefsEvent('skillManagerLoad',{window:w})});
 await wait(()=>dialog.document.querySelector('[data-skill-id]')&&!dialog.document.querySelector('#skill-new').disabled,'manager reopen');
 check(dialog.document.querySelectorAll('[data-skill-id]').length===2,'reopened skill list inconsistent');
 const result={pass:true,normalChatToolLoop:true,firstL0:true,repeatL1:true,retryNoReinforcement:true,conflictDemotes:true,assistantCreatesSkill:true,promptInjection:true,nativeUI:true,uiCreateEditToggleDelete:true,builtinProtected:true,forget:true,reopen:true,visualCapture};
 dialog.close();await IOUtils.writeUTF8(${JSON.stringify(resultFile)},JSON.stringify(result));
}`;
mkdirSync(join(profileDir, 'probe'), { recursive: true });
const probeFile = join(profileDir, 'probe/skills.js');
writeFileSync(probeFile, probe);
execFileSync('python', [
  '-I',
  '-c',
  'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); probe=pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"); z=zipfile.ZipFile(p); entries={n:z.read(n) for n in z.namelist()}; z.close(); text=entries["bootstrap.js"].decode(); text=text.replace("await Zotero.ZAIBar.hooks.onStartup();", "await Zotero.ZAIBar.hooks.onStartup();"+chr(10)+"runSkillsProbe().catch(error=>IOUtils.writeUTF8("+repr(sys.argv[3])+",JSON.stringify({error:String(error),stack:error.stack}))); "); entries["bootstrap.js"]=(text+chr(10)+probe).encode(); z=zipfile.ZipFile(p,"w",zipfile.ZIP_DEFLATED); [z.writestr(n,d) for n,d in entries.items()]; z.close()',
  packagePath,
  probeFile,
  resultFile,
]);
const handle = spawnZotero({
  binaryPath: 'C:/Program Files/Zotero/zotero.exe',
  profileDir,
  logPath: join(root, '.scaffold/skills-gecko.log'),
  marionettePort: 2875,
  quiet: true,
});
try {
  for (let i = 0; i < 300 && !existsSync(resultFile); i++) await new Promise((resolve) => setTimeout(resolve, 200));
  if (!existsSync(resultFile)) throw new Error(`Skills native probe timed out: ${profileDir}`);
  const result = JSON.parse(readFileSync(resultFile, 'utf8'));
  console.log(JSON.stringify({ ...result, modelFixture: true, requests: requests.length, profileDir }));
  assert.equal(result.pass, true);
  assert.ok(requests.length >= 10);
  assert.ok(requests.some((body) => body.tools.some((tool) => tool.function.name === 'manage_skill')));
} finally {
  await handle.shutdown();
  await new Promise((resolve) => server.close(resolve));
}
