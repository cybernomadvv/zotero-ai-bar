import { assert } from 'chai';
import { SkillStore, type FeedbackInput, type SkillStoreIO } from '../src/modules/skills/skillStore';

class MemoryIO implements SkillStoreIO {
  value: unknown = undefined;
  reads = 0;
  writes = 0;
  failWrite = false;
  beforeWrite?: () => Promise<void>;

  async read(): Promise<unknown> {
    this.reads++;
    return this.value === undefined ? undefined : JSON.parse(JSON.stringify(this.value));
  }

  async write(value: unknown): Promise<void> {
    this.writes++;
    if (this.beforeWrite) await this.beforeWrite();
    if (this.failWrite) throw new Error('Disk unavailable');
    this.value = JSON.parse(JSON.stringify(value));
  }
}

function correction(eventId: string, value = '简洁', context = '论文概念解释'): FeedbackInput {
  return { eventId, context, dimension: 'length', value, evidence: '用户明确要求该场景的解释更简洁' };
}

async function rejects(operation: Promise<unknown>, message: string): Promise<void> {
  try {
    await operation;
  } catch (error) {
    assert.include(String(error), message);
    return;
  }
  assert.fail(`Expected rejection containing: ${message}`);
}

describe('plugin skill store', function () {
  it('initializes once without writing absent state and returns detached snapshots', async function () {
    const io = new MemoryIO();
    const store = new SkillStore(io);
    await Promise.all([store.initialize(), store.initialize(), store.initialize()]);
    assert.equal(io.reads, 1);
    assert.equal(io.writes, 0);
    const snapshot = store.snapshot();
    assert.equal(snapshot.skills[0].id, 'explanation-preferences');
    assert.equal(snapshot.skills[0].name, '解释偏好学习');
    assert.isTrue(snapshot.skills[0].enabled);
    assert.isTrue(snapshot.skills[0].builtin);
    snapshot.skills[0].instructions = 'changed';
    snapshot.preferences.push({ id: 'injected', context: 'all', dimension: 'length', value: 'long', level: 3, status: 'active', updatedAt: 1 });
    assert.notEqual(store.snapshot().skills[0].instructions, 'changed');
    assert.isEmpty(store.snapshot().preferences);
  });

  it('lazily creates, edits, toggles and deletes prompt-only user skills', async function () {
    const io = new MemoryIO();
    const store = new SkillStore(io);
    const created = await store.saveSkill({ name: '比较方法', description: '并列比较方案', instructions: '比较输入方案的适用条件。' });
    assert.isFalse(created.builtin);
    assert.isTrue(created.enabled);
    created.instructions = 'caller mutation';
    assert.include(store.buildPrompt(), '比较输入方案');
    await store.setEnabled(created.id, false);
    await store.saveSkill({ id: created.id, name: '比较方法', description: '', instructions: '列出权衡。' });
    assert.isFalse(store.snapshot().skills.find((entry) => entry.id === created.id)!.enabled);
    assert.notInclude(store.buildPrompt(), '列出权衡');
    await store.setEnabled(created.id, true);
    assert.include(store.buildPrompt(), '列出权衡');
    await store.deleteSkill(created.id);
    assert.lengthOf(store.snapshot().skills, 1);
    const reloaded = new SkillStore(io);
    await reloaded.initialize();
    assert.deepEqual(reloaded.snapshot(), store.snapshot());
  });

  it('rejects built-in replacement and deletion but persists its enabled state', async function () {
    const io = new MemoryIO();
    const store = new SkillStore(io);
    await rejects(
      store.saveSkill({ id: 'explanation-preferences', name: 'other', description: '', instructions: 'overwrite' }),
      'cannot be overwritten'
    );
    await rejects(store.deleteSkill('explanation-preferences'), 'cannot be deleted');
    await store.setEnabled('explanation-preferences', false);
    const reloaded = new SkillStore(io);
    await reloaded.initialize();
    assert.isFalse(reloaded.snapshot().skills[0].enabled);
    assert.equal(reloaded.snapshot().skills[0].name, '解释偏好学习');
  });

  it('promotes only independent feedback from L0 through L3 and persists deduplication', async function () {
    const io = new MemoryIO();
    const store = new SkillStore(io);
    const first = await store.recordFeedback(correction('message-1'));
    assert.equal(first.preference!.level, 0);
    first.preference!.value = 'caller mutation';
    const duplicate = await store.recordFeedback(correction('message-1'));
    assert.isTrue(duplicate.duplicate);
    assert.equal(duplicate.preference!.level, 0);
    assert.equal(duplicate.preference!.value, '简洁');
    assert.equal(io.writes, 1);
    for (let index = 2; index <= 6; index++) {
      const result = await store.recordFeedback(correction(`message-${index}`));
      assert.equal(result.preference!.level, Math.min(index - 1, 3));
    }
    const reloaded = new SkillStore(io);
    await reloaded.initialize();
    const repeated = await reloaded.recordFeedback(correction('message-6'));
    assert.isTrue(repeated.duplicate);
    assert.equal(repeated.preference!.level, 3);
    await rejects(reloaded.recordFeedback(correction('message-6', '详细')), 'different content');
    await rejects(reloaded.recordFeedback({ ...correction('message-6'), evidence: '另一个摘要' }), 'different content');
    assert.equal(reloaded.snapshot().preferences[0].level, 3);
  });

  it('demotes conflicts, starts historical restorations at L0, and isolates scopes and dimensions', async function () {
    const store = new SkillStore(new MemoryIO());
    await store.recordFeedback(correction('first'));
    await store.recordFeedback(correction('second'));
    const conflict = await store.recordFeedback(correction('third', '详细'));
    assert.equal(conflict.demoted!.level, 0);
    assert.equal(conflict.demoted!.status, 'superseded');
    assert.equal(conflict.preference!.level, 0);
    conflict.demoted!.level = 3;
    const restored = await store.recordFeedback(correction('fourth'));
    assert.equal(restored.preference!.level, 0);
    assert.notEqual(restored.preference!.id, conflict.demoted!.id);
    await store.recordFeedback(correction('fourth', '详细', '代码审查'));
    await store.recordFeedback({ ...correction('fourth'), dimension: 'examples', value: '先举例' });
    const active = store.snapshot().preferences.filter((entry) => entry.status === 'active');
    assert.lengthOf(active, 3);
    assert.lengthOf(
      active.filter((entry) => entry.context === '论文概念解释' && entry.dimension === 'length'),
      1
    );
    assert.equal(store.snapshot().preferences[0].level, 0);
  });

  it('disables both learning and preference prompting without deleting stored preferences', async function () {
    const store = new SkillStore(new MemoryIO());
    await store.recordFeedback(correction('first', '我的独特偏好值'));
    assert.include(store.buildPrompt(), '我的独特偏好值');
    await store.setEnabled('explanation-preferences', false);
    assert.notInclude(store.buildPrompt(), '我的独特偏好值');
    assert.notInclude(store.buildPrompt(), 'learn_explanation_preference');
    await rejects(store.recordFeedback(correction('second')), 'disabled');
    assert.lengthOf(store.snapshot().preferences, 1);
    await store.setEnabled('explanation-preferences', true);
    assert.include(store.buildPrompt(), '我的独特偏好值');
  });

  it('removes evidence with its preference so deleted learning cannot replay', async function () {
    const io = new MemoryIO();
    const store = new SkillStore(io);
    const learned = await store.recordFeedback(correction('first'));
    await store.removePreference(learned.preference!.id);
    assert.isEmpty(store.snapshot().preferences);
    const persisted = io.value as { evidence: unknown[] };
    assert.isEmpty(persisted.evidence);
    const reloaded = new SkillStore(io);
    const fresh = await reloaded.recordFeedback(correction('first'));
    assert.isFalse(fresh.duplicate);
    assert.equal(fresh.preference!.level, 0);
  });

  it('serializes concurrent mutations and commits memory only after persistence succeeds', async function () {
    const io = new MemoryIO();
    const store = new SkillStore(io);
    io.beforeWrite = async () => {
      const beforeSave = store.snapshot();
      if (io.writes === 1) assert.isEmpty(beforeSave.preferences);
      else assert.equal(beforeSave.preferences[0].level, 0);
      await Promise.resolve();
      assert.deepEqual(store.snapshot(), beforeSave);
    };
    const first = store.recordFeedback(correction('first'));
    const second = store.recordFeedback(correction('second'));
    await Promise.all([first, second]);
    await store.flush();
    assert.equal(io.writes, 2);
    assert.equal(store.snapshot().preferences[0].level, 1);
  });

  it('propagates disk failures to mutation and flush, preserving memory and allowing recovery', async function () {
    const io = new MemoryIO();
    const store = new SkillStore(io);
    io.failWrite = true;
    await rejects(store.recordFeedback(correction('failed')), 'Disk unavailable');
    await rejects(store.flush(), 'Disk unavailable');
    assert.isEmpty(store.snapshot().preferences);
    assert.isUndefined(io.value);
    io.failWrite = false;
    const recovered = await store.recordFeedback(correction('failed'));
    assert.isFalse(recovered.duplicate);
    assert.equal(recovered.preference!.level, 0);
    await store.flush();
  });

  it('preserves corrupt and unsupported files and refuses all writes to them', async function () {
    for (const original of [{ version: 2, future: 'preserve me' }, { version: 1, skills: [] }, null]) {
      const io = new MemoryIO();
      io.value = original;
      const store = new SkillStore(io);
      await rejects(store.initialize(), original && original.version === 2 ? 'Unsupported' : 'Invalid');
      await rejects(store.recordFeedback(correction('first')), original && original.version === 2 ? 'Unsupported' : 'Invalid');
      await rejects(store.flush(), original && original.version === 2 ? 'Unsupported' : 'Invalid');
      assert.equal(io.reads, 1);
      assert.equal(io.writes, 0);
      assert.deepEqual(io.value, original);
    }
  });

  it('propagates read failures without treating an unreadable file as missing', async function () {
    let writes = 0;
    const store = new SkillStore({
      async read() {
        throw new Error('Permission denied');
      },
      async write() {
        writes++;
      },
    });
    await rejects(store.initialize(), 'Permission denied');
    await rejects(store.setEnabled('explanation-preferences', false), 'Permission denied');
    assert.equal(writes, 0);
  });

  it('enforces the skill count limit without overwriting existing skills', async function () {
    const io = new MemoryIO();
    const store = new SkillStore(io);
    for (let index = 0; index < 99; index++) {
      await store.saveSkill({ id: `custom-${index}`, name: 'Skill', description: '', instructions: 'Use the provided context.' });
    }
    await rejects(store.saveSkill({ name: 'Overflow', description: '', instructions: 'Too many skills.' }), 'Skill limit');
    assert.lengthOf(store.snapshot().skills, 100);
    assert.equal(io.writes, 99);
    await store.saveSkill({ id: 'custom-0', name: 'Updated', description: '', instructions: 'Updated instructions.' });
    assert.lengthOf(store.snapshot().skills, 100);
  });

  it('validates input bounds and keeps only short evidence summaries', async function () {
    const io = new MemoryIO();
    const store = new SkillStore(io);
    await rejects(store.saveSkill({ name: 'x', description: '', instructions: 'x'.repeat(12001) }), 'instructions');
    await rejects(store.recordFeedback({ ...correction('first'), evidence: 'x'.repeat(501) }), 'evidence summary');
    await rejects(store.recordFeedback({ ...correction('first'), context: 'x'.repeat(201) }), 'context');
    await rejects(store.recordFeedback({ ...correction('first'), value: 'x'.repeat(501) }), 'preference value');
    await rejects(store.recordFeedback({ ...correction('first'), dimension: 'invalid' as FeedbackInput['dimension'] }), 'dimension');
    assert.equal(io.writes, 0);
    await store.recordFeedback({ ...correction('first'), evidence: '短摘要\n  不存原文' });
    // This object was produced by the store and captured by the in-process IO fixture.
    const saved = io.value as { evidence: { evidence: string }[] };
    const evidence = saved.evidence;
    assert.equal(evidence[0].evidence, '短摘要 不存原文');
  });

  it('captures queued inputs and cannot leak mutable write objects back into state', async function () {
    let persisted: unknown;
    const store = new SkillStore({
      async read() {
        return undefined;
      },
      async write(value) {
        persisted = value;
      },
    });
    const input = correction('first');
    const saving = store.recordFeedback(input);
    input.value = 'mutated before queued callback';
    await saving;
    // The injected IO captures the store's own validated persistence payload.
    const saved = persisted as { preferences: { value: string }[] };
    saved.preferences[0].value = 'mutated IO object';
    assert.equal(store.snapshot().preferences[0].value, '简洁');
  });

  it('prompts with scoped active rules, precedence, explicit correction and capability-gap guidance', async function () {
    const store = new SkillStore(new MemoryIO());
    await store.recordFeedback(correction('first', 'obsolete preference'));
    await store.recordFeedback(correction('second', 'current preference'));
    const prompt = store.buildPrompt();
    assert.include(prompt, '"context":"论文概念解释"');
    assert.include(prompt, 'current preference');
    assert.notInclude(prompt, 'obsolete preference');
    assert.include(prompt, 'learn_explanation_preference');
    assert.include(prompt, 'manage_skill');
    assert.include(prompt, '当前请求始终优先');
    assert.include(prompt, '具体场景偏好优先于全局偏好');
    assert.include(prompt, '用户最新一条消息明确纠正');
    assert.include(prompt, '原样复用 context 和 value');
    assert.include(prompt, '临时要求');
    assert.include(prompt, '不得每条消息自动重复写入');
    assert.include(prompt, '固定底线');
  });

  it('refreshes bundled skill instructions on upgrade while preserving learned state and enablement', async function () {
    const io = new MemoryIO();
    const original = new SkillStore(io);
    await original.recordFeedback(correction('first'));
    await original.setEnabled('explanation-preferences', false);
    const saved = io.value as { skills: { instructions: string }[] };
    saved.skills[0].instructions = 'Instructions from an earlier plugin version.';
    const upgraded = new SkillStore(io);
    await upgraded.initialize();
    assert.equal(upgraded.snapshot().preferences[0].value, '简洁');
    assert.isFalse(upgraded.snapshot().skills[0].enabled);
    assert.include(upgraded.snapshot().skills[0].instructions, 'learn_explanation_preference');
    assert.notInclude(upgraded.snapshot().skills[0].instructions, 'earlier plugin version');
  });
});
