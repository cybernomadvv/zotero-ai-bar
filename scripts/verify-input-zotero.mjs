/* global console, setTimeout */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { createProfile, spawnZotero } from 'file:///C:/Users/FreeSHR/Documents/claude/zotero-ai-explain-z10-compat-20261116/scripts/zotero-e2e/launch.mjs';
const root = process.cwd();
const profileDir = createProfile({ extraPrefs: { 'extensions.startupScanScopes': 15, 'extensions.zotero.${addonRef}.sidepane.collapsed': false } });
mkdirSync(join(profileDir, 'zaibar'), { recursive: true });
const packagePath = join(profileDir, 'extensions/zaibar@fukeke.com.xpi');
copyFileSync(join(root, '.scaffold/build/zotero-ai-bar.xpi'), packagePath);
const resultFile = join(profileDir, 'input-result.json');
const source = `async function runInputProbe(){
 await Zotero.initializationPromise;await Zotero.uiReadyPromise;
 const win=Zotero.getMainWindow(),doc=win.document,delay=ms=>new Promise(resolve=>win.setTimeout(resolve,ms));
 const check=(condition,label)=>{if(!condition)throw new Error(label);};
 const wait=async(fn,label)=>{for(let i=0;i<150;i++){if(await fn())return;await delay(100);}throw new Error('Timeout: '+label);};
 await wait(()=>Zotero.ZAIBar?.data.initialized,'plugin startup');
 const addon=Zotero.ZAIBar;
 const item=await Zotero.Attachments.linkFromFile({file:'C:/Users/FreeSHR/Documents/claude/zotero-ai-explain-z10-compat-20261116/tests/fixtures/sample.pdf'.replaceAll('/',String.fromCharCode(92))});
 await Zotero.Reader.open(item.id);
 const findInput=()=>Array.from(doc.querySelectorAll('*')).map(el=>el.shadowRoot?.querySelector('textarea:not([aria-hidden="true"])')).find(el=>el&&el.getBoundingClientRect().width>0);
 await wait(findInput,'sidebar input');
 const input=findInput(),wrapper=input.closest('.input-area-wrapper'),root=input.getRootNode();
 await delay(200);
 input.focus();check(root.activeElement===input,'focused textarea');
 const before=input.getBoundingClientRect(),heightBefore=input.style.height;
 let sends=0;const original=addon.chatManager.sendChatRequest;addon.chatManager.sendChatRequest=async()=>{sends++;};
 try{
  input.dispatchEvent(new win.CompositionEvent('compositionstart',{bubbles:true,data:''}));
  for(const text of ['n','ni','你好']){
   input.value=text;input.dispatchEvent(new win.InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:text,isComposing:true}));
   check(input.style.height===heightBefore,'composition must not resize focused input');
   const rect=input.getBoundingClientRect();check(Math.abs(rect.x-before.x)<1&&Math.abs(rect.y-before.y)<1,'composition moved input');
   check(root.activeElement===input,'composition lost focus');
   await delay(20);
  }
  const imeEnter=new win.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});
  input.dispatchEvent(imeEnter);check(!imeEnter.defaultPrevented&&sends===0,'IME Enter sent message');
  input.dispatchEvent(new win.CompositionEvent('compositionend',{bubbles:true,data:'你好'}));
  await delay(40);check(input.value==='你好','composition text lost');
  const stableHeight=input.getBoundingClientRect().height;
  input.value=Array.from({length:12},()=> 'A paragraph to wrap inside the sidebar input.').join(String.fromCharCode(10));
  input.dispatchEvent(new win.InputEvent('input',{bubbles:true,inputType:'insertText'}));
  await delay(30);const grown=input.getBoundingClientRect().height;
  check(grown>stableHeight&&grown<=114,'multiline height limit');
  input.value='short';input.dispatchEvent(new win.InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
  await delay(30);check(input.getBoundingClientRect().height<grown,'input did not shrink');
  const measure=wrapper.querySelector('textarea[aria-hidden="true"]');check(measure&&win.getComputedStyle(measure).visibility==='hidden'&&measure.inert,'measurement editor can paint or focus');
  const legacyEnter=new win.KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true,cancelable:true});input.dispatchEvent(legacyEnter);check(sends===0&&!legacyEnter.defaultPrevented,'legacy IME Enter sent');
  const shiftEnter=new win.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true});input.dispatchEvent(shiftEnter);check(!shiftEnter.defaultPrevented&&sends===0,'Shift+Enter blocked');
  input.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await wait(()=>sends===1,'normal Enter sends');
  await IOUtils.writeUTF8(${JSON.stringify(resultFile)},JSON.stringify({pass:true,compositionStable:true,focusPreserved:true,imeEnterNotSent:true,legacyImeEnterNotSent:true,normalEnterSends:true,shiftEnterPreserved:true,multilineGrowsAndShrinks:true,measurementHidden:true,initialRect:{x:before.x,y:before.y,width:before.width,height:before.height},multilineHeight:grown}));
 }finally{addon.chatManager.sendChatRequest=original;}
}`;
writeFileSync(join(profileDir, 'probe.js'), source);
execFileSync('python', ['-I', '-c', 'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); run=pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"); z=zipfile.ZipFile(p); entries={n:z.read(n) for n in z.namelist()}; z.close(); text=entries["bootstrap.js"].decode(); text=text.replace("await Zotero.ZAIBar.hooks.onStartup();", "await Zotero.ZAIBar.hooks.onStartup();"+chr(10)+"runInputProbe().catch(error => IOUtils.writeUTF8("+repr(sys.argv[3])+",JSON.stringify({error:String(error),stack:error.stack}))); "); entries["bootstrap.js"]=(text+chr(10)+run).encode(); z=zipfile.ZipFile(p,"w",zipfile.ZIP_DEFLATED); [z.writestr(n,d) for n,d in entries.items()]; z.close()', packagePath, join(profileDir, 'probe.js'), resultFile]);
const handle = spawnZotero({ binaryPath: 'C:/Program Files/Zotero/zotero.exe', profileDir, logPath: join(root, '.scaffold/input-gecko.log'), marionettePort: 2871, quiet: true });
try {
  for (let i = 0; i < 300 && !existsSync(resultFile); i++) await new Promise((resolve) => setTimeout(resolve, 200));
  if (!existsSync(resultFile)) throw new Error('Input probe timeout: ' + profileDir);
  const result = JSON.parse(readFileSync(resultFile, 'utf8'));
  console.log(JSON.stringify(result));
  if (!result.pass) throw new Error('Native input regression failed');
} finally {
  await handle.shutdown();
}
