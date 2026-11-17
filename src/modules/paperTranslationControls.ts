import {
  declinePaperTranslation,
  getPaperTranslation,
  pausePaperTranslation,
  startPaperTranslation,
  subscribePaper,
  type PaperHandle,
} from './paperTranslation';

const bindings = new WeakMap<HTMLElement, () => void>();
export function disposePaperControls(root: HTMLElement): void {
  bindings.get(root)?.();
  bindings.delete(root);
}

export function bindPaperControls(root: HTMLElement, handle: PaperHandle, onChange?: () => void): () => void {
  disposePaperControls(root);
  const doc = root.ownerDocument;
  const render = () => {
    if (!root.isConnected) {
      disposePaperControls(root);
      return;
    }
    root.replaceChildren();
    root.className = 'paper-translation-controls';
    const status = doc.createElement('span');
    status.className = 'paper-translation-status';
    status.textContent = `全文翻译：${handle.state.translated ? 'true' : 'false'}`;
    if (handle.state.status === 'translating') status.textContent += ` · 后台 ${handle.state.completed}/${handle.state.total || '…'}`;
    else if (handle.state.status === 'queued') status.textContent += ' · 已排队';
    else if (!handle.state.translated && handle.state.completed > 0)
      status.textContent += ` · 已保存 ${handle.state.completed}/${handle.state.total}`;
    if (handle.state.error) {
      status.textContent += ' · 未完成';
      status.title = handle.state.error;
    }
    root.appendChild(status);
    const button = (label: string, action: () => Promise<void>) => {
      const control = ztoolkit.UI.createElement(doc, 'button', {
        namespace: 'html',
        properties: { type: 'button', textContent: label },
      }) as HTMLButtonElement;
      control.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        control.disabled = true;
        void action().catch((error) => {
          status.textContent = String(error instanceof Error ? error.message : error);
          control.disabled = false;
        });
      });
      root.appendChild(control);
    };
    if (!handle.state.translated && ['queued', 'translating'].includes(handle.state.status)) {
      button('暂停并保存', () => pausePaperTranslation(handle));
    }
    if (!handle.state.translated && !['queued', 'translating'].includes(handle.state.status)) {
      button(handle.state.completed > 0 ? '继续全文翻译' : handle.state.decision === 'ask' ? '翻译此文章' : '全文翻译', () =>
        startPaperTranslation(handle)
      );
      if (handle.state.decision === 'ask') button('不翻译此文章', () => declinePaperTranslation(handle));
    }
    onChange?.();
  };
  const unsubscribe = subscribePaper(handle, render);
  const view = root.ownerDocument.defaultView;
  const cleanup = () => {
    unsubscribe();
    view?.removeEventListener('pagehide', cleanup);
  };
  view?.addEventListener('pagehide', cleanup, { once: true });
  bindings.set(root, cleanup);
  render();
  return () => disposePaperControls(root);
}

export function setPaperControls(root: HTMLElement, itemId: number | undefined, target: string): void {
  disposePaperControls(root);
  root.replaceChildren();
  if (!itemId) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  const generation = (Number(root.dataset.generation) || 0) + 1;
  root.dataset.generation = String(generation);
  void getPaperTranslation(itemId, target)
    .then((handle) => {
      if (root.isConnected && root.dataset.generation === String(generation)) bindPaperControls(root, handle);
    })
    .catch((error) => {
      if (root.isConnected) root.textContent = String(error instanceof Error ? error.message : error);
    });
}
