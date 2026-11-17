import { getPref } from '../utils/prefs';
import { bindPaperControls, disposePaperControls } from './paperTranslationControls';
import { getPaperTranslation, retranslateSelection, translateSelection, type PaperHandle } from './paperTranslation';

interface FloatingState {
  key: string;
  reader: object;
  text: string;
  contextPromise?: Promise<string[] | undefined>;
  target: string;
  itemId: number;
  body: HTMLElement;
  controls: HTMLElement;
  source: HTMLElement;
  controller: AbortController;
  view: Window;
  timer?: number;
  handle?: PaperHandle;
  translated?: boolean;
  value: string;
  label: string;
  sequence: number;
}
const active = new Map<object, FloatingState>();

export function clearFloatingTranslation(reader: object): void {
  const state = active.get(reader);
  if (!state) return;
  if (state.timer !== undefined) state.view.clearTimeout(state.timer);
  state.controller.abort();
  disposePaperControls(state.controls);
  active.delete(reader);
}
export function clearAllFloatingTranslations(): void {
  for (const reader of active.keys()) clearFloatingTranslation(reader);
}
function update(state: FloatingState, text: string, label: string): void {
  state.value = text;
  state.label = label;
  state.body.textContent = text;
  state.source.textContent = label;
}
async function run(state: FloatingState, forceAI: boolean): Promise<void> {
  const generation = ++state.sequence;
  state.controller.abort();
  state.controller = new (Zotero.getMainWindow().AbortController)();
  const signal = state.controller.signal;
  try {
    const handle = state.handle ?? (await getPaperTranslation(state.itemId, state.target));
    if (signal.aborted || active.get(state.reader) !== state) return;
    state.handle = handle;
    const display = (text: string, label: string) => {
      if (!signal.aborted && generation === state.sequence && active.get(state.reader) === state) update(state, text, label);
    };
    if (forceAI) {
      display('正在根据上下文重新翻译…', 'AI 重新翻译');
      const context = await state.contextPromise;
      if (signal.aborted) return;
      const result = await retranslateSelection(handle, state.text, context, signal);
      display(result, handle.state.translated ? 'AI 重译 · 已更新选区及术语' : 'AI 重译 · 不保存局部缓存');
    } else {
      display('正在查询本地资源…', '本地优先');
      await translateSelection({ handle, text: state.text, contextPromise: state.contextPromise, signal, onText: display });
    }
  } catch (error) {
    if (!signal.aborted && generation === state.sequence) update(state, String(error instanceof Error ? error.message : error), '翻译未完成');
  }
}
function attachControls(state: FloatingState): void {
  if (!state.handle) return;
  state.translated = state.handle.state.translated;
  bindPaperControls(state.controls, state.handle, () => {
    if (state.handle?.state.translated !== state.translated) {
      state.translated = state.handle?.state.translated;
      void run(state, false);
    }
  });
}

/** Local-first selection translations never activate a chat host. */
export function showFloatingTranslation(
  reader: _ZoteroTypes.ReaderInstance<'pdf' | 'epub' | 'snapshot'>,
  container: HTMLElement,
  selectedText: string,
  position: unknown,
  contextPromise?: Promise<string[] | undefined>
): void {
  if (!getPref('translate.enableAuto')) {
    clearFloatingTranslation(reader);
    return;
  }
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  if (!view) return;
  const target = getPref('translate.targetLanguage') || Zotero.locale;
  const key = JSON.stringify([
    reader.itemID,
    selectedText,
    position,
    target,
    addon.data.userProviderConfigV2?.active,
    getPref('translate.modelId'),
    getPref('translate.useAlternativeModel'),
    getPref('translate.thinkingDepth'),
    getPref('translate.serviceTier'),
  ]);
  const card = doc.createElement('div');
  card.className = 'floating-translation';
  const controls = doc.createElement('div');
  const body = doc.createElement('div');
  body.className = 'floating-translation-body';
  body.setAttribute('aria-live', 'polite');
  const footer = doc.createElement('div');
  footer.className = 'floating-translation-footer';
  const source = doc.createElement('span');
  const retry = ztoolkit.UI.createElement(doc, 'button', {
    namespace: 'html',
    properties: { type: 'button', textContent: '重新翻译' },
  }) as HTMLButtonElement;
  footer.append(source, retry);
  card.append(controls, body, footer);
  container.appendChild(card);
  const prior = active.get(reader);
  let state: FloatingState;
  if (prior?.key === key) {
    disposePaperControls(prior.controls);
    state = prior;
    Object.assign(state, { body, controls, source });
    body.textContent = state.value;
    source.textContent = state.label;
    attachControls(state);
  } else {
    clearFloatingTranslation(reader);
    state = {
      key,
      reader,
      text: selectedText,
      target,
      itemId: reader.itemID!,
      body,
      controls,
      source,
      contextPromise,
      controller: new view.AbortController(),
      view,
      value: '正在查询…',
      label: '本地优先',
      sequence: 0,
    };
    active.set(reader, state);
    body.textContent = state.value;
    state.timer = view.setTimeout(() => {
      state.timer = undefined;
      if (active.get(reader) !== state || !state.body.isConnected) return;
      void getPaperTranslation(state.itemId, target)
        .then((handle) => {
          if (active.get(reader) !== state) return;
          state.handle = handle;
          attachControls(state);
          void run(state, false);
        })
        .catch((error) => update(state, String(error instanceof Error ? error.message : error), '无法读取论文状态'));
    }, 200);
  }
  retry.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void run(state, true);
  });
  const available = view.innerHeight - container.getBoundingClientRect().bottom - 16;
  card.style.maxHeight = `${Math.max(100, Math.min(view.innerHeight * 0.45, available))}px`;
}
