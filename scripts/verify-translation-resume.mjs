/* global console, AbortController, queueMicrotask, IOUtils */
import { createRequire } from 'node:module';
const { build } = createRequire(import.meta.resolve('zotero-plugin-scaffold'))('esbuild');
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = await mkdtemp(path.join(tmpdir(), 'zaibar-resume-test-'));
const calls = [];
let failureId = 4;
let source = Array.from({ length: 9 }, (_, i) => `Segment ${i}: ${'academic translation data '.repeat(40)}.`).join(' ');
const valid = (batch) => ({
  segments: batch.map((unit) => ({ id: unit.id, translation: '译文 ' + unit.id })),
  terms: [{ source: 'academic', translation: '学术' }],
});
globalThis.__resume = {
  getItemFullText: async () => source,
  requestTranslationObject: async ({ data }) => {
    calls.push({ ids: data.segments.map((s) => s.id), glossary: data.glossary });
    if (data.segments.some((s) => s.id === failureId)) throw new Error('Simulated network interruption');
    return valid(data.segments);
  },
};
globalThis.PathUtils = { join: path.join, profileDir: root };
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
    const tmp = options.tmpPath || file;
    await writeFile(tmp, JSON.stringify(data));
    if (tmp !== file) await rename(tmp, file);
  },
  move: rename,
  remove: async (file) => rm(file, { force: true }),
};
globalThis.Zotero = {
  Items: { get: () => ({ id: 1, libraryID: 1, key: 'TESTKEY', isRegularItem: () => false, getDisplayTitle: () => 'Test' }) },
  getMainWindow: () => ({
    AbortController,
    setTimeout: (fn) => {
      queueMicrotask(fn);
      return 1;
    },
  }),
};
const output = await build({
  entryPoints: ['src/modules/paperTranslation.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'isolate-paper-translation',
      setup(builder) {
        builder.onResolve({ filter: /itemContext|\/llm$|\/localTranslation$|\/prefs$|utils\/translation$/ }, (args) => ({
          path: args.path,
          namespace: 'stub',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
          contents: args.path.includes('itemContext')
            ? 'export const getItemFullText=(...args)=>globalThis.__resume.getItemFullText(...args);'
            : args.path.endsWith('/llm')
              ? 'export const requestTranslationObject=(...args)=>globalThis.__resume.requestTranslationObject(...args);export const streamFloatingTranslation=()=>{};'
              : args.path.endsWith('/localTranslation')
                ? 'export const normalizeLookup=text=>text.trim().toLowerCase();export const isLexicalSelection=()=>false;export const lookupLocalDictionary=()=>{};export const translateLocally=()=>{};'
                : args.path.endsWith('/prefs')
                  ? 'export const getPref=()=>false;'
                  : 'export const getTranslationModelKey=()=>undefined;',
          loader: 'js',
        }));
      },
    },
  ],
});
const moduleFile = path.join(root, 'paper.mjs');
await writeFile(moduleFile, output.outputFiles[0].text);
let paper = await import(pathToFileURL(moduleFile) + '?process=1');
let handle = await paper.getPaperTranslation(1, 'zh-CN');
await paper.startPaperTranslation(handle);
assert.equal(handle.state.translated, false);
assert.equal(handle.state.completed, 4);
const checkpoint = path.join(handle.dir, 'checkpoint.json');
const saved = JSON.parse(await readFile(checkpoint, 'utf8'));
assert.equal(saved.segments.length, 4);
assert.equal(saved.terms[0].translation, '学术');
// Simulate the status write being lost and the app process going away.
await writeFile(path.join(handle.dir, 'state.json'), JSON.stringify({ ...handle.state, status: 'translating', completed: 0 }));
paper = await import(pathToFileURL(moduleFile) + '?process=2');
handle = await paper.getPaperTranslation(1, 'zh-CN');
assert.equal(handle.state.completed, 4);
assert.equal(handle.state.status, 'idle');
const before = calls.length;
failureId = -1;
await paper.startPaperTranslation(handle);
assert.equal(handle.state.translated, true);
assert.equal(handle.state.completed, 9);
assert(calls.slice(before).every((call) => call.ids.every((id) => id >= 4)));
assert(calls[before].glossary.some((term) => term.source === 'academic'));
const cache = JSON.parse(await readFile(path.join(handle.dir, 'translation.json'), 'utf8'));
assert.deepEqual(
  cache.segments.map((s) => s.id),
  Array.from({ length: 9 }, (_, i) => i)
);
assert.equal(await IOUtils.exists(checkpoint), false);
// A completed checkpoint can finalize with no further provider request.
await writeFile(checkpoint, JSON.stringify(saved));
await writeFile(path.join(handle.dir, 'state.json'), JSON.stringify({ ...handle.state, translated: false, completed: 0, status: 'idle' }));
source = saved.sources.slice(0, 4).join(' ');
// The source changed (9 -> 4 segments), so old progress cannot be reused.
paper = await import(pathToFileURL(moduleFile) + '?process=3');
handle = await paper.getPaperTranslation(1, 'zh-CN');
const changedBefore = calls.length;
await paper.startPaperTranslation(handle);
assert(calls[changedBefore].ids.includes(0));
assert.equal(handle.state.translated, true);
const full = JSON.parse(await readFile(path.join(handle.dir, 'translation.json'), 'utf8'));
await writeFile(
  checkpoint,
  JSON.stringify({ version: 1, target: 'zh-CN', sources: full.segments.map((s) => s.source), segments: full.segments, terms: full.terms })
);
await writeFile(path.join(handle.dir, 'state.json'), JSON.stringify({ ...handle.state, translated: false, status: 'translating', completed: 0 }));
paper = await import(pathToFileURL(moduleFile) + '?process=4');
handle = await paper.getPaperTranslation(1, 'zh-CN');
const finalizeBefore = calls.length;
await paper.startPaperTranslation(handle);
assert.equal(calls.length, finalizeBefore);
assert.equal(handle.state.translated, true);
console.log(
  JSON.stringify({
    pass: true,
    savedSegments: 4,
    totalOriginalSegments: 9,
    resumeSkippedCompleted: true,
    glossaryRestored: true,
    staleStatusRecovered: true,
    changedSourceRestarts: true,
    completeCheckpointFinalizesWithoutAPI: true,
  })
);
await rm(root, { recursive: true, force: true });
