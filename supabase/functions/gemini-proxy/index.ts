import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function pickGeminiKey(): string {
  const keys = [
    Deno.env.get('GEMINI_API_KEY'),
    Deno.env.get('GEMINI_API_KEY_1'),
    Deno.env.get('GEMINI_API_KEY_2'),
    Deno.env.get('GEMINI_API_KEY_3'),
  ].filter(Boolean);
  if (keys.length === 0) throw new Error('No Gemini API keys configured');
  return keys[Math.floor(Math.random() * keys.length)]!;
}

interface ProviderResult {
  text: string;
  model?: string;
}

async function callGemini(promptText: string, temperature: number): Promise<ProviderResult> {
  const key = pickGeminiKey();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { temperature },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini (${res.status}): ${err}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini: empty response');
  return { text, model: 'gemini-2.5-flash-lite' };
}

async function callOpenAICompatible(
  endpoint: string,
  model: string,
  apiKey: string | undefined,
  promptText: string,
  temperature: number,
  label: string
): Promise<ProviderResult> {
  if (!apiKey) throw new Error(`${label}: API key not configured`);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: promptText }],
      temperature,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${label} (${res.status}): ${err}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${label}: empty response`);
  return { text, model };
}

function normalizeResponse(result: ProviderResult): Record<string, unknown> {
  return {
    candidates: [{ content: { parts: [{ text: result.text }], role: 'model' }, finishReason: 'STOP', index: 0 }],
    modelVersion: result.model,
    provider: result.model,
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { provider: rawProvider, promptText, temperature = 0.7 } = await req.json();
    if (!promptText) {
      return new Response(
        JSON.stringify({ error: { code: 400, message: 'promptText is required', status: 'BAD_REQUEST' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provider = (rawProvider || 'gemini').toLowerCase();
    let result: ProviderResult;

    switch (provider) {
      case 'gemini':
        result = await callGemini(promptText, temperature);
        break;
      case 'cerebras':
        result = await callOpenAICompatible(
          'https://api.cerebras.ai/v1/chat/completions', 'gpt-oss-120b',
          Deno.env.get('CEREBRAS_API_KEY'), promptText, temperature, 'Cerebras'
        );
        break;
      case 'groq':
        result = await callOpenAICompatible(
          'https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile',
          Deno.env.get('GROQ_API_KEY'), promptText, temperature, 'Groq'
        );
        break;
      case 'mistral':
        result = await callOpenAICompatible(
          'https://api.mistral.ai/v1/chat/completions', 'mistral-small-latest',
          Deno.env.get('MISTRAL_API_KEY'), promptText, temperature, 'Mistral'
        );
        break;
      default:
        return new Response(
          JSON.stringify({ error: { code: 400, message: `Unknown provider: ${provider}. Use: gemini, cerebras, groq, mistral`, status: 'BAD_REQUEST' } }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    const body = normalizeResponse(result);
    return new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: { code: 502, message: msg, status: 'PROVIDER_ERROR' } }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
