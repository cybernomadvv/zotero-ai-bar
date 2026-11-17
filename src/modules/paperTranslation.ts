import { getItemFullText } from '../utils/itemContext';
import { getPref } from '../utils/prefs';
import { getTranslationModelKey } from '../utils/translation';
import { requestTranslationObject, streamFloatingTranslation } from './llm';
import { isLexicalSelection, lookupLocalDictionary, normalizeLookup, translateLocally } from './localTranslation';

export interface PaperState {
  translated: boolean;
  decision: 'ask' | 'approved' | 'declined';
  status: 'idle' | 'queued' | 'translating' | 'failed' | 'complete';
  completed: number;
  total: number;
  error?: string;
}
export interface PaperHandle {
  id: string;
  itemId: number;
  target: string;
  dir: string;
  state: PaperState;
}
interface Segment {
  id: number;
  source: string;
  translation: string;
}
interface Term {
  source: string;
  translation: string;
}
interface PaperCheckpoint {
  version: 1;
  target: string;
  sources: string[];
  segments: Segment[];
  terms: Term[];
}
interface PaperCache {
  version: 1;
  target: string;
  segments: Segment[];
  terms: Term[];
  overrides: Record<string, string>;
  fullTranslation: string;
}
const handles = new Map<string, Promise<PaperHandle>>();
const cacheMemory = new Map<string, PaperCache>();
const listeners = new Map<string, Set<() => void>>();
const jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>();
const metadataWrites = new Map<string, Promise<void>>();
const locks = new Map<string, Promise<void>>();
let queue: Promise<void> = Promise.resolve();

export function translationModelKey(text: string): string | undefined {
  return getTranslationModelKey({
    selectedText: text,
    useAlternativeModel: getPref('translate.useAlternativeModel'),
    useModelForWords: getPref('translate.useModelForWords'),
    modelKey: getPref('translate.modelId'),
  });
}

export async function getPaperTranslation(itemId: number, target: string): Promise<PaperHandle> {
  let item = Zotero.Items.get(itemId);
  if (!item) throw new Error('找不到当前论文');
  if (item.isRegularItem?.()) {
    const attachments = item.getAttachments?.().map((id) => Zotero.Items.get(id)) ?? [];
    item = attachments.find((attachment) => attachment.attachmentContentType === 'application/pdf') ?? attachments[0] ?? item;
  }
  const id = `${item.libraryID}-${item.key}-${target.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  if (!handles.has(id))
    handles.set(
      id,
      (async () => {
        const dir = PathUtils.join(PathUtils.profileDir, 'zaibar', 'paper-translations', id);
        const state: PaperState = { translated: false, decision: 'ask', status: 'idle', completed: 0, total: 0 };
        const handle = { id, itemId: item.id, target, dir, state };
        const file = PathUtils.join(dir, 'state.json');
        if (await IOUtils.exists(file)) {
          try {
            const saved = (await IOUtils.readJSON(file)) as PaperState;
            Object.assign(state, saved);
            state.translated = saved.translated === true;
            if (!['ask', 'approved', 'declined'].includes(state.decision)) state.decision = 'ask';
          } catch {
            state.error = '翻译状态文件损坏，可重新进行全文翻译';
          }
        }
        if (state.translated && !(await IOUtils.exists(PathUtils.join(dir, 'translation.json')))) {
          state.translated = false;
          state.status = 'failed';
          state.error = '全文翻译文件缺失，请重新翻译';
        }
        if (!state.translated && ['queued', 'translating'].includes(state.status)) {
          state.status = 'idle';
          state.error = '上次全文任务已中断，已保存的批次可以继续翻译';
        }
        if (!state.translated) {
          const checkpoint = await loadCheckpoint(handle);
          state.completed = checkpoint?.segments.length ?? 0;
          if (checkpoint) state.total = checkpoint.sources.length;
        }
        return handle;
      })().catch((error) => {
        handles.delete(id);
        throw error;
      })
    );
  return handles.get(id)!;
}
function notify(handle: PaperHandle): void {
  for (const callback of listeners.get(handle.id) ?? []) callback();
}
export function subscribePaper(handle: PaperHandle, callback: () => void): () => void {
  const set = listeners.get(handle.id) ?? new Set();
  set.add(callback);
  listeners.set(handle.id, set);
  return () => {
    set.delete(callback);
    if (!set.size) listeners.delete(handle.id);
  };
}
async function persist(handle: PaperHandle): Promise<void> {
  const snapshot = { ...handle.state };
  const previous = metadataWrites.get(handle.id) ?? Promise.resolve();
  const pending = previous
    .catch(() => {})
    .then(async () => {
      await IOUtils.makeDirectory(handle.dir, { ignoreExisting: true, createAncestors: true });
      const file = PathUtils.join(handle.dir, 'state.json');
      await IOUtils.writeJSON(file, snapshot, { tmpPath: file + '.tmp' });
      notify(handle);
    });
  metadataWrites.set(handle.id, pending);
  try {
    await pending;
  } finally {
    if (metadataWrites.get(handle.id) === pending) metadataWrites.delete(handle.id);
  }
}
export async function declinePaperTranslation(handle: PaperHandle): Promise<void> {
  jobs.get(handle.id)?.controller.abort();
  handle.state.decision = 'declined';
  if (!handle.state.translated) handle.state.status = 'idle';
  await persist(handle);
}
export async function readPaperCache(handle: PaperHandle): Promise<PaperCache | undefined> {
  if (!handle.state.translated) return undefined;
  if (cacheMemory.has(handle.id)) return cacheMemory.get(handle.id);
  try {
    const result = (await IOUtils.readJSON(PathUtils.join(handle.dir, 'translation.json'))) as PaperCache;
    if (result.version !== 1 || !Array.isArray(result.segments) || !Array.isArray(result.terms)) throw new Error('Invalid paper cache');
    cacheMemory.set(handle.id, result);
    if (cacheMemory.size > 8) cacheMemory.delete(cacheMemory.keys().next().value!);
    return result;
  } catch {
    handle.state.translated = false;
    handle.state.status = 'failed';
    handle.state.error = '全文译文文件无法读取，请重新翻译';
    await persist(handle);
    return undefined;
  }
}

export function splitPaperText(text: string): string[] {
  const parts = Array.from(new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text), (entry) => entry.segment);
  const result: string[] = [];
  for (const part of parts) {
    let rest = part.trim();
    while (rest.length > 1500) {
      const boundary = Math.max(rest.lastIndexOf(' ', 1500), rest.lastIndexOf('\n', 1500));
      const cut = boundary > 500 ? boundary : 1500;
      result.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) result.push(rest);
  }
  return result;
}
function validTerms(value: unknown, sources: string): Term[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Term =>
      typeof entry?.source === 'string' &&
      typeof entry?.translation === 'string' &&
      !!entry.source.trim() &&
      !!entry.translation.trim() &&
      normalizeLookup(sources).includes(normalizeLookup(entry.source))
  );
}

async function loadCheckpoint(handle: PaperHandle): Promise<PaperCheckpoint | undefined> {
  const file = PathUtils.join(handle.dir, 'checkpoint.json');
  if (!(await IOUtils.exists(file))) return undefined;
  try {
    const saved = (await IOUtils.readJSON(file)) as PaperCheckpoint;
    if (
      saved.version !== 1 ||
      saved.target !== handle.target ||
      !Array.isArray(saved.sources) ||
      !saved.sources.length ||
      !saved.sources.every((source) => typeof source === 'string' && !!source.trim()) ||
      !Array.isArray(saved.segments) ||
      saved.segments.length > saved.sources.length ||
      !saved.segments.every(
        (segment, id) =>
          segment.id === id && segment.source === saved.sources[id] && typeof segment.translation === 'string' && !!segment.translation.trim()
      ) ||
      !Array.isArray(saved.terms)
    )
      return undefined;
    saved.terms = validTerms(saved.terms, saved.segments.map((segment) => segment.source).join('\n'));
    return saved;
  } catch {
    return undefined;
  }
}

async function saveCheckpoint(handle: PaperHandle, sources: string[], segments: Segment[], terms: Map<string, Term>): Promise<void> {
  const file = PathUtils.join(handle.dir, 'checkpoint.json');
  const checkpoint: PaperCheckpoint = { version: 1, target: handle.target, sources, segments, terms: Array.from(terms.values()) };
  await IOUtils.writeJSON(file, checkpoint, { tmpPath: file + '.tmp' });
}

export async function pausePaperTranslation(handle: PaperHandle): Promise<void> {
  const job = jobs.get(handle.id);
  if (!job) return;
  job.controller.abort();
  await job.promise;
}

export async function startPaperTranslation(handle: PaperHandle): Promise<void> {
  const existing = jobs.get(handle.id);
  if (existing) return existing.promise;
  if (handle.state.translated) return;
  const controller = new (Zotero.getMainWindow().AbortController)();
  handle.state.decision = 'approved';
  handle.state.status = 'queued';
  handle.state.error = undefined;
  const saved = persist(handle);
  void saved.catch(() => {});
  const promise = queue
    .catch(() => {})
    .then(async () => {
      await saved;
      if (controller.signal.aborted) return;
      handle.state.status = 'translating';
      await persist(handle);
      const text = await getItemFullText(handle.itemId);
      if (!text?.trim()) throw new Error('当前附件没有可提取正文；扫描件需要先完成 OCR。');
      const units = splitPaperText(text).map((source, id) => ({ id, source }));
      const sources = units.map((unit) => unit.source);
      const checkpointFile = PathUtils.join(handle.dir, 'checkpoint.json');
      let checkpoint = await loadCheckpoint(handle);
      const matches = checkpoint && checkpoint.sources.length === sources.length && checkpoint.sources.every((source, id) => source === sources[id]);
      if (!matches && (await IOUtils.exists(checkpointFile))) {
        // Preserve the previous work separately when the source text changed or the file is invalid.
        await IOUtils.move(checkpointFile, PathUtils.join(handle.dir, `checkpoint-previous-${Date.now()}.json`));
        checkpoint = undefined;
      }
      const segments: Segment[] = checkpoint?.segments.slice() ?? [];
      const terms = new Map<string, Term>((checkpoint?.terms ?? []).map((term) => [normalizeLookup(term.source), term]));
      handle.state.total = units.length;
      handle.state.completed = segments.length;
      await persist(handle);
      let offset = segments.length;
      while (offset < units.length) {
        if (controller.signal.aborted) throw new Error('全文翻译已取消');
        const batch: typeof units = [];
        let chars = 0;
        while (offset < units.length && (chars < 3500 || !batch.length)) {
          const unit = units[offset++];
          batch.push(unit);
          chars += unit.source.length;
        }
        const result = await requestTranslationObject({
          instruction:
            'Translate every segment into targetLanguage with academic terminology. Preserve meaning, lists and math. Return {"segments":[{"id":number,"translation":string}],"terms":[{"source":string,"translation":string}]}. Include every input id exactly once. Extract only specialized terms present in the source. Keep glossary terminology consistent. Do not omit any segment.',
          data: {
            targetLanguage: handle.target,
            title: Zotero.Items.get(handle.itemId)?.getDisplayTitle?.(),
            segments: batch,
            glossary: Array.from(terms.values()).slice(-120),
          },
          modelKey: translationModelKey(batch.map((unit) => unit.source).join('\n')),
          signal: controller.signal,
        });
        if (!Array.isArray(result.segments) || result.segments.length !== batch.length) throw new Error('全文翻译返回了不完整的段落，状态保持 false');
        const seen = new Set<number>();
        const completedBatch: Segment[] = [];
        for (const unit of batch) {
          const output = result.segments.filter((entry: any) => entry.id === unit.id);
          if (output.length !== 1 || typeof output[0].translation !== 'string' || !output[0].translation.trim() || seen.has(unit.id))
            throw new Error('全文译文缺少有效段落');
          seen.add(unit.id);
          completedBatch.push({ ...unit, translation: output[0].translation.trim() });
        }
        segments.push(...completedBatch);
        for (const term of validTerms(result.terms, batch.map((unit) => unit.source).join('\n'))) terms.set(normalizeLookup(term.source), term);
        // Commit the actual work before reporting progress. A crash between these
        // writes is recovered from checkpoint.json rather than the older status.
        await saveCheckpoint(handle, sources, segments, terms);
        handle.state.completed = segments.length;
        await persist(handle);
        // Yield between batches so a foreground selection can use the provider too.
        await new Promise<void>((resolve) => Zotero.getMainWindow().setTimeout(resolve, 150));
      }
      if (controller.signal.aborted) throw new Error('全文翻译已取消');
      const cache: PaperCache = {
        version: 1,
        target: handle.target,
        segments,
        terms: Array.from(terms.values()),
        overrides: {},
        fullTranslation: segments.map((unit) => unit.translation).join('\n\n'),
      };
      const file = PathUtils.join(handle.dir, 'translation.json');
      await IOUtils.writeJSON(file, cache, { tmpPath: file + '.tmp' });
      cacheMemory.set(handle.id, cache);
      handle.state.translated = true;
      handle.state.status = 'complete';
      await persist(handle);
      // If finalization is interrupted, the complete checkpoint can finalize on
      // the next attempt without submitting any of these segments again.
      try {
        await IOUtils.remove(checkpointFile, { ignoreAbsent: true });
      } catch {
        /* Completed translation is already durable. */
      }
    })
    .catch(async (error) => {
      handle.state.translated = false;
      handle.state.status = controller.signal.aborted ? 'idle' : 'failed';
      const committed = await loadCheckpoint(handle);
      handle.state.completed = committed?.segments.length ?? 0;
      if (committed) handle.state.total = committed.sources.length;
      handle.state.error = controller.signal.aborted ? undefined : String(error instanceof Error ? error.message : error);
      await persist(handle);
    })
    .finally(() => {
      jobs.delete(handle.id);
      notify(handle);
    });
  jobs.set(handle.id, { controller, promise });
  queue = promise;
  return promise;
}
export async function stopPaperTranslations(): Promise<void> {
  for (const job of jobs.values()) job.controller.abort();
  await Promise.all(Array.from(jobs.values(), (job) => job.promise));
  await Promise.all(Array.from(metadataWrites.values()));
  listeners.clear();
  cacheMemory.clear();
  handles.clear();
}

function candidates(cache: PaperCache, text: string): Segment[] {
  const words = new Set(normalizeLookup(text).split(/\s+/));
  return cache.segments
    .map((segment) => {
      const tokens = new Set(normalizeLookup(segment.source).split(/\s+/));
      const common = [...words].filter((word) => tokens.has(word)).length;
      return { segment, score: common / Math.max(words.size, tokens.size) };
    })
    .filter((entry) => entry.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => entry.segment);
}
export async function translateSelection(params: {
  handle: PaperHandle;
  text: string;
  context?: string[];
  contextPromise?: Promise<string[] | undefined>;
  signal: AbortSignal;
  onText: (text: string, source: string) => void;
}): Promise<void> {
  const { handle, text, context, signal, onText } = params;
  const normalized = normalizeLookup(text);
  const cache = await readPaperCache(handle);
  if (cache) {
    const saved =
      cache.overrides?.[normalized] ??
      cache.terms.find((term) => normalizeLookup(term.source) === normalized)?.translation ??
      cache.segments.find((segment) => normalizeLookup(segment.source) === normalized)?.translation;
    if (saved) {
      onText(saved, '论文译文／术语');
      return;
    }
  }
  if (isLexicalSelection(text)) {
    const dictionary = await lookupLocalDictionary(text, handle.target);
    if (dictionary) {
      onText(dictionary, '本地词典');
      return;
    }
  } else if (cache) {
    const matches = candidates(cache, text);
    if (matches.length) {
      try {
        const match = await requestTranslationObject({
          instruction:
            'Match selectedText to one existing source candidate despite PDF linebreak/OCR differences. Do NOT translate or rewrite. Return {"id":number|null}; null means no confident equivalent. Only choose a provided id whose complete meaning equals the selection.',
          data: { selectedText: text, candidates: matches.map(({ id, source }) => ({ id, source })) },
          modelKey: translationModelKey(text),
          signal,
        });
        const found = matches.find((entry) => entry.id === match.id);
        if (found) {
          onText(found.translation, '已有译文 · AI 匹配');
          return;
        }
      } catch (error) {
        if (signal.aborted) throw error;
        // A matching-service failure must not prevent offline translation.
      }
    }
  }
  try {
    const local = await translateLocally(text, handle.target, context, signal);
    onText(local, '本地小模型 · 基础译文');
  } catch (error) {
    if (signal.aborted) return;
    if (handle.state.translated || handle.state.decision === 'declined')
      throw new Error(`本地翻译未完成：${error instanceof Error ? error.message : String(error)}。可点击“重新翻译”调用 AI。`, { cause: error });
    const remoteContext = context ?? (await params.contextPromise);
    if (signal.aborted) return;
    await streamFloatingTranslation({
      selectedText: text,
      targetLanguage: handle.target,
      context: remoteContext,
      modelKey: translationModelKey(text),
      chatEffort: 'none',
      signal,
      onText: (translation) => onText(translation, 'AI 即时翻译 · 全文仍为 false'),
    });
  }
}

/** Explicit AI repair; incomplete papers never persist a selected-text cache. */
export async function retranslateSelection(handle: PaperHandle, text: string, context: string[] | undefined, signal: AbortSignal): Promise<string> {
  const cache = await readPaperCache(handle);
  const result = await requestTranslationObject({
    instruction:
      'Professionally translate ONLY selectedText into targetLanguage using the supplied document and surrounding context. Do not translate the rest of the document. Return {"translation":string,"terms":[{"source":string,"translation":string}]}; extract only terms within selectedText.',
    data: {
      targetLanguage: handle.target,
      selectedText: text,
      surroundingContext: context ?? [],
      fullDocument: cache?.segments.map((segment) => segment.source).join('\n\n'),
    },
    modelKey: translationModelKey(text),
    signal,
  });
  if (typeof result.translation !== 'string' || !result.translation.trim()) throw new Error('AI 未返回有效译文');
  const translation = result.translation.trim();
  if (cache && handle.state.translated) {
    const prior = locks.get(handle.id) ?? Promise.resolve();
    const pending = prior
      .catch(() => {})
      .then(async () => {
        if (signal.aborted) return;
        const latest = await readPaperCache(handle);
        if (!latest) return;
        const updated = JSON.parse(JSON.stringify(latest)) as PaperCache;
        const key = normalizeLookup(text);
        updated.overrides[key] = translation;
        for (const segment of updated.segments) if (normalizeLookup(segment.source) === key) segment.translation = translation;
        const terms = new Map(updated.terms.map((term) => [normalizeLookup(term.source), term]));
        for (const term of validTerms(result.terms, text)) terms.set(normalizeLookup(term.source), term);
        updated.terms = Array.from(terms.values());
        updated.fullTranslation = updated.segments.map((segment) => segment.translation).join('\n\n');
        const file = PathUtils.join(handle.dir, 'translation.json');
        await IOUtils.writeJSON(file, updated, { tmpPath: file + '.tmp' });
        cacheMemory.set(handle.id, updated);
        notify(handle);
      });
    locks.set(handle.id, pending);
    try {
      await pending;
    } finally {
      if (locks.get(handle.id) === pending) locks.delete(handle.id);
    }
  }
  return translation;
}
