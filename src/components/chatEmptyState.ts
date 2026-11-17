import { getString } from '../utils/locale';
import type { Session } from '../modules/chatManager';

const views = new Set<ChatEmptyState>();

// Local customization: use a static greeting instead of fetching and animating poems.
class ChatEmptyState {
  private session?: Session;
  private readonly root: HTMLDivElement;
  private readonly observer?: MutationObserver;

  constructor(
    doc: Document,
    private readonly container: HTMLElement,
    shell: HTMLElement
  ) {
    this.root = doc.createElement('div');
    this.root.className = 'chat-empty-state';
    this.root.hidden = true;
    const content = doc.createElement('div');
    content.className = 'chat-empty-content';
    const greeting = doc.createElement('p');
    greeting.className = 'chat-empty-greeting';
    greeting.textContent = getString('chat-empty-greeting');
    content.appendChild(greeting);
    this.root.appendChild(content);
    shell.appendChild(this.root);

    const MutationObserverCtor = doc.defaultView?.MutationObserver;
    this.observer = MutationObserverCtor ? new MutationObserverCtor(() => this.updateVisibility()) : undefined;
    this.observer?.observe(container, { childList: true });
    views.add(this);
  }

  refresh(session: Session): void {
    if (this.session === session) this.setSession(session);
  }

  setSession(session: Session): void {
    this.session = session;
    this.updateVisibility();
  }

  private updateVisibility(): void {
    const session = this.session;
    this.root.hidden = !session || session.id === '__skin-preview__' || !!session.persistedTurns.length || !!this.container.childNodes.length;
  }

  dispose(): void {
    this.observer?.disconnect();
    views.delete(this);
    this.root.remove();
  }
}

const mounted = new WeakMap<HTMLElement, ChatEmptyState>();

export function mountChatEmptyState(doc: Document, container: HTMLElement, shell: HTMLElement): () => void {
  const view = new ChatEmptyState(doc, container, shell);
  mounted.set(container, view);
  return () => {
    mounted.delete(container);
    view.dispose();
  };
}

export function syncChatEmptyState(session: Session, container: HTMLElement): void {
  mounted.get(container)?.setSession(session);
}

/** Refresh the static empty view after clearing a conversation. */
export function resetChatEmptyState(session: Session): void {
  for (const view of views) view.refresh(session);
}
