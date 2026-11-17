"""Install prepared offline resources and configure a stopped Zotero profile."""
import hashlib,json,pathlib,re,secrets,shutil
root=pathlib.Path(__file__).resolve().parents[1]
profile=pathlib.Path('C:/Users/FreeSHR/AppData/Roaming/Zotero/Zotero/Profiles/m27len26.default')
runtime=root/'.local-runtime'
assets=json.loads((runtime/'assets.json').read_text(encoding='utf-8'))
model=runtime/'model-en-zh-int8'
assert hashlib.sha256((model/'model.bin').read_bytes()).hexdigest()==assets['files']['model.bin']
python=runtime/'venv/Scripts/pythonw.exe'
assert python.exists()
target=profile/'zaibar';target.mkdir(exist_ok=True)
dictionary=target/'dictionary'
marker=dictionary/'installed.json'
installed=json.loads(marker.read_text(encoding='utf-8')) if marker.exists() else {}
if installed.get('revision')!=assets['revision']:
 shutil.copytree(runtime/'dictionary',dictionary,dirs_exist_ok=True)
 marker.write_text(json.dumps({'revision':assets['revision'],'entries':assets['entries']}),encoding='utf-8')
script=target/'local-translation-server.py';shutil.copy2(root/'scripts/local-translation-server.py',script)
runtime_token=runtime/'server-token.txt'
if not runtime_token.exists():runtime_token.write_text(secrets.token_urlsafe(32),encoding='utf-8')
token=target/'local-translation-token.txt';shutil.copy2(runtime_token,token)
(target/'offline-assets.json').write_text(json.dumps(assets,indent=2),encoding='utf-8')
prefix=json.loads((root/'package.json').read_text(encoding='utf-8'))['config']['prefsPrefix']
f=profile/'prefs.js';text=f.read_text(encoding='utf-8')
for suffix,value in {'translate.localPython':str(python),'translate.localScript':str(script),'translate.localModelDirectory':str(model),'translate.localTokenFile':str(token)}.items():
 key=prefix+'.'+suffix;pattern=r'^user_pref\('+re.escape(json.dumps(key))+r', .*\);$'
 line='user_pref('+json.dumps(key)+', '+json.dumps(value)+');'
 text=re.sub(pattern,lambda _:line,text,flags=re.M) if re.search(pattern,text,re.M) else text+'\n'+line+'\n'
f.write_text(text,encoding='utf-8')
print('Offline assets installed:',assets['entries'],'dictionary entries;',assets['modelFilesBytes'],'model bytes; CPU 2 threads; idle exit 90 seconds')
