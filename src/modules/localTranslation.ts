import { getPref } from '../utils/prefs';

export function normalizeLookup(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/-\s*\n\s*/g, '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isLexicalSelection(text: string): boolean {
  const normalized = text.trim();
  return !/[\n!?。！？;]/u.test(normalized) && !/\.\s|\.$/u.test(normalized) && normalized.split(/\s+/u).length <= 5;
}

const shards = new Map<string, Record<string, string>>();
export async function lookupLocalDictionary(text: string, target: string): Promise<string | undefined> {
  if (!/^zh/i.test(target)) return undefined;
  const word = normalizeLookup(text);
  const variants = [word];
  if (!word.includes(' ')) {
    if (word.endsWith('ies')) variants.push(word.slice(0, -3) + 'y');
    if (word.endsWith('s')) variants.push(word.slice(0, -1));
    if (word.endsWith('ed')) variants.push(word.slice(0, -2), word.slice(0, -1));
    if (word.endsWith('ing')) variants.push(word.slice(0, -3), word.slice(0, -3) + 'e');
  }
  for (const variant of variants) {
    const shard = Array.from(variant)
      .slice(0, 2)
      .map((char) => char.codePointAt(0)!.toString(16))
      .join('-');
    let entries = shards.get(shard);
    if (!entries) {
      try {
        entries = (await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, 'zaibar', 'dictionary', shard + '.json'))) as Record<string, string>;
        shards.set(shard, entries);
        if (shards.size > 12) shards.delete(shards.keys().next().value!);
      } catch {
        continue;
      }
    }
    if (entries[variant]) return entries[variant].replace(/\\n/g, '\n');
  }
  return undefined;
}

let runtimeStartup: Promise<void> | undefined;
async function localRuntimeHealthy(): Promise<boolean> {
  const view = Zotero.getMainWindow();
  const controller = new view.AbortController();
  const timer = view.setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch('http://127.0.0.1:17824/health', { signal: controller.signal });
    if (!response.ok) return false;
    const health = (await response.json()) as { service?: string };
    return health.service === 'zaibar-opus-mt';
  } catch {
    return false;
  } finally {
    view.clearTimeout(timer);
  }
}
async function ensureLocalRuntime(): Promise<void> {
  if (await localRuntimeHealthy()) return;
  if (!runtimeStartup)
    runtimeStartup = (async () => {
      const python = getPref('translate.localPython');
      const script = getPref('translate.localScript');
      const model = getPref('translate.localModelDirectory');
      const tokenFile = getPref('translate.localTokenFile');
      if (!python || !script || !model || !tokenFile) throw new Error('轻量本地翻译资源尚未安装');
      const executable = (Components.classes as any)['@mozilla.org/file/local;1'].createInstance(Components.interfaces.nsIFile);
      executable.initWithPath(Zotero.isWin ? python.replace(/\//g, '\\') : python);
      const process = (Components.classes as any)['@mozilla.org/process/util;1'].createInstance(Components.interfaces.nsIProcess);
      process.init(executable);
      const args = ['-I', script, '--model', model, '--token-file', tokenFile];
      process.runwAsync(args, args.length, null, false);
      for (let i = 0; i < 50; i++) {
        if (await localRuntimeHealthy()) return;
        await new Promise<void>((resolve) => Zotero.getMainWindow().setTimeout(resolve, 100));
      }
      throw new Error('轻量本地翻译服务启动失败');
    })().finally(() => {
      runtimeStartup = undefined;
    });
  await runtimeStartup;
}

/** CPU-only Marian INT8. The process exits after 90 idle seconds. */
export async function translateLocally(text: string, target: string, _context: string[] | undefined, signal: AbortSignal): Promise<string> {
  if (!/^zh/i.test(target)) throw new Error('本地小模型当前支持英译中');
  await ensureLocalRuntime();
  if (signal.aborted) throw new Error('已取消');
  const tokenPath = getPref('translate.localTokenFile');
  const token = (await IOUtils.readUTF8(Zotero.isWin ? tokenPath.replace(/\//g, '\\') : tokenPath)).trim();
  const response = await fetch('http://127.0.0.1:17824/translate', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ text, targetLanguage: target }),
  });
  const result = (await response.json()) as { translation?: string; error?: string };
  if (!response.ok || !result.translation?.trim()) throw new Error(result.error || '本地翻译服务未返回译文');
  return result.translation.trim();
}
