/* global console, setTimeout */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  createProfile,
  spawnZotero,
} from 'file:///C:/Users/FreeSHR/Documents/claude/zotero-ai-explain-z10-compat-20261116/scripts/zotero-e2e/launch.mjs';

const root = 'C:/Users/FreeSHR/Documents/claude/zotero-ai-bar-custom';
const requests = [];
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const data of req) raw += data;
  const body = JSON.parse(raw);
  requests.push(body);
  const source = JSON.parse(body.messages.at(-1).content).selectedText;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (text, finish = null) =>
    `data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] })}\n\n`;
  res.write(chunk('译文：'));
  setTimeout(() => {
    if (!res.destroyed) {
      res.write(chunk(source));
      res.write(chunk('', 'stop'));
      res.end('data: [DONE]\n\n');
    }
  }, 180);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
const profileDir = createProfile({
  extraPrefs: {
    'extensions.startupScanScopes': 15,
    'extensions.zotero.${addonRef}.sidepane.collapsed': true,
    'extensions.zotero.${addonRef}.extend-selection-context': false,
    'extensions.zotero.${addonRef}.translate.enableAuto': true,
    'extensions.zotero.${addonRef}.translate.thinkingDepth': 'low',
    'extensions.zotero.${addonRef}.translate.serviceTier': 'priority',
  },
});
const resultFile = join(profileDir, 'floating-result.json');
copyFileSync(`${root}/.scaffold/build/zotero-ai-bar.xpi`, join(profileDir, 'extensions/zaibar@fukeke.com.xpi'));
const probeDir = join(profileDir, 'probe-source');
mkdirSync(probeDir);
writeFileSync(
  join(probeDir, 'manifest.json'),
  JSON.stringify({
    manifest_version: 2,
    name: 'Local floating translation probe',
    version: '1.0',
    applications: { zotero: { id: 'floating-probe@local', strict_min_version: '6.999', strict_max_version: '11.*' } },
  })
);
writeFileSync(
  join(probeDir, 'bootstrap.js'),
  `
function install() {} function uninstall() {} function shutdown() {}
function startup() { run().catch(error => IOUtils.writeUTF8(${JSON.stringify(resultFile)}, JSON.stringify({error:String(error),stack:error.stack}))); }
async function run() {
 await Zotero.initializationPromise; await Zotero.uiReadyPromise;
 const win=Zotero.getMainWindow(), doc=win.document;
 const delay=ms=>new Promise(resolve=>win.setTimeout(resolve,ms));
 for(let i=0;i<150&&!Zotero.ZAIBar?.data.initialized;i++)await delay(100);
 const addon=Zotero.ZAIBar; if(!addon?.data.initialized)throw new Error('AI Bar failed to initialize');
 const provider=${JSON.stringify(JSON.parse(readFileSync(`${root}/addon/content/common_providers.min.json`, 'utf8')).magpie)};
 provider.api=${JSON.stringify(baseURL)};
 addon.data.commonProviders={...(addon.data.commonProviders||{}),magpie:provider};
 addon.data.userProviderConfigV2={active:{providerId:'magpie',modelId:'codex/gpt-6.1-sol#fast'},env:{magpie:{MAGPIE_API_KEY:'local-test'}},recentUsed:[],addedProviders:{magpie:provider},addedModels:Object.values(provider.models).map(m=>({...m,providerId:'magpie',enabled:true}))};
 const pane=addon.data.sidePaneElements.pane;
 const initialWidth=pane.getBoundingClientRect().width;
 const historyCount=()=>Array.from(addon.chatManager.sessionsMap.values()).reduce((n,s)=>n+s.persistedTurns.length,0);
 const initialHistory=historyCount();
 let calls=0; const original=addon.chatManager.sendChatRequest;
 addon.chatManager.sendChatRequest=async()=>{calls++;};
 const create=tag=>doc.createElementNS('http://www.w3.org/1999/xhtml',tag);
 const host=create('div');host.className='selection-popup';host.style.cssText='position:fixed;left:200px;top:200px;width:220px;height:100px;';doc.documentElement.append(host);
 let open=true;
 const reader={tabID:'probe-reader',_internalReader:{_type:'pdf',getSelectionPosition:()=>open?{}:null}};
 const select=text=>{
  host.replaceChildren();
  addon.data._readerPopupHandler({reader,doc,params:{annotation:{text,position:{pageIndex:0,rects:[[0,0,10,10]]}}},append:fragment=>host.append(fragment)});
 };
 try{
  select('source one'); await delay(1100);
  const first=host.querySelector('.floating-translation')?.textContent;
  select('source one');await delay(450);
  const reused=host.querySelector('.floating-translation')?.textContent;
  select('old selection');await delay(350);select('new selection');await delay(1100);
  const latest=host.querySelector('.floating-translation')?.textContent;
  Zotero.Prefs.set('extensions.zotero.\${addonRef}.translate.serviceTier','default',true);
  Zotero.Prefs.set('extensions.zotero.\${addonRef}.translate.thinkingDepth','high',true);
  select('default speed');await delay(1100);
  const settingsOverride=host.querySelector('.floating-translation')?.textContent==='译文：default speed';
  Zotero.Prefs.set('extensions.zotero.\${addonRef}.translate.enableAuto',false,true);
  select('disabled');await delay(450);
  const disabled=!host.querySelector('.floating-translation');
  const collapsed=pane.getAttribute('collapsed')==='true'&&pane.getBoundingClientRect().width===initialWidth;
  const automaticChatCalls=calls;
  const historyUnchanged=historyCount()===initialHistory;
  host.querySelector('.model-info-container').click();await delay(30);
  const menuNoIcons=!host.querySelector('.model-dropdown-icon,.model-dropdown-icon-holder');
  host.querySelector('button.ai-btn').click();await delay(30);
  const explicitChatCalls=calls;
  const lineIcon=win.getComputedStyle(doc.getElementById('zaibar-tb-sidepane-toggle')).backgroundImage.includes('toolbar-line.svg');
  const result={first,reused,latest,settingsOverride,disabled,collapsed,automaticChatCalls,explicitChatCalls,historyUnchanged,menuNoIcons,lineIcon,
   pass:first==='译文：source one'&&reused===first&&latest==='译文：new selection'&&settingsOverride&&disabled&&collapsed&&automaticChatCalls===0&&explicitChatCalls===1&&historyUnchanged&&menuNoIcons&&lineIcon};
  await IOUtils.writeUTF8(${JSON.stringify(resultFile)},JSON.stringify(result));
 }finally{addon.chatManager.sendChatRequest=original;open=false;host.remove();}
}
`
);
execFileSync('python', [
  '-I',
  '-c',
  'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); probe=pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"); run=probe[probe.index("async function run() {"):]; z=zipfile.ZipFile(p); entries={n:z.read(n) for n in z.namelist()}; z.close(); text=entries["bootstrap.js"].decode(); text=text.replace("await Zotero.ZAIBar.hooks.onStartup();", "await Zotero.ZAIBar.hooks.onStartup();\\n run().catch(error => IOUtils.writeUTF8("+repr(sys.argv[3])+", JSON.stringify({error:String(error), stack:error.stack}))); "); entries["bootstrap.js"]=(text+"\\n"+run).encode(); z=zipfile.ZipFile(p,"w",zipfile.ZIP_DEFLATED); [z.writestr(n,d) for n,d in entries.items()]; z.close()',
  join(profileDir, 'extensions/zaibar@fukeke.com.xpi'),
  join(probeDir, 'bootstrap.js'),
  resultFile,
]);
const handle = spawnZotero({
  binaryPath: 'C:/Program Files/Zotero/zotero.exe',
  profileDir,
  logPath: `${root}/.scaffold/floating-gecko.log`,
  marionettePort: 2867,
  quiet: true,
});
try {
  for (let i = 0; i < 180 && !existsSync(resultFile); i++) await new Promise((resolve) => setTimeout(resolve, 200));
  if (!existsSync(resultFile)) throw new Error(`Probe timed out; profile: ${profileDir}`);
  const result = JSON.parse(readFileSync(resultFile, 'utf8'));
  const payloadsCorrect =
    requests.length === 4 &&
    requests.every(
      (request, index) =>
        request.model === 'codex/gpt-6.1-sol' &&
        request.service_tier === (index === 3 ? 'default' : 'priority') &&
        request.reasoning_effort === (index === 3 ? 'high' : 'low') &&
        request.messages.length === 2
    );
  const output = { ...result, requestCount: requests.length, payloadsCorrect };
  console.log(JSON.stringify(output));
  writeFileSync(`${root}/.scaffold/floating-gecko-result.json`, JSON.stringify(output, null, 2));
  if (!result.pass || !payloadsCorrect) throw new Error('Floating translation regression failed');
} finally {
  await handle.shutdown();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
