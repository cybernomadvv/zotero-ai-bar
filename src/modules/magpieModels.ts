import { z } from 'zod';
import { ensureCommonProviders, resolveApiUrl, saveV2Config } from '../utils/providers';
import type { Model } from '../utils/providers';

const modality = z.enum(['audio', 'image', 'pdf', 'text', 'video']);
const modelListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().trim().min(1),
      magpie_label: z.string().optional(),
      display_name: z.string().optional(),
      reasoning: z.boolean().optional(),
      reasoning_levels: z.array(z.string()).optional(),
      modalities: z.object({ input: z.array(modality).optional(), output: z.array(modality).optional() }).optional(),
      context_window: z.number().nonnegative().optional(),
      context_length: z.number().nonnegative().optional(),
      max_output_tokens: z.number().nonnegative().optional(),
      service_tiers: z.array(z.object({ id: z.string() })).optional(),
    })
  ),
});

let pendingSync: Promise<void> | undefined;

/** Refresh configured Magpie models without changing the active model or enabled flags. */
export function syncMagpieModels(): Promise<void> {
  if (pendingSync) return pendingSync;
  pendingSync = refreshMagpieModels()
    .catch((error) => ztoolkit.log('[Magpie] Model sync failed; keeping saved models:', error))
    .finally(() => {
      pendingSync = undefined;
    });
  return pendingSync;
}

async function refreshMagpieModels(): Promise<void> {
  const v2 = addon.data.userProviderConfigV2;
  if (!v2?.addedProviders.magpie) return;
  const common = await ensureCommonProviders();
  const provider = v2.addedProviders.magpie;
  const env = v2.env.magpie ?? {};
  const api = resolveApiUrl(provider.api ?? common.magpie?.api ?? '', env);
  if (!api) return;
  const win = Zotero.getMainWindow();
  const controller = new win.AbortController();
  const timer = win.setTimeout(() => controller.abort(), 5000);
  let payload: unknown;
  try {
    const response = await fetch(`${api.replace(/\/$/, '')}/models`, {
      headers: env.MAGPIE_API_KEY || env.API_KEY ? { Authorization: `Bearer ${env.MAGPIE_API_KEY || env.API_KEY}` } : {},
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Magpie models HTTP ${response.status}`);
    payload = await response.json();
  } finally {
    win.clearTimeout(timer);
  }
  const catalog = modelListSchema.parse(payload);
  // Do not publish a response into a configuration replaced while the request was in flight.
  if (addon.data.userProviderConfigV2 !== v2) return;
  const models: Record<string, Model> = {};
  const existing = new Map(v2.addedModels.filter((model) => model.providerId === 'magpie').map((model) => [model.id, model]));
  for (const entry of catalog.data) {
    const saved = existing.get(entry.id);
    let previous: Model | undefined = common.magpie?.models[entry.id];
    if (saved) {
      const { providerId: _providerId, enabled: _enabled, ...metadata } = saved;
      previous = metadata;
    }
    const model: Model = {
      ...previous,
      id: entry.id,
      name: entry.magpie_label || entry.display_name || entry.id,
      family: previous?.family ?? 'unknown',
      reasoning: entry.reasoning ?? previous?.reasoning ?? false,
      reasoningEfforts: entry.reasoning_levels ?? previous?.reasoningEfforts,
      temperature: previous?.temperature ?? false,
      modalities: {
        input: entry.modalities?.input ?? previous?.modalities.input ?? ['text'],
        output: entry.modalities?.output ?? previous?.modalities.output ?? ['text'],
      },
      open_weights: previous?.open_weights ?? false,
      cost: previous?.cost ?? { input: 0, output: 0 },
      limit: {
        context: entry.context_window ?? entry.context_length ?? previous?.limit.context ?? 0,
        output: entry.max_output_tokens ?? previous?.limit.output ?? 0,
      },
    };
    models[model.id] = model;
    if (entry.service_tiers?.some((tier) => tier.id === 'priority')) {
      const id = `${model.id}#fast`;
      models[id] = { ...model, id, name: `${model.name} · Fast`, requestModelId: model.id, serviceTier: 'priority' };
    }
  }
  let changed = false;
  for (const model of Object.values(models)) {
    const saved = existing.get(model.id);
    if (saved) {
      const updated = { ...saved, ...model };
      if (JSON.stringify(saved) !== JSON.stringify(updated)) {
        Object.assign(saved, model);
        changed = true;
      }
    } else {
      v2.addedModels.push({ ...model, providerId: 'magpie', enabled: true });
      changed = true;
    }
  }
  common.magpie = { ...common.magpie, ...provider, env: ['MAGPIE_API_KEY'], models };
  if (addon.data.liveProviders) addon.data.liveProviders.magpie = common.magpie;
  if (changed) await saveV2Config(v2);
  ztoolkit.log('[Magpie] Synced models:', Object.keys(models).length);
}
