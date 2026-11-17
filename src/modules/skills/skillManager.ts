import { config } from '../../../package.json';
import { registerChatSkinRoot } from '../../utils/chatSkin';
import { skillsStore, type SkillDefinition } from './skillStore';

const BUILTIN_ID = 'explanation-preferences';

interface SkillDraft {
  id: string | undefined;
  dirty: boolean;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}
let managerWindow: Window | null | undefined;

export function openSkillManager(): void {
  if (managerWindow && !managerWindow.closed) {
    managerWindow.focus();
    return;
  }
  managerWindow = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/skillManager.html`,
    `${config.addonRef}-skill-manager`,
    'chrome,centerscreen,resizable,status,dialog=no,width=960,height=760',
    { onBodyLoaded: (window: Window) => addon.hooks.onPrefsEvent('skillManagerLoad', { window }) }
  );
}

export async function onSkillManagerLoad(window: Window): Promise<void> {
  managerWindow = window;
  registerChatSkinRoot(window.document.documentElement);
  await new SkillManager(window).initialize();
}

class SkillManager {
  private readonly doc: Document;
  private skills: SkillDefinition[] = [];
  private selectedId: string | undefined;
  private pending = false;
  private ready = false;
  private dirty = false;

  constructor(private readonly win: Window) {
    this.doc = win.document;
  }

  private element<T extends HTMLElement>(id: string): T {
    return this.doc.getElementById(id) as T;
  }

  private get builtin(): boolean {
    return this.selectedId === BUILTIN_ID;
  }

  async initialize(): Promise<void> {
    this.element('skill-new').addEventListener('click', () => {
      if (!this.canDiscard()) return;
      this.selectedId = undefined;
      this.renderEditor();
      this.renderList();
      this.element('skill-name').focus();
    });
    this.element('skill-refresh').addEventListener('click', () => {
      if (!this.canDiscard()) return;
      void this.run(async () => {
        await skillsStore.initialize();
        await this.reload();
        this.ready = true;
      }, '已刷新技能与偏好。');
    });
    this.element<HTMLFormElement>('skill-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.builtin) return;
      void this.run(async () => {
        const saved = await skillsStore.saveSkill({
          id: this.selectedId,
          name: this.element<HTMLInputElement>('skill-name').value.trim(),
          description: this.element<HTMLTextAreaElement>('skill-description').value.trim(),
          instructions: this.element<HTMLTextAreaElement>('skill-instructions').value.trim(),
          enabled: this.element<HTMLInputElement>('skill-enabled').checked,
        });
        this.selectedId = saved.id;
        await skillsStore.flush();
        await this.reload();
      }, '技能已保存。');
    });
    this.element('skill-delete').addEventListener('click', () => {
      const id = this.selectedId;
      if (!id || this.builtin || !this.win.confirm('确定删除此技能？此操作无法撤销。')) return;
      void this.run(async () => {
        await skillsStore.deleteSkill(id);
        await skillsStore.flush();
        this.selectedId = undefined;
        await this.reload();
      }, '技能已删除。');
    });
    this.element<HTMLInputElement>('skill-enabled').addEventListener('change', () => {
      const id = this.selectedId;
      if (!id) {
        this.dirty = true;
        return;
      }
      const enabled = this.element<HTMLInputElement>('skill-enabled').checked;
      void this.run(
        async () => {
          try {
            await skillsStore.setEnabled(id, enabled);
            await skillsStore.flush();
            this.skills = (await skillsStore.snapshot()).skills;
            this.renderList();
          } catch (error) {
            this.element<HTMLInputElement>('skill-enabled').checked = !enabled;
            throw error;
          }
        },
        enabled ? '技能已启用。' : '技能已停用。'
      );
    });
    for (const id of ['skill-name', 'skill-description', 'skill-instructions']) {
      this.element(id).addEventListener('input', () => {
        this.dirty = true;
      });
    }
    this.win.addEventListener('beforeunload', (event) => {
      if (this.pending || !this.canDiscard()) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    await this.run(async () => {
      await skillsStore.initialize();
      await this.reload();
      this.ready = true;
    }, '已加载技能与偏好。');
  }

  private canDiscard(): boolean {
    return !this.dirty || this.win.confirm('有尚未保存的修改，确定放弃这些修改？');
  }

  private async run(action: () => Promise<void>, success: string): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.setStatus('正在处理…');
    this.updateControls();
    try {
      await action();
      this.setStatus(success);
    } catch (error) {
      Zotero.debug(`[${config.addonRef}] Skill manager operation failed: ${String(error)}`);
      this.setStatus('操作失败。请检查内容是否完整、长度是否超出限制，然后重试；若仍失败，请重新打开此窗口。', true);
    } finally {
      this.pending = false;
      this.updateControls();
    }
  }

  private setStatus(message: string, error = false): void {
    const status = this.element('skill-status');
    status.setAttribute('role', error ? 'alert' : 'status');
    status.dataset.error = String(error);
    status.textContent = message;
  }

  private updateControls(): void {
    this.element('skill-manager').setAttribute('aria-busy', String(this.pending));
    for (const control of this.doc.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>('button, input, textarea')) {
      control.disabled = this.pending || !this.ready;
    }
    this.element<HTMLButtonElement>('skill-refresh').disabled = this.pending;
    this.element<HTMLButtonElement>('skill-save').disabled = this.pending || !this.ready || this.builtin;
    this.element<HTMLButtonElement>('skill-delete').disabled = this.pending || !this.ready || !this.selectedId || this.builtin;
    for (const id of ['skill-name', 'skill-description', 'skill-instructions']) {
      this.element<HTMLInputElement | HTMLTextAreaElement>(id).readOnly = this.builtin;
    }
  }

  private async reload(): Promise<void> {
    const snapshot = await skillsStore.snapshot();
    this.skills = snapshot.skills;
    if (!this.selectedId || !this.skills.some((skill) => skill.id === this.selectedId)) {
      this.selectedId = this.skills[0]?.id;
    }
    this.renderList();
    this.renderEditor();
    const preferences = this.element('skill-preferences');
    preferences.replaceChildren();
    this.element('skill-preferences-count').textContent = `${snapshot.preferences.length} 条`;
    if (!snapshot.preferences.length) {
      const empty = this.doc.createElement('p');
      empty.className = 'muted';
      empty.textContent = '尚未学习到解释偏好。在对话中明确纠正解释方式后，偏好会出现在这里。';
      preferences.append(empty);
    }
    for (const preference of snapshot.preferences) {
      const row = this.doc.createElement('article');
      row.className = 'preference-row';
      row.dataset.preferenceId = preference.id;
      row.dataset.status = preference.status;
      const content = this.doc.createElement('div');
      const title = this.doc.createElement('strong');
      title.textContent = preference.value;
      const details = this.doc.createElement('p');
      details.className = 'muted';
      const dimensions: Record<string, string> = {
        length: '解释篇幅',
        structure: '组织结构',
        examples: '示例使用',
        terminology: '术语表达',
        rigor: '严谨程度',
      };
      const status = { active: '生效中', superseded: '已被替代', disabled: '已停用' }[preference.status];
      details.textContent = `适用情境：${preference.context} · 维度：${dimensions[preference.dimension] || preference.dimension} · L${preference.level} · ${status} · 更新：${new Date(preference.updatedAt).toLocaleString('zh-CN')}`;
      content.append(title, details);
      const forget = this.doc.createElement('button');
      forget.type = 'button';
      forget.textContent = '忘记';
      forget.dataset.action = 'forget-preference';
      forget.setAttribute('aria-label', `忘记偏好：${preference.value}`);
      forget.addEventListener('click', () => {
        void this.run(async () => {
          await skillsStore.removePreference(preference.id);
          await skillsStore.flush();
          // Refresh only the learned records so unsaved skill edits remain intact.
          const draft = this.captureDraft();
          await this.reload();
          this.restoreDraft(draft);
        }, '已忘记此偏好。');
      });
      row.append(content, forget);
      preferences.append(row);
    }
  }

  private captureDraft(): SkillDraft {
    return {
      id: this.selectedId,
      dirty: this.dirty,
      name: this.element<HTMLInputElement>('skill-name').value,
      description: this.element<HTMLTextAreaElement>('skill-description').value,
      instructions: this.element<HTMLTextAreaElement>('skill-instructions').value,
      enabled: this.element<HTMLInputElement>('skill-enabled').checked,
    };
  }

  private restoreDraft(draft: SkillDraft): void {
    this.selectedId = draft.id;
    this.dirty = draft.dirty;
    this.element<HTMLInputElement>('skill-name').value = draft.name;
    this.element<HTMLTextAreaElement>('skill-description').value = draft.description;
    this.element<HTMLTextAreaElement>('skill-instructions').value = draft.instructions;
    this.element<HTMLInputElement>('skill-enabled').checked = draft.enabled;
    this.element('skill-editor-title').textContent = this.selectedId ? '编辑技能' : '新建技能';
    this.element('skill-builtin-note').hidden = !this.builtin;
    this.renderList();
  }

  private renderList(): void {
    const list = this.element('skill-list');
    list.replaceChildren();
    this.element('skill-enabled-count').textContent = `${this.skills.filter((skill) => skill.enabled).length} 项已启用 / 共 ${this.skills.length} 项`;
    for (const skill of this.skills) {
      const button = this.doc.createElement('button');
      button.type = 'button';
      button.className = 'skill-row';
      button.dataset.skillId = skill.id;
      button.setAttribute('aria-pressed', String(skill.id === this.selectedId));
      const name = this.doc.createElement('strong');
      name.textContent = skill.name;
      const state = this.doc.createElement('span');
      state.className = 'muted';
      state.textContent = `${skill.enabled ? '已启用' : '已停用'}${skill.id === BUILTIN_ID ? ' · 内置' : ''}`;
      button.append(name, state);
      button.addEventListener('click', () => {
        if (skill.id === this.selectedId || !this.canDiscard()) return;
        this.selectedId = skill.id;
        this.renderList();
        this.renderEditor();
        this.updateControls();
      });
      list.append(button);
    }
  }

  private renderEditor(): void {
    const skill = this.skills.find((candidate) => candidate.id === this.selectedId);
    this.element('skill-editor-title').textContent = skill ? '编辑技能' : '新建技能';
    this.element<HTMLInputElement>('skill-name').value = skill?.name || '';
    this.element<HTMLTextAreaElement>('skill-description').value = skill?.description || '';
    this.element<HTMLTextAreaElement>('skill-instructions').value = skill?.instructions || '';
    this.element<HTMLInputElement>('skill-enabled').checked = skill?.enabled ?? true;
    this.element('skill-builtin-note').hidden = !this.builtin;
    this.dirty = false;
    this.updateControls();
  }
}
