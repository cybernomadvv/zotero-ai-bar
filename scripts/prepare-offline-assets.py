"""Prepare an offline ECDICT index and a pinned INT8 Marian translation model."""
import concurrent.futures, csv, hashlib, io, json, pathlib, re, unicodedata, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]/'.local-runtime'
ROOT.mkdir(exist_ok=True)
def fetch(url):
 return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'ZoteroAIBar-local-assets/1.0'}),timeout=120).read()
def save(url,path,sha=None):
 if path.exists() and (not sha or hashlib.sha256(path.read_bytes()).hexdigest()==sha): return
 data=fetch(url)
 if sha and hashlib.sha256(data).hexdigest()!=sha: raise RuntimeError('Asset hash mismatch: '+path.name)
 path.parent.mkdir(parents=True,exist_ok=True); temp=path.with_suffix(path.suffix+'.part');temp.write_bytes(data);temp.replace(path)
revision='d45e5f86313be8e29629dda5f01ec98eba26e947'
repo='manancode/opus-mt-en-zh-ctranslate2-android'
metadata=json.loads(fetch('https://huggingface.co/api/models/'+repo+'/revision/'+revision+'?blobs=true'))
model=ROOT/'model-en-zh-int8';model.mkdir(exist_ok=True)
files=['model.bin','source.spm','target.spm','shared_vocabulary.json','config.json','README.md']
def asset(name):
 entry=next(f for f in metadata['siblings'] if f['rfilename']==name)
 save(f'https://huggingface.co/{repo}/resolve/{revision}/{name}',model/name,(entry.get('lfs') or {}).get('sha256'))
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(asset,files))
save('https://huggingface.co/Helsinki-NLP/opus-mt-en-zh/raw/main/README.md',model/'UPSTREAM-MODEL.md')
save('https://www.apache.org/licenses/LICENSE-2.0.txt',model/'LICENSE.txt')
commit=json.loads(fetch('https://api.github.com/repos/skywind3000/ECDICT/commits/master'))['sha']
dictionary=ROOT/'dictionary';dictionary.mkdir(exist_ok=True)
save(f'https://raw.githubusercontent.com/skywind3000/ECDICT/{commit}/LICENSE',dictionary/'LICENSE.txt')
raw=fetch(f'https://raw.githubusercontent.com/skywind3000/ECDICT/{commit}/ecdict.csv')
shards={};count=0
for row in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))):
 word=re.sub(r'\s+',' ',unicodedata.normalize('NFKC',row['word']).replace('’',"'").strip().lower())
 translation=row.get('translation') or row.get('definition')
 if not word or not translation:continue
 shard='-'.join(format(ord(c),'x') for c in word[:2])
 shards.setdefault(shard,{})[word]=translation;count+=1
for key,entries in shards.items():(dictionary/(key+'.json')).write_text(json.dumps(entries,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
info={'dictionary':'ECDICT','revision':commit,'entries':count,'shards':len(shards),'license':'MIT','model':repo,'modelRevision':revision,'modelFilesBytes':sum(p.stat().st_size for p in model.iterdir()),'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in model.iterdir()}}
(ROOT/'assets.json').write_text(json.dumps(info,indent=2),encoding='utf-8')
print(json.dumps(info))
