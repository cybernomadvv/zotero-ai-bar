"""Loopback-only INT8 OPUS-MT server. Exits after 90 idle seconds to release RAM."""
import argparse, gc, hmac, json, os, pathlib, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser=argparse.ArgumentParser()
parser.add_argument('--model',required=True)
parser.add_argument('--token-file',required=True)
parser.add_argument('--port',type=int,default=17824)
parser.add_argument('--idle-seconds',type=int,default=90)
args=parser.parse_args()
token=pathlib.Path(args.token_file).read_text(encoding='utf-8').strip()
lock=threading.Lock(); translator=None; sp_source=None; sp_target=None; last_use=time.monotonic(); busy=False

def translate(text,target):
 global translator,sp_source,sp_target,last_use,busy
 with lock:
  busy=True;last_use=time.monotonic()
  try:
   if translator is None:
    import ctranslate2,sentencepiece
    translator=ctranslate2.Translator(args.model,device='cpu',compute_type='int8',inter_threads=1,intra_threads=2)
    sp_source=sentencepiece.SentencePieceProcessor(model_file=str(pathlib.Path(args.model)/'source.spm'))
    sp_target=sentencepiece.SentencePieceProcessor(model_file=str(pathlib.Path(args.model)/'target.spm'))
   words=text.split();parts=[' '.join(words[i:i+100]) for i in range(0,len(words),100)]
   if not parts:return ''
   tag='>>cmn_Hant<<' if any(code in target.lower() for code in ['tw','hk','hant']) else '>>cmn_Hans<<'
   encoded=[[tag]+sp_source.encode(part,out_type=str) for part in parts]
   results=translator.translate_batch(encoded,beam_size=3,max_decoding_length=384,repetition_penalty=1.1,no_repeat_ngram_size=3)
   return '\n'.join(sp_target.decode(result.hypotheses[0]) for result in results)
  finally:busy=False;last_use=time.monotonic()

class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def reply(self,status,data):
  encoded=json.dumps(data,ensure_ascii=False).encode('utf-8');self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(encoded)));self.end_headers()
  try:self.wfile.write(encoded)
  except (BrokenPipeError,ConnectionResetError):pass
 def do_GET(self):
  if self.path=='/health':self.reply(200,{'service':'zaibar-opus-mt','pid':os.getpid(),'loaded':translator is not None,'threads':2,'precision':'int8','idleSeconds':args.idle_seconds})
  else:self.reply(404,{'error':'Not found'})
 def do_POST(self):
  if self.path!='/translate':self.reply(404,{'error':'Not found'});return
  if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):self.reply(401,{'error':'Unauthorized'});return
  try:
   length=int(self.headers.get('Content-Length','0'))
   if length<=0 or length>65536:self.reply(413,{'error':'Selection too large'});return
   data=json.loads(self.rfile.read(length))
   if not str(data.get('targetLanguage','zh-CN')).lower().startswith('zh'):self.reply(400,{'error':'Local model supports English to Chinese only'});return
   text=data.get('text')
   if not isinstance(text,str) or not text.strip():self.reply(400,{'error':'No selected text'});return
   if len(text)>10000:self.reply(413,{'error':'Select at most 10000 characters for local translation'});return
   result=translate(text,str(data.get('targetLanguage','zh-CN')))
   self.reply(200,{'translation':result,'model':'OPUS-MT en-zh INT8','source':'local'})
  except Exception as error:self.reply(500,{'error':str(error)})
server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
server.daemon_threads=True

def idle_exit():
 while True:
  time.sleep(5)
  if not busy and time.monotonic()-last_use>args.idle_seconds:
   server.shutdown();return
threading.Thread(target=idle_exit,daemon=True).start()
try:server.serve_forever(poll_interval=.5)
finally:server.server_close();translator=None;gc.collect()
