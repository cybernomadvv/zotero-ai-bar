import { getPref, setPref } from '../utils/prefs';
import { getString } from '../utils/locale';
import { aiBarCommands } from '../utils/prompts';
import { Icons } from '../components/common';

export interface ToolbarAction {
  id: string;
  label: string;
  icon: string;
  prompt?: string;
}
export function toolbarActions(): ToolbarAction[] {
  return ['explain', 'translate', 'smartCopy', 'summarize']
    .map((id) => {
      const command = aiBarCommands[id as keyof typeof aiBarCommands];
      return { id, label: getString(command.label), icon: command.icon };
    })
    .concat(
      (addon.data.userPrompts ?? []).map((prompt) => ({ id: `user-${prompt.id}`, label: prompt.name, icon: Icons.Sparkle, prompt: prompt.prompt }))
    );
}
export function toolbarLayout(): { ordered: ToolbarAction[]; visible: Set<string> } {
  const available = toolbarActions();
  let saved: { order?: string[]; visible?: string[] } = {};
  try {
    saved = JSON.parse(getPref('toolbar.layout') || '{}');
  } catch {
    /* Use defaults. */
  }
  const order = Array.isArray(saved.order) ? saved.order : [];
  const ordered = [...order.map((id) => available.find((action) => action.id === id)).filter((action): action is ToolbarAction => !!action)];
  for (const action of available) if (!ordered.some((entry) => entry.id === action.id)) ordered.push(action);
  const ids = new Set(available.map((action) => action.id));
  const visible = new Set((Array.isArray(saved.visible) ? saved.visible : ['explain', 'translate', 'smartCopy']).filter((id) => ids.has(id)));
  for (const action of available) {
    if (visible.size >= 3) break;
    visible.add(action.id);
  }
  return { ordered, visible };
}
export function renderToolbarLayoutPreferences(container: HTMLElement): void {
  const doc = container.ownerDocument;
  const { ordered, visible } = toolbarLayout();
  const persist = () => setPref('toolbar.layout', JSON.stringify({ order: ordered.map((action) => action.id), visible: Array.from(visible) }));
  const status = doc.createElement('div');
  status.textContent = '至少直接显示三个功能；未勾选的功能自动进入“更多”。';
  const rows = doc.createElement('div');
  container.replaceChildren(status, rows);
  const button = (label: string, callback: () => void) => {
    const element = ztoolkit.UI.createElement(doc, 'button', {
      namespace: 'html',
      properties: { type: 'button', textContent: label },
    }) as HTMLButtonElement;
    element.addEventListener('click', callback);
    return element;
  };
  const render = () => {
    rows.replaceChildren();
    ordered.forEach((action, index) => {
      const row = doc.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:5px 0;';
      const checkbox = ztoolkit.UI.createElement(doc, 'input', {
        namespace: 'html',
        properties: { type: 'checkbox', checked: visible.has(action.id) },
      }) as HTMLInputElement;
      checkbox.addEventListener('change', () => {
        if (!checkbox.checked && visible.size <= 3) {
          checkbox.checked = true;
          status.textContent = '至少保留三个直接显示的功能。';
          return;
        }
        if (checkbox.checked) visible.add(action.id);
        else visible.delete(action.id);
        persist();
      });
      const label = doc.createElement('span');
      label.textContent = action.label;
      label.style.flex = '1';
      const up = button('↑', () => {
        if (!index) return;
        [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
        persist();
        render();
      });
      const down = button('↓', () => {
        if (index === ordered.length - 1) return;
        [ordered[index + 1], ordered[index]] = [ordered[index], ordered[index + 1]];
        persist();
        render();
      });
      up.disabled = index === 0;
      down.disabled = index === ordered.length - 1;
      row.append(checkbox, label, up, down);
      rows.appendChild(row);
    });
  };
  render();
}
