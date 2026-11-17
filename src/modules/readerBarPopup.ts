/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * readerBarPopup.ts
 *
 * This file is part of Zotero AI Bar.
 * Zotero AI Bar - A handy AI assistant integration for Zotero
 *
 * Copyright (c) 2026. swcxito <120201848+swcxito@users.noreply.github.com>
 *
 * Zotero AI Bar is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * Zotero AI Bar is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.
 *
 * Repository: https://github.com/swcxito/zotero-ai-bar
 */

import { config } from '../../package.json';
import { registerChatSkinRoot } from '../utils/chatSkin';
import { getSelectionContext } from '../utils/selectionContext';
import { getString } from '../utils/locale';
import { getPref } from '../utils/prefs';
import { aiBarCommands } from '../utils/prompts';
import { ActionButton } from '../components/buttons/actionButton';
import { ModelInfo, registerModelInfoAnchor } from '../components/modelInfo';
import { ExpandButton, ExpandMenuItem } from '../components/buttons/expandButton';
import { refreshSelectionHints } from './selectionHint';
import { getArticleSessionId } from './chatWorkspace';
import { toolbarLayout } from './toolbarLayout';
import { clearAllFloatingTranslations, clearFloatingTranslation, showFloatingTranslation } from './floatingTranslation';

function getTargetLanguage(): string {
  const prefLang = getPref('translate.targetLanguage');
  return prefLang || Zotero.locale;
}

export function formatPopupActionLabel(label: string, locale: string = Zotero.locale): string {
  return String(locale).toLowerCase().startsWith('zh') ? `【${label}】` : `[${label}]`;
}

// Zotero can rebuild a selection popup several times for the same reader
// (for example while scrolling). Keep at most one lifecycle watcher per
// reader so an older popup cannot later clear the state of a newer one.
const selectionPopupWatchers = new Map<object, () => void>();

function getReaderSelectionPosition(reader: any): unknown {
  try {
    const internal = reader._internalReader;
    if (typeof internal?.getSelectionPosition !== 'function') return undefined;
    return internal.getSelectionPosition();
  } catch {
    return undefined;
  }
}

function clearReaderSelection(reader: object) {
  clearFloatingTranslation(reader);
  if (addon.data.selection.currentReader !== reader) return;
  addon.data.selection.text = undefined;
  addon.data.selection.contextPromise = undefined;
  addon.data.selection.currentAnnotation = undefined;
  refreshSelectionHints();
}

// TODO 支持其它格式

export function getReaderSourceLabel(reader?: _ZoteroTypes.ReaderInstance<'pdf' | 'epub' | 'snapshot'>) {
  const isValidTitle = (value?: unknown) => {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (!text) return false;
    return !/^(pdf|epub|snapshot)$/i.test(text);
  };

  const getItemTitle = (item?: any) => {
    if (!item) return undefined;
    const title = item?.getField?.('title') || item?.getDisplayTitle?.() || item?.title;
    return isValidTitle(title) ? String(title).trim() : undefined;
  };

  const getFileName = (item?: any) => {
    if (!item) return undefined;
    const name = item?.attachmentFilename || item?.getFilename?.() || item?.getField?.('filename');
    if (typeof name === 'string' && name.trim()) return name.trim();

    const filePath = item?.getFilePath?.();
    if (typeof filePath === 'string' && filePath.trim()) {
      const normalized = filePath.replace(/\\/g, '/');
      return normalized.split('/').pop() || undefined;
    }

    return undefined;
  };

  const itemID = reader?.itemID;
  if (itemID) {
    const item = Zotero.Items.get(itemID) as any;

    const parentID = item?.parentID || item?.parentItemID;
    const parentItem = parentID ? (Zotero.Items.get(parentID) as any) : undefined;

    const title = getItemTitle(parentItem) || getItemTitle(item);
    if (title) return title;

    const fileName = getFileName(item);
    if (fileName) return fileName;
  }
  return getString('sidepane-title');
}

/**
 * must call once in main window otherwise CSS file won't be loaded in reader popup.
 * register CSS in main window so that it can be read by reader popup.
 * CSS cannot be loaded if we inject it directly in reader popup.
 **/
export function registerAIBarStyleSheet(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  const styles = ztoolkit.UI.createElement(doc, 'link', {
    properties: {
      type: 'text/css',
      rel: 'stylesheet',
      href: `chrome://${addon.data.config.addonRef}/content/zoteroAIBar.css`,
    },
  });
  doc.documentElement?.appendChild(styles);
  const skinStyles = ztoolkit.UI.createElement(doc, 'link', {
    properties: {
      type: 'text/css',
      rel: 'stylesheet',
      href: `chrome://${addon.data.config.addonRef}/content/styles/skins.css`,
    },
  });
  doc.documentElement?.appendChild(skinStyles);
}

/**
 * 将 KaTeX 字体 @font-face 规则注册到主窗口文档级。
 * 必须在主窗口加载时注入，Shadow DOM 内的 <link> 的 @font-face
 * 不会注册到浏览器字体表。
 */
export function registerKaTeXFontSheet(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  if (doc.querySelector(`link[href*="katex.min.css"]`)) return;
  const link = ztoolkit.UI.createElement(doc, 'link', {
    properties: {
      type: 'text/css',
      rel: 'stylesheet',
      href: `chrome://${addon.data.config.addonRef}/content/styles/katex.min.css`,
    },
  });
  doc.documentElement?.appendChild(link);
}

// entry point for reader popup
export function registerReaderInitializer() {
  const handler = ({ reader, doc, params, append }: any) => {
    // React can render the old popup while clearing the reader selection.
    // Its annotation text is a snapshot, not proof of a live selection.
    if (getReaderSelectionPosition(reader) === null || !params.annotation?.text?.trim()) {
      selectionPopupWatchers.get(reader)?.();
      clearReaderSelection(reader);
      return;
    }
    // addon.hooks.onReaderPopupShow(event);
    addon.data.selection.text = params.annotation.text?.trim();
    ztoolkit.log(addon.data.selection.text, 'selected');
    if (getPref('extend-selection-context')) {
      addon.data.selection.contextPromise = getSelectionContext(reader, params);
    } else {
      addon.data.selection.contextPromise = Promise.resolve(undefined);
    }
    // ztoolkit.log(doc);
    // ztoolkit.log(append);
    // ztoolkit.log("annotation", params.annotation);
    ztoolkit.log('Creating Ask AI Bar');
    addon.data.selection.currentAnnotation = params.annotation;
    addon.data.selection.currentReader = reader;
    if (reader._internalReader._type === 'pdf') {
      const readerKey = reader as object;
      selectionPopupWatchers.get(readerKey)?.();
      const fragment = renderAIBar(doc, reader);
      // Grab the container BEFORE `append(fragment)` — appending a
      // DocumentFragment moves its children and leaves the fragment empty,
      // so querying the fragment afterwards would find nothing. The element
      // reference itself stays valid once moved into the live DOM.
      const container = fragment.querySelector('.ai-bar-container') as HTMLElement | null;
      append(fragment);
      // Expand the selection hint bar above the input area for this tab.
      refreshSelectionHints();
      // When the popup closes (user clicks away / cancels selection), clear
      // the cached selection so a follow-up sidebar question doesn't see a
      // stale `selection.text` and mistakenly emit a <selection> block for
      // text the user no longer has highlighted. This also collapses the
      // selection hint bar.
      //
      // Poll the reader's own popup state and the injected container. Do not
      // attach a MutationObserver to Zotero's React document tree here:
      // selection-popup renders can cross compartments while React is
      // committing, which intermittently makes Gecko reject observe() even
      // with an otherwise valid MutationObserverInit.
      if (container) {
        const ownerDoc = doc;
        const view = ownerDoc.defaultView;
        const annotation = params.annotation;
        const isSelectionStillOpen = (): boolean | undefined => {
          const position = getReaderSelectionPosition(reader);
          return position === undefined ? undefined : position !== null;
        };
        let timer: number | undefined;
        let stopped = false;
        const onDocumentUnload = () => {
          stop();
          clearReaderSelection(reader);
        };
        function stop() {
          if (stopped) return;
          stopped = true;
          if (timer !== undefined && view) view.clearInterval(timer);
          view?.removeEventListener('pagehide', onDocumentUnload);
          if (selectionPopupWatchers.get(readerKey) === stop) {
            selectionPopupWatchers.delete(readerKey);
          }
        }
        const onPopupGone = () => {
          stop();
          // Selecting new text re-renders the popup: a newer selection has
          // already overwritten the cached state — leave it alone.
          if (addon.data.selection.currentAnnotation !== annotation) return;
          clearReaderSelection(reader);
        };
        if (view) {
          selectionPopupWatchers.set(readerKey, stop);
          view.addEventListener('pagehide', onDocumentUnload, { once: true });
          timer = view.setInterval(() => {
            // A newer popup/selection owns the shared state now.
            if (addon.data.selection.currentAnnotation !== annotation) {
              stop();
              return;
            }

            const isOpen = isSelectionStillOpen();
            if (!container.isConnected) {
              // A connected selection may cause Zotero to replace the popup
              // while repositioning it. Its next render installs a new
              // watcher, so retire this one without clearing shared state.
              if (isOpen === true) stop();
              else onPopupGone();
              return;
            }
            if (isOpen === false) onPopupGone();
          }, 400);
        }
      }
      // Automatic translation stays in this popup and never activates a chat host.
      if (container && getPref('translate.enableAuto')) {
        const contextMode = getPref('translate.extendContext');
        const contextPromise =
          contextMode === 'never'
            ? undefined
            : contextMode === 'always' && !getPref('extend-selection-context')
              ? getSelectionContext(reader, params)
              : addon.data.selection.contextPromise;
        showFloatingTranslation(reader, container, params.annotation.text.trim(), params.annotation.position, contextPromise);
      }
    }
  };
  addon.data._readerPopupHandler = handler;
  Zotero.Reader.registerEventListener('renderTextSelectionPopup', handler, config.addonID);
}

export function unregisterReaderInitializer() {
  clearAllFloatingTranslations();
  for (const stop of [...selectionPopupWatchers.values()]) stop();
  selectionPopupWatchers.clear();
  if (addon.data._readerPopupHandler) {
    Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', addon.data._readerPopupHandler);
  }
}

async function sendStructuredTranslation(
  reader: _ZoteroTypes.ReaderInstance<'pdf' | 'epub' | 'snapshot'>,
  contextPromise?: Promise<string[] | undefined>,
  selectedTextSnapshot?: string
) {
  const selectedText = selectedTextSnapshot ?? addon.data.selection.text;
  if (!selectedText) return;
  const contextMode = getPref('translate.extendContext');
  if (contextMode === 'never') contextPromise = undefined;
  else if (contextMode === 'always' && !contextPromise && addon.data.selection.currentReader === reader) {
    const annotation = addon.data.selection.currentAnnotation;
    if (annotation?.text?.trim() === selectedText) contextPromise = getSelectionContext(reader, { annotation });
  }

  await addon.chatManager.sendTranslationRequest({
    targetLanguage: getTargetLanguage(),
    selectedText,
    sourceLabel: getReaderSourceLabel(reader),
    isFromPopup: true,
    contextPromise,
    itemId: reader.itemID!,
    sourceTabId: reader.tabID,
  });
}

function renderAIBar(doc: Document, reader: _ZoteroTypes.ReaderInstance<'pdf' | 'epub' | 'snapshot'>): DocumentFragment {
  // ── Insert styles ────────────────
  if (!doc.querySelector(`link[href="chrome://${addon.data.config.addonRef}/content/zoteroAIBar.css"]`)) {
    const styles = ztoolkit.UI.createElement(doc, 'link', {
      properties: {
        type: 'text/css',
        rel: 'stylesheet',
        href: `chrome://${addon.data.config.addonRef}/content/zoteroAIBar.css`,
      },
    });
    doc.head?.appendChild(styles);
  }
  if (!doc.querySelector(`link[href="chrome://${addon.data.config.addonRef}/content/styles/skins.css"]`)) {
    const skinStyles = ztoolkit.UI.createElement(doc, 'link', {
      properties: {
        type: 'text/css',
        rel: 'stylesheet',
        href: `chrome://${addon.data.config.addonRef}/content/styles/skins.css`,
      },
    });
    doc.head?.appendChild(skinStyles);
  }

  async function handleAction(input: string) {
    if (!input) return;
    ztoolkit.log('Action:', input);
    const command = aiBarCommands[input];
    const custom = (addon.data.userPrompts ?? []).find((prompt) => `user-${prompt.id}` === input);
    const selectedText = addon.data.selection.text;
    const contextPromise = selectedText ? addon.data.selection.contextPromise : undefined;

    if (!selectedText && (command || custom)) return;

    clearFloatingTranslation(reader);
    hideContainerOnTimeout();
    disableAll();

    if (input === 'translate') {
      await sendStructuredTranslation(reader, contextPromise, selectedText);
      return;
    }

    await addon.chatManager.sendChatRequest({
      // If input matches a command, use the command's prompt; otherwise treat input as a custom prompt
      userPrompt: custom?.prompt ?? command?.getPrompt(getTargetLanguage()) ?? input,
      displayUserText: command ? formatPopupActionLabel(getString(command.label)) : custom ? formatPopupActionLabel(custom.name) : input,
      selectionSnapshot: { text: selectedText, contextPromise },
      sourceLabel: getReaderSourceLabel(reader),
      isFromPopup: true,
      // Enable auto-copy for smartCopy command only
      doesCopyResponse: input === 'smartCopy',
      itemId: reader.itemID!,
      sourceTabId: reader.tabID,
      sessionId: getArticleSessionId(reader.tabID),
      sessionKind: 'article',
    });
  }

  const layout = toolbarLayout();
  const directActions = layout.ordered.filter((action) => layout.visible.has(action.id));
  const expandMenuItems: ExpandMenuItem[] = layout.ordered
    .filter((action) => !layout.visible.has(action.id))
    .map((action) => ({
      id: action.id,
      icon: action.icon,
      label: action.label,
      onClick: () => handleAction(action.id),
    }));

  const fragment = ztoolkit.UI.createElement(doc, 'fragment', {
    children: [
      {
        tag: 'div',
        classList: ['ai-bar-container'],
        children: [
          ModelInfo(),
          ...directActions.map((action) =>
            ActionButton({ label: action.label, icon: action.icon, classList: ['ai-btn'], onClick: () => handleAction(action.id) })
          ),
          ...(expandMenuItems.length ? [ExpandButton({ label: getString('reader-bar-expand'), menuItems: expandMenuItems })] : []),
          // Ask (Input Group)
          {
            tag: 'div',
            classList: ['input-group'],
            children: [
              {
                tag: 'textarea',
                attributes: { 'aria-label': getString('reader-bar-ask-placeholder') },
                properties: {
                  placeholder: '',
                  rows: 1,
                },
                listeners: [
                  {
                    type: 'focus',
                    listener: () => {
                      // Add overlay element to prevent reader's global keydown handler
                      // making sure backspace will ont close popup.
                      // only for Zotero 8
                      if (!doc.querySelector('.context-menu-overlay')) {
                        const overlay = doc.createElement('div');
                        overlay.className = 'context-menu-overlay';
                        overlay.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: -1; opacity: 0;';
                        doc.body.appendChild(overlay);
                      }
                    },
                  },
                  {
                    type: 'blur',
                    listener: (e: Event) => {
                      const input = e.currentTarget as HTMLTextAreaElement;
                      if (!input.value) {
                        input.rows = 1;
                        input.style.height = 'auto';
                      }
                      // Remove overlay element when textarea loses focus
                      const overlay = doc.querySelector('.context-menu-overlay');
                      if (overlay) {
                        overlay.remove();
                      }
                    },
                  },
                  {
                    type: 'input',
                    listener: (e: Event) => {
                      const input = e.currentTarget as HTMLTextAreaElement;
                      const group = input.parentElement as HTMLElement;
                      const bar = group.parentElement as HTMLElement;

                      if (input.value.length > 0) {
                        bar.classList.add('has-input');
                      } else {
                        bar.classList.remove('has-input');
                      }

                      // Auto grow height
                      input.style.height = 'auto';
                      const newHeight = Math.min(input.scrollHeight, 100);
                      input.style.height = newHeight + 'px';
                    },
                  },
                  {
                    type: 'keydown',
                    listener: (e: Event) => {
                      const ke = e as KeyboardEvent;
                      if (ke.key === 'Enter' && !ke.shiftKey) {
                        ke.preventDefault();
                        const input = ke.currentTarget as HTMLTextAreaElement;
                        handleAction(input.value.trim());
                      }
                    },
                  },
                ],
              },
              {
                tag: 'button',
                classList: ['ai-send-btn'],
                properties: {
                  type: 'button',
                  innerHTML: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
                },
                listeners: [
                  {
                    type: 'click',
                    listener: (e: Event) => {
                      // e.stopPropagation();
                      const btn = e.currentTarget as HTMLButtonElement;
                      const input = btn.previousElementSibling as HTMLTextAreaElement;
                      handleAction(input.value.trim());
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const container = fragment.querySelector('.ai-bar-container') as HTMLElement;
  registerChatSkinRoot(container);
  const modelInfoEl = fragment.querySelector('#ai-bar-model-info') as HTMLElement | null;
  if (modelInfoEl) registerModelInfoAnchor(modelInfoEl);
  // Mark the textarea as contenteditable so Zotero reader's isTextBox() check
  // (reader/src/common/lib/utilities.js) recognises it as a text field and skips
  // single-key shortcuts (R/L start Read Aloud, H hand tool, S pointer tool).
  // isTextBox only matches <input type="text"> or [contenteditable="true"]; it
  // does not match <textarea> natively. The attribute has no effect on the
  // textarea's native editing behavior (form controls take precedence).
  const popupTextarea = fragment.querySelector('textarea') as HTMLTextAreaElement | null;
  popupTextarea?.setAttribute('contenteditable', 'true');
  // Avoid painting at the default position before viewport correction.
  container.style.visibility = 'hidden';
  function hideContainerOnTimeout(delay: number = 500) {
    setTimeout(() => {
      container.style.display = 'none';
    }, delay);
  }

  function adjustPopupPosition() {
    if (!container.isConnected) return;
    const docWidth = doc.documentElement.clientWidth;
    const margin = 10;
    const sidebar = doc.getElementById('sidebarContainer');
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 0;
    container.style.maxWidth = `${Math.max(180, docWidth - sidebarRight - margin * 2)}px`;
    const measured = container.getBoundingClientRect();

    // The left boundary must account for the reader's left sidebar
    // (thumbnails / annotations / outline). When open it sits at the left edge
    // of the reader iframe, so the popup must not extend past its right edge -
    // otherwise a selection near the left page column lets the (max-content)
    // AI bar slide left and overlap the sidebar. #sidebarContainer is only in
    // the DOM while the sidebar is open, so a null result means the sidebar is
    // closed and the left boundary is just `margin`.
    const leftBound = Math.max(margin, sidebarRight + margin);

    let shiftX = 0;
    if (measured.left < leftBound) {
      shiftX = leftBound - measured.left;
    } else if (measured.right > docWidth - margin) {
      shiftX = docWidth - margin - measured.right;
    }

    if (shiftX !== 0) {
      container.style.transform = `translateX(calc(-50% + ${shiftX}px))`;
    }
    container.style.visibility = 'visible';
  }

  // Position after React attaches the fragment, before the first visible paint.
  doc.defaultView?.requestAnimationFrame(adjustPopupPosition);

  // for click end
  const disableAll = () => {
    container.querySelectorAll('button, textarea').forEach((el: Element) => {
      (el as HTMLButtonElement | HTMLTextAreaElement).disabled = true;
    });
  };
  return fragment;
}
