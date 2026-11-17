/* global AbortSignal, console, fetch */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, tool, jsonSchema } from 'ai';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync('C:/Users/FreeSHR/.pi/agent/models.json', 'utf8')).providers.magpie;
const provider = createOpenAICompatible({ name: 'magpie', baseURL: config.baseUrl, apiKey: config.apiKey, includeUsage: true });
const result = streamText({
  model: provider('codex/gpt-6.1-sol'),
  messages: [{ role: 'user', content: 'Reply with exactly MAGPIE_OK.' }],
  maxOutputTokens: 256,
  abortSignal: AbortSignal.timeout(45000),
  maxRetries: 0,
});
let text = '';
for await (const part of result.textStream) text += part;
console.log(JSON.stringify({ text, usage: await result.usage, finishReason: await result.finishReason }));
if (!text.includes('MAGPIE_OK')) throw new Error('Magpie streaming text verification failed');

const agent = streamText({
  model: provider('codex/gpt-6.1-sol'),
  messages: [{ role: 'user', content: 'Call the lookup tool with query="integration-check".' }],
  tools: {
    lookup: tool({
      description: 'A local integration test tool; does not access user documents.',
      inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }),
      execute: async ({ query }) => ({ ok: query === 'integration-check' }),
    }),
  },
  toolChoice: { type: 'tool', toolName: 'lookup' },
  providerOptions: { magpie: { reasoningEffort: 'low' } },
  maxOutputTokens: 512,
  abortSignal: AbortSignal.timeout(45000),
  maxRetries: 0,
});
await agent.consumeStream();
const calls = await agent.toolCalls;
const results = await agent.toolResults;
if (!calls.some((call) => call.toolName === 'lookup') || !results.some((result) => result.output.ok)) {
  throw new Error('Magpie streaming tool verification failed');
}
console.log('PASS Magpie streaming text and tool calls with reasoningEffort=low');

let fastRequest;
const fastProvider = createOpenAICompatible({
  name: 'magpie',
  baseURL: config.baseUrl,
  apiKey: config.apiKey,
  fetch: async (url, init) => {
    fastRequest = JSON.parse(init.body);
    return fetch(url, init);
  },
});
const fast = streamText({
  model: fastProvider('codex/gpt-6.1-sol'),
  prompt: 'Reply with exactly FAST_OK.',
  providerOptions: { magpie: { service_tier: 'priority', reasoningEffort: 'low' } },
  maxOutputTokens: 256,
  maxRetries: 0,
  abortSignal: AbortSignal.timeout(45000),
});
let fastText = '';
for await (const chunk of fast.textStream) fastText += chunk;
if (fastRequest?.service_tier !== 'priority' || !fastText.includes('FAST_OK')) throw new Error('Magpie Fast request verification failed');
console.log(JSON.stringify({ fast: true, sentServiceTier: fastRequest.service_tier, text: fastText }));
