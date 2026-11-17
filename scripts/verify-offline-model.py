"""Real CPU inference + Windows working set measurement for the offline model."""
import json,pathlib,secrets,subprocess,time,urllib.request
root=pathlib.Path(__file__).resolve().parents[1]
assets=root/'.local-runtime';token_file=assets/'server-token.txt'
if not token_file.exists():token_file.write_text(secrets.token_urlsafe(32),encoding='utf-8')
token=token_file.read_text().strip()
log=(assets/'model-smoke.log').open('wb')
proc=subprocess.Popen([str(assets/'venv/Scripts/python.exe'),'-I',str(root/'scripts/local-translation-server.py'),'--model',str(assets/'model-en-zh-int8'),'--token-file',str(token_file),'--port','17825','--idle-seconds','5'],stdout=log,stderr=subprocess.STDOUT)
try:
 for _ in range(60):
  try:urllib.request.urlopen('http://127.0.0.1:17825/health',timeout=1);break
  except Exception:time.sleep(.1)
 started=time.perf_counter()
 request=urllib.request.Request('http://127.0.0.1:17825/translate',data=json.dumps({'text':'The proposed scheduling algorithm improves resource utilization.','targetLanguage':'zh-CN'}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
 result=json.load(urllib.request.urlopen(request,timeout=45))
 elapsed=time.perf_counter()-started
 health=json.load(urllib.request.urlopen('http://127.0.0.1:17825/health',timeout=2))
 server_pid=health['pid']
 query=subprocess.run(['powershell.exe','-NoProfile','-Command',f'Get-Process -Id {server_pid} | Select-Object WorkingSet64,PeakWorkingSet64,CPU | ConvertTo-Json -Compress'],capture_output=True,text=True,check=True)
 memory=json.loads(query.stdout)
 assert any('\u4e00'<=c<='\u9fff' for c in result.get('translation',''))
 proc.wait(timeout=15)
 report={'model':'OPUS-MT en-zh INT8','translation':result['translation'],'coldSeconds':round(elapsed,3),'workingSetMiB':round(memory['WorkingSet64']/1048576,1),'peakWorkingSetMiB':round(memory['PeakWorkingSet64']/1048576,1),'idleAutoExit':proc.returncode==0,'modelBytes':sum(p.stat().st_size for p in (assets/'model-en-zh-int8').iterdir())}
 (assets/'model-smoke-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=True))
finally:
 if proc.poll() is None:proc.terminate();proc.wait(timeout=5)
 log.close()
