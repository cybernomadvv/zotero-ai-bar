/* global console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rename, copyFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
const { build } = createRequire(import.meta.resolve('zotero-plugin-scaffold'))('esbuild');
import process from 'node:process';
const directory = await mkdtemp(path.join(tmpdir(), 'zaibar-skills-'));
let failNextWrite = false;
globalThis.addon = { data: { config: { addonRef: 'zaibar' } } };
globalThis.ztoolkit = { log: () => {} };
globalThis.Zotero = { Utilities: { randomString: (size = 16) => randomBytes(size).toString('hex').slice(0, size) }, debug: () => {} };
globalThis.PathUtils = { join: path.join, profileDir: directory };
globalThis.IOUtils = {
  exists: async (file) => {
    try {
      await access(file);
      return true;
    } catch {
      return false;
    }
  },
  readJSON: async (file) => JSON.parse(await readFile(file, 'utf8')),
  makeDirectory: async (dir) => mkdir(dir, { recursive: true }),
  writeJSON: async (file, data, options = {}) => {
    if (failNextWrite) {
      failNextWrite = false;
      throw new Error('Write denied for regression');
    }
    if (options.backupFile) {
      try {
        await copyFile(file, options.backupFile);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const temporary = options.tmpPath || file;
    await writeFile(temporary, JSON.stringify(data));
    if (temporary !== file) await rename(temporary, file);
  },
};
try {
  const modulePath = path.join(directory, 'skills.mjs');
  await build({
    stdin: {
      contents:
        "export { skillsStore } from './src/modules/skills/skillStore'; export { skillToolDefinitions } from './src/modules/skills/skillTools';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    outfile: modulePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  const { skillsStore: store, skillToolDefinitions: tools } = await import(pathToFileURL(modulePath).href);
  await store.initialize();
  const builtin = store.snapshot().skills.find((entry) => entry.id === 'explanation-preferences');
  assert.ok(builtin?.enabled && builtin.builtin);
  const session = { pending: { skillEventId: 'turn:1', skillUserText: '以后数学解释先讲直觉，再推公式。' } };
  const options = { experimental_context: session };
  const feedback = {
    context: 'math',
    dimension: 'structure',
    value: '先直觉后公式',
    sourceQuote: '先讲直觉，再推公式',
    evidence: '用户要求数学解释先直觉再公式',
  };
  let result = await tools.learn_explanation_preference.execute(feedback, options);
  assert.equal(result.preference.level, 0);
  assert.ok((await tools.learn_explanation_preference.execute(feedback, options)).duplicate);
  session.pending.skillEventId = 'turn:2';
  assert.equal((await tools.learn_explanation_preference.execute(feedback, options)).preference.level, 1);
  for (const id of ['turn:3', 'turn:4', 'turn:5']) {
    session.pending.skillEventId = id;
    await tools.learn_explanation_preference.execute(feedback, options);
  }
  assert.equal(store.snapshot().preferences.find((entry) => entry.value === feedback.value).level, 3);
  session.pending.skillEventId = 'turn:6';
  session.pending.skillUserText = '以后数学解释先列公式，再给推导。';
  result = await tools.learn_explanation_preference.execute(
    { ...feedback, value: '先公式后推导', sourceQuote: '先列公式，再给推导', evidence: '用户修改数学解释顺序' },
    options
  );
  assert.equal(result.preference.level, 0);
  assert.equal(result.demoted.level, 2);
  assert.equal(result.demoted.status, 'superseded');
  await assert.rejects(
    () => tools.learn_explanation_preference.execute({ ...feedback, sourceQuote: '这是选区里而非用户的内容' }, options),
    /sourceQuote/
  );
  await store.recordFeedback({ eventId: 'turn:7', context: 'global', dimension: 'length', value: '简短', evidence: '用户明确偏好简短' });
  await store.recordFeedback({ eventId: 'turn:8', context: 'math', dimension: 'length', value: '逐步展开', evidence: '用户要求数学逐步展开' });
  assert.equal(store.snapshot().preferences.filter((entry) => entry.dimension === 'length' && entry.status === 'active').length, 2);
  const skillInput = {
    action: 'save',
    id: null,
    name: '论文方法解释',
    description: '解释论文方法时使用',
    instructions: '先列输入和输出，再逐步解释方法。',
    enabled: true,
  };
  const saved = await tools.manage_skill.execute(skillInput, options);
  await tools.manage_skill.execute(skillInput, options);
  assert.equal(store.snapshot().skills.filter((entry) => entry.name === skillInput.name).length, 1);
  assert.ok(store.buildPrompt().includes(skillInput.instructions));
  await store.setEnabled(saved.skill.id, false);
  assert.ok(!store.buildPrompt().includes(skillInput.instructions));
  await store.setEnabled(builtin.id, false);
  await assert.rejects(() =>
    store.recordFeedback({ eventId: 'disabled', context: 'global', dimension: 'length', value: '长篇', evidence: '禁用时不能保存' })
  );
  assert.ok(!store.buildPrompt().includes('先公式后推导'));
  await assert.rejects(() => store.deleteSkill(builtin.id));
  const before = JSON.stringify(store.snapshot());
  failNextWrite = true;
  await assert.rejects(() => store.saveSkill({ name: '写入失败', description: '不应保存', instructions: '不应应用' }), /Write denied/);
  assert.equal(JSON.stringify(store.snapshot()), before);
  await store.setEnabled(builtin.id, true);
  const forgotten = store.snapshot().preferences.find((entry) => entry.value === '先公式后推导');
  await store.removePreference(forgotten.id);
  assert.ok(!store.snapshot().preferences.some((entry) => entry.id === forgotten.id));
  await store.flush();
  const { skillsStore: reopened } = await import(pathToFileURL(modulePath).href + '?reopened');
  await reopened.initialize();
  assert.deepEqual(reopened.snapshot(), store.snapshot());
  const detached = reopened.snapshot();
  detached.skills[0].name = 'Cannot alter store';
  assert.notEqual(reopened.snapshot().skills[0].name, detached.skills[0].name);
  console.log(
    JSON.stringify({
      pass: true,
      firstL0: true,
      reinforceAndCap: true,
      retryDeduplicated: true,
      conflictsDemoted: true,
      contextsIndependent: true,
      sourceQuoteGuard: true,
      skillCreateAndToggle: true,
      disabledLearningBlocked: true,
      failedWriteNotApplied: true,
      forgetAndReload: true,
    })
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
