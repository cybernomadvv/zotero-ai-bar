/* global console, AbortController */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
const { build } = createRequire(import.meta.resolve('zotero-plugin-scaffold'))('esbuild');
const directory = await mkdtemp(path.join(tmpdir(), 'zaibar-magpie-sync-'));
const added = {
  id: 'old',
  name: 'Existing',
  family: 'unknown',
  reasoning: false,
  temperature: false,
  modalities: { input: ['text'], output: ['text'] },
  open_weights: false,
  cost: { input: 0, output: 0 },
  limit: { context: 0, output: 0 },
  providerId: 'magpie',
  enabled: false,
};
const v2 = {
  active: { providerId: 'magpie', modelId: 'old' },
  env: { magpie: { MAGPIE_API_KEY: 'local-test-key' } },
  addedProviders: { magpie: { id: 'magpie', api: 'http://localhost:3425/v1', name: 'Magpie', env: ['MAGPIE_API_KEY'] } },
  addedModels: [added],
  recentUsed: [],
};
let writes = 0;
let calls = 0;
let failure = false;
let malformed = false;
let extra = false;
const common = { magpie: { ...v2.addedProviders.magpie, models: {} } };
globalThis.addon = { data: { userProviderConfigV2: v2, commonProviders: common, liveProviders: {} } };
globalThis.ztoolkit = { log: () => {} };
globalThis.Zotero = { getMainWindow: () => ({ AbortController, setTimeout, clearTimeout }) };
globalThis.__magpieTest = {
  common,
  save: async () => {
    writes++;
  },
};
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(url, 'http://localhost:3425/v1/models');
  assert.equal(options.headers.Authorization, `Bearer ${v2.env.magpie.MAGPIE_API_KEY}`);
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (failure) throw new Error('Offline');
  return {
    ok: true,
    json: async () =>
      malformed
        ? { data: [{ id: 42 }] }
        : {
            data: [
              { id: 'old', display_name: 'Existing refreshed', modalities: { input: ['text', 'image'] }, service_tiers: [{ id: 'priority' }] },
              {
                id: 'workbuddy/hy4flash-free',
                magpie_label: 'Hy4 flash · WorkBuddy',
                reasoning: true,
                reasoning_levels: ['high'],
                context_window: 960000,
                max_output_tokens: 64000,
              },
              ...(extra ? [{ id: 'future-model', display_name: 'Future model' }] : []),
            ],
          },
  };
};
try {
  const output = path.join(directory, 'sync.mjs');
  await build({
    entryPoints: ['src/modules/magpieModels.ts'],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'provider-persistence-fixture',
        setup(builder) {
          builder.onResolve({ filter: /utils\/providers$/ }, () => ({ path: 'providers', namespace: 'fixture' }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              'export const ensureCommonProviders=async()=>globalThis.__magpieTest.common; export const saveV2Config=globalThis.__magpieTest.save; export const resolveApiUrl=(url)=>url;',
            loader: 'js',
          }));
        },
      },
    ],
  });
  const { syncMagpieModels } = await import(pathToFileURL(output).href);
  await Promise.all([syncMagpieModels(), syncMagpieModels()]);
  assert.equal(calls, 1);
  assert.equal(writes, 1);
  assert.equal(added.enabled, false);
  assert.equal(v2.active.modelId, 'old');
  const hy = v2.addedModels.find((model) => model.id === 'workbuddy/hy4flash-free');
  assert.equal(hy.enabled, true);
  assert.equal(hy.limit.context, 960000);
  assert.deepEqual(hy.reasoningEfforts, ['high']);
  assert.equal(v2.addedModels.find((model) => model.id === 'old#fast').requestModelId, 'old');
  await syncMagpieModels();
  assert.equal(writes, 1);
  assert.equal(v2.addedModels.length, 3);
  extra = true;
  await syncMagpieModels();
  assert.ok(v2.addedModels.some((model) => model.id === 'future-model' && model.enabled));
  const saved = JSON.stringify(v2);
  failure = true;
  await syncMagpieModels();
  assert.equal(JSON.stringify(v2), saved);
  failure = false;
  malformed = true;
  await syncMagpieModels();
  assert.equal(JSON.stringify(v2), saved);
  malformed = false;
  await syncMagpieModels();
  assert.equal(writes, 2);
  console.log(
    JSON.stringify({
      pass: true,
      newModelsEnabled: true,
      preservesDisabledAndActive: true,
      fastVariant: true,
      repeatedRefreshDeduplicates: true,
      offlineAndInvalidKeepSaved: true,
    })
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
