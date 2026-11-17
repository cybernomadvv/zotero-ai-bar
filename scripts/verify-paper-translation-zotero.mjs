/* global console, setTimeout */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  createProfile,
  spawnZotero,
} from 'file:///C:/Users/FreeSHR/Documents/claude/zotero-ai-explain-z10-compat-20261116/scripts/zotero-e2e/launch.mjs';
const root = 'C:/Users/FreeSHR/Documents/claude/zotero-ai-bar-custom';
const requests = [];
let resumeFailure = true;
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw),
    data = JSON.parse(body.messages.at(-1).content);
  requests.push(data);
  let output;
  if (data.segments)
    output = data.segments.some((segment) => segment.source.includes('FAIL_CHUNK'))
      ? { segments: [], terms: [] }
      : {
          segments: data.segments.map((segment) => ({ id: segment.id, translation: '全文译文：' + segment.source })),
          terms: [{ source: 'algorithm', translation: '算法专用译法' }],
        };
  else if (data.candidates) output = { id: null };
  else output = { translation: 'AI重译：' + data.selectedText, terms: [{ source: 'algorithm', translation: '算法更新译法' }] };
  if (data.segments && data.segments.some((segment) => segment.source.includes('RESUME_STOP')) && resumeFailure) {
    resumeFailure = false;
    output = { segments: [], terms: [] };
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const payload = JSON.stringify(output);
  setTimeout(() => {
    res.write(
      'data: ' +
        JSON.stringify({
          id: 'probe',
          object: 'chat.completion.chunk',
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta: { content: payload }, finish_reason: null }],
        }) +
        '\n\n'
    );
    res.write(
      'data: ' +
        JSON.stringify({
          id: 'probe',
          object: 'chat.completion.chunk',
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }) +
        '\n\n'
    );
    res.end('data: [DONE]\n\n');
  }, 250);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
const runtime = root + '/.local-runtime';
const profileDir = createProfile({
  extraPrefs: {
    'extensions.startupScanScopes': 15,
    'extensions.zotero.${addonRef}.sidepane.collapsed': true,
    'extensions.zotero.${addonRef}.extend-selection-context': false,
    'extensions.zotero.${addonRef}.translate.enableAuto': true,
    'extensions.zotero.${addonRef}.translate.targetLanguage': 'zh-CN',
    'extensions.zotero.${addonRef}.translate.localPython': runtime + '/venv/Scripts/pythonw.exe',
    'extensions.zotero.${addonRef}.translate.localScript': root + '/scripts/local-translation-server.py',
    'extensions.zotero.${addonRef}.translate.localModelDirectory': runtime + '/model-en-zh-int8',
    'extensions.zotero.${addonRef}.translate.localTokenFile': runtime + '/server-token.txt',
  },
});
mkdirSync(join(profileDir, 'zaibar'), { recursive: true });
cpSync(runtime + '/dictionary', join(profileDir, 'zaibar/dictionary'), { recursive: true });
copyFileSync(root + '/.scaffold/build/zotero-ai-bar.xpi', join(profileDir, 'extensions/zaibar@fukeke.com.xpi'));
const resultFile = join(profileDir, 'paper-result.json');
const source = `async function runPaperProbe(){
 await Zotero.initializationPromise;await Zotero.uiReadyPromise;
 const win=Zotero.getMainWindow(),doc=win.document,delay=ms=>new Promise(resolve=>win.setTimeout(resolve,ms));
 const check=(condition,label)=>{if(!condition)throw new Error(label);};
 const wait=async(predicate,label)=>{for(let i=0;i<200;i++){if(await predicate())return;await delay(50);}throw new Error('Timeout: '+label+' UI: '+doc.querySelector('.floating-translation')?.textContent);};
 await wait(()=>Zotero.ZAIBar?.data.initialized,'plugin startup');
 const addon=Zotero.ZAIBar, prefix=addon.data.config.prefsPrefix;
 const provider=${JSON.stringify(JSON.parse(readFileSync(root + '/addon/content/common_providers.min.json', 'utf8')).magpie)};
 provider.api=${JSON.stringify(baseURL)};addon.data.commonProviders={...(addon.data.commonProviders||{}),magpie:provider};
 addon.data.userProviderConfigV2={active:{providerId:'magpie',modelId:'codex/gpt-6.1-sol'},env:{magpie:{MAGPIE_API_KEY:'test'}},recentUsed:[],addedProviders:{magpie:provider},addedModels:Object.values(provider.models).map(model=>({...model,providerId:'magpie',enabled:true}))};
 const sourceText='The algorithm improves resource utilization. The scheduler allocates GPU resources.';
 const item=await Zotero.Attachments.linkFromFile({file:${JSON.stringify('C:/Users/FreeSHR/Documents/claude/zotero-ai-explain-z10-compat-20261116/tests/fixtures/sample.pdf')}.replaceAll('/',String.fromCharCode(92))});
 Object.defineProperty(item,'attachmentText',{configurable:true,get:()=>Promise.resolve(sourceText)});
 const native=doc.createElementNS('http://www.w3.org/1999/xhtml','div');native.className='selection-popup';native.style.cssText='position:fixed;left:180px;top:180px;width:220px;height:90px;';doc.documentElement.append(native);
 let open=true;const reader={itemID:item.id,tabID:'paper-probe',_internalReader:{_type:'pdf',getSelectionPosition:()=>open?{}:null}};
 const select=text=>{native.replaceChildren();addon.data._readerPopupHandler({reader,doc,params:{annotation:{text,position:{pageIndex:0,rects:[[0,0,10,10]]}}},append:fragment=>native.append(fragment)});};
 const body=()=>native.querySelector('.floating-translation-body')?.textContent||'';
 const button=label=>Array.from(native.querySelectorAll('button')).find(element=>element.textContent===label);
 const statePath=PathUtils.join(PathUtils.profileDir,'zaibar','paper-translations',item.libraryID+'-'+item.key+'-zh-CN','state.json');
 const cachePath=statePath.replace('state.json','translation.json');
 const result={};
 select('algorithm');await wait(()=>native.textContent.includes('本地词典'),'dictionary');
 check(body().includes('算法'),'dictionary must contain Chinese definition');check(!!button('翻译此文章')&&!!button('不翻译此文章'),'initial choices');
 result.dictionary=true;button('不翻译此文章').click();await wait(async()=>await IOUtils.exists(statePath)&&(await IOUtils.readJSON(statePath)).decision==='declined','decline persistence');
 select(sourceText.split('. ')[0]+'.');await wait(()=>native.textContent.includes('本地小模型'),'offline inference');
 check(!button('不翻译此文章')&&!!button('全文翻译'),'declined corner full action');result.offlineSentence=body();
 button('重新翻译').click();await wait(()=>body().startsWith('AI重译：'),'explicit partial retranslation');
 check(!(await IOUtils.exists(cachePath)),'false retranslation must not create translation file');
 check((await IOUtils.readJSON(statePath)).translated===false,'false flag preserved');result.noPartialCache=true;
 const other=doc.createElementNS('http://www.w3.org/1999/xhtml','div');other.className='selection-popup';other.style.cssText='position:fixed;left:100px;top:100px;width:220px;height:90px;';doc.documentElement.append(other);
 const otherReader={...reader};addon.data._readerPopupHandler({reader:otherReader,doc,params:{annotation:{text:'algorithm',position:{pageIndex:0,rects:[[0,0,10,10]]}}},append:fragment=>other.append(fragment)});
 await wait(()=>Array.from(other.querySelectorAll('button')).some(element=>element.textContent==='全文翻译'),'second view');
 button('全文翻译').click();Array.from(other.querySelectorAll('button')).find(element=>element.textContent==='全文翻译')?.click();await delay(50);check((await IOUtils.readJSON(statePath)).translated===false,'background flag must stay false');
 await wait(async()=>await IOUtils.exists(statePath)&&(await IOUtils.readJSON(statePath)).translated===true,'full translation');
 const cached=await IOUtils.readJSON(cachePath);other.remove();result.concurrentViewsDeduplicated=true;check(cached.segments.length===2&&cached.terms.length===1,'full translated segments and terms');result.backgroundTrue=true;
 select('algorithm');await wait(()=>body()==='算法专用译法','specialized term');result.termPriority=true;
 select('The algorithm improves resource utilization.');await wait(()=>body()==='全文译文：The algorithm improves resource utilization.','sentence exact cache');result.sentenceCache=true;
 select('algorithm');await wait(()=>body()==='算法专用译法','term before rewrite');button('重新翻译').click();await wait(()=>body()==='AI重译：algorithm','contextual repair');
 const repaired=await IOUtils.readJSON(cachePath);check(repaired.overrides.algorithm==='AI重译：algorithm','selected override saved');check(repaired.terms[0].translation==='算法更新译法','term updated');
 check(JSON.stringify(cached.segments)===JSON.stringify(repaired.segments),'unrelated sentence translations unchanged');check((await IOUtils.readJSON(statePath)).translated,'repair keeps true');result.selectedOnlyUpdate=true;
 const pane=addon.data.sidePaneElements.pane;check(pane.getAttribute('collapsed')==='true','no auto sidebar');result.sidebarStayedCollapsed=true;
 Zotero.Prefs.set(prefix+'.toolbar.layout',JSON.stringify({order:['summarize','smartCopy','translate','explain'],visible:['summarize','smartCopy','translate']}),true);
 select('algorithm');await delay(250);const threeWidth=native.querySelector('.ai-bar-container').getBoundingClientRect().width;
 const labels=Array.from(native.querySelectorAll('button.ai-btn:not(.expand-trigger-btn)')).map(element=>element.textContent);
 check(labels.length===3,'three selected actions');native.querySelector('.expand-trigger-btn').click();await delay(30);check(native.querySelector('.model-dropdown-menu')?.textContent.includes('Explain')||native.querySelector('.model-dropdown-menu')?.textContent.includes('解释'),'hidden action in More');native.querySelector('.expand-trigger-btn').click();check(labels[0].includes('Summar')||labels[0].includes('总结'),'custom order');result.toolbarOrder=labels;
 Zotero.Prefs.set(prefix+'.toolbar.layout',JSON.stringify({visible:['explain']}),true);select('algorithm');await delay(250);check(native.querySelectorAll('button.ai-btn:not(.expand-trigger-btn)').length===3,'minimum three recovery');result.minimumThree=true;
 addon.data.userPrompts=[{id:'wide',name:'A longer custom translation review action',prompt:'Review the selected text.'}];
 Zotero.Prefs.set(prefix+'.toolbar.layout',JSON.stringify({visible:['explain','translate','smartCopy','user-wide']}),true);select('algorithm');await delay(250);const fourWidth=native.querySelector('.ai-bar-container').getBoundingClientRect().width;
 const card=native.querySelector('.floating-translation');check(Math.abs(card.getBoundingClientRect().width-native.querySelector('.ai-bar-container').getBoundingClientRect().width)<4,'translation width follows toolbar');
 check(fourWidth>threeWidth||fourWidth>=parseFloat(native.querySelector('.ai-bar-container').style.maxWidth),'width adapts to actions or viewport cap');result.widthAdaptive={threeWidth,fourWidth};
 const failed=await Zotero.Attachments.linkFromFile({file:${JSON.stringify('C:/Users/FreeSHR/Documents/claude/zotero-ai-explain-z10-compat-20261116/tests/fixtures/sample.pdf')}.replaceAll('/',String.fromCharCode(92))});Object.defineProperty(failed,'attachmentText',{configurable:true,get:()=>Promise.resolve('FAIL_CHUNK. Another sentence.')});reader.itemID=failed.id;
 select('algorithm');await wait(()=>!!button('翻译此文章'),'failure paper choices');button('翻译此文章').click();
 const failedState=PathUtils.join(PathUtils.profileDir,'zaibar','paper-translations',failed.libraryID+'-'+failed.key+'-zh-CN','state.json');
 await wait(async()=>await IOUtils.exists(failedState)&&(await IOUtils.readJSON(failedState)).status==='failed','partial output rejection');check((await IOUtils.readJSON(failedState)).translated===false,'failed remains false');result.failedPartialFalse=true;
 const resumeItem=await Zotero.Attachments.linkFromFile({file:${JSON.stringify('C:/Users/FreeSHR/Documents/claude/zotero-ai-explain-z10-compat-20261116/tests/fixtures/sample.pdf')}.replaceAll('/',String.fromCharCode(92))});
 const resumeText=Array.from({length:9},(_,i)=>'Resume batch '+i+': '+('academic source data '.repeat(50))+(i===4?' RESUME_STOP':'')+'.').join(' ');
 Object.defineProperty(resumeItem,'attachmentText',{configurable:true,get:()=>Promise.resolve(resumeText)});reader.itemID=resumeItem.id;
 select('algorithm');await wait(()=>!!button('翻译此文章'),'resume choices');button('翻译此文章').click();
 const resumeDir=PathUtils.join(PathUtils.profileDir,'zaibar','paper-translations',resumeItem.libraryID+'-'+resumeItem.key+'-zh-CN');
 const resumeState=PathUtils.join(resumeDir,'state.json'),resumeCheckpoint=PathUtils.join(resumeDir,'checkpoint.json');
 await wait(async()=>await IOUtils.exists(resumeState)&&(await IOUtils.readJSON(resumeState)).status==='failed','save partial failure');
 const progress=await IOUtils.readJSON(resumeCheckpoint);check(progress.segments.length>0&&progress.segments.length<9,'checkpoint contains only completed batch');
 check((await IOUtils.readJSON(resumeState)).completed===progress.segments.length,'saved progress matches status');
 await wait(()=>!!button('继续全文翻译'),'continue button');button('继续全文翻译').click();
 await wait(async()=>(await IOUtils.readJSON(resumeState)).translated===true,'resume completion');
 const resumed=await IOUtils.readJSON(PathUtils.join(resumeDir,'translation.json'));check(resumed.segments.length===9,'resume complete coverage');
 check(resumed.segments[0].translation===progress.segments[0].translation,'preserved translated batch');check(!await IOUtils.exists(resumeCheckpoint),'completed checkpoint cleaned');
 result.resumeSaved=progress.segments.length;result.resumeComplete=true;
 open=false;native.remove();result.pass=true;await IOUtils.writeUTF8(${JSON.stringify(resultFile)},JSON.stringify(result));
}`;
writeFileSync(join(profileDir, 'probe.js'), source);
execFileSync('python', [
  '-I',
  '-c',
  'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); run=pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"); z=zipfile.ZipFile(p); entries={n:z.read(n) for n in z.namelist()}; z.close(); text=entries["bootstrap.js"].decode(); text=text.replace("await Zotero.ZAIBar.hooks.onStartup();", "await Zotero.ZAIBar.hooks.onStartup();\\n runPaperProbe().catch(error => IOUtils.writeUTF8("+repr(sys.argv[3])+",JSON.stringify({error:String(error),stack:error.stack}))); "); entries["bootstrap.js"]=(text+"\\n"+run).encode(); z=zipfile.ZipFile(p,"w",zipfile.ZIP_DEFLATED); [z.writestr(n,d) for n,d in entries.items()]; z.close()',
  join(profileDir, 'extensions/zaibar@fukeke.com.xpi'),
  join(profileDir, 'probe.js'),
  resultFile,
]);
const handle = spawnZotero({
  binaryPath: 'C:/Program Files/Zotero/zotero.exe',
  profileDir,
  logPath: root + '/.scaffold/paper-gecko.log',
  marionettePort: 2867,
  quiet: true,
});
try {
  for (let i = 0; i < 240 && !existsSync(resultFile); i++) await new Promise((resolve) => setTimeout(resolve, 200));
  if (!existsSync(resultFile)) throw new Error('Probe timeout: ' + profileDir);
  const result = JSON.parse(readFileSync(resultFile, 'utf8'));
  const fullCalls = requests.filter((data) => data.segments && !data.segments.some((segment) => segment.source.includes('FAIL_CHUNK'))).length;
  const partial = requests.find((data) => data.selectedText && !data.fullDocument && !data.candidates);
  const repair = requests.find((data) => data.selectedText === 'algorithm' && data.fullDocument);
  const resumeRequests = requests.filter((data) => data.segments?.some((segment) => segment.source.startsWith('Resume batch')));
  const resumedSkippedCompleted =
    resumeRequests.length === 4 &&
    resumeRequests[0].segments[0].id === 0 &&
    resumeRequests.slice(1).every((data) => data.segments.every((segment) => segment.id >= result.resumeSaved));
  const output = {
    ...result,
    requestCount: requests.length,
    fullCalls,
    partialHasNoDocument: !!partial,
    repairHasFullContext: !!repair,
    resumedSkippedCompleted,
  };
  writeFileSync(root + '/.scaffold/paper-gecko-result.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
  if (!result.pass || !resumedSkippedCompleted || fullCalls !== 5 || !partial || !repair) throw new Error('Paper translation regression failed');
} finally {
  await handle.shutdown();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
