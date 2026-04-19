import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const APP_VERSION = 'v14.2.0';
const FREE_LIMIT = 10;
const OPENAI_API_KEY_RAW = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_API_KEY = OPENAI_API_KEY_RAW;
const OPENAI_API_KEY_CONFIGURED = OPENAI_API_KEY.length >= 20
  && !OPENAI_API_KEY.toLowerCase().includes('put_your')
  && !OPENAI_API_KEY.endsWith('...');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE || 0.8);
const OPENAI_TOP_P = Number(process.env.OPENAI_TOP_P || 0.9);
const OPENAI_MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 420);
const REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 20000);
const ALLOWED_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const TRUST_PROXY_VALUE = String(process.env.TRUST_PROXY || '').trim().toLowerCase();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const riskWords = [
  'хочу умереть', 'не хочу жить', 'лучше бы меня не было', 'убить себя', 'покончить с собой',
  'сделать себе больно', 'порезать себя', 'причинить себе вред', 'суицид', 'суицидальные мысли',
  'убить кого-то', 'причинить вред другому', 'я опасен', 'я опасна', 'не вижу смысла жить',
  'i want to die', 'kill myself', 'hurt myself', 'suicide', 'self harm',
  'i want to hurt someone', 'i am going to hurt someone', 'я не в безопасности', 'я не в безпеці',
];

const stateKeywords = {
  anxiety: /(трев|паник|страх|опас|anx|panic|fear)/i,
  war_trauma: /(войн|сирен|обстр|птср|flashback|war|shell|air raid)/i,
  trauma: /(травм|триггер|спогад|flashback|trigger|trauma|nightmare|кошмар)/i,
  relationships: /(расстав|отнош|ревн|ex|breakup|love)/i,
  emotional: /(пусто|апат|нет сил|депресс|empty|depress|hopeless)/i,
  social: /(один|одиноч|изоляц|rejected|lonely|alone)/i,
  body: /(сон|бессон|кошмар|sleep|insom)/i,
  selfworth: /(стыд|вина|ненавижу себя|shame|guilt|hate myself)/i,
  stress: /(выгор|работ|деньг|burnout|stress|money|job)/i,
};

const categoryPrompts = {
  emotional: 'Focus on depressive states, emotional numbness, hopelessness, and gentle activation without pressure.',
  anxiety: 'Focus on anxiety relief, panic reduction, grounding, breathing, and restoring a sense of safety.',
  war_trauma: 'Write especially carefully about trauma, shelling, sirens, displacement, grief, and survivor guilt. Never minimize trauma.',
  trauma: 'Focus on triggers, flashbacks, dissociation, fear spikes, and helping the user return to the present without retelling the trauma in detail.',
  selfworth: 'Focus on shame, guilt, self-criticism, inner critic patterns, and rebuilding self-worth.',
  social: 'Focus on loneliness, fear of judgment, fear of rejection, and tiny safe social steps.',
  relationships: 'Focus on breakup pain, attachment wounds, jealousy, trust rupture, and emotional dependence.',
  addictions: 'Focus on impulse control, addiction patterns, procrastination, self-harm reduction, and safer next steps.',
  body: 'Focus on insomnia, exhaustion, psychosomatic symptoms, appetite, and body regulation.',
  stress: 'Focus on burnout, overload, financial and work stress, and realistic pacing.',
  existential: 'Focus on meaning crisis, identity, fear of the future, and finding small points of support.',
  critical: 'When risk is high, prioritize live help and immediate safety steps over reflection.',
};

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

const SUPPORTED_LANGUAGES = ['en','zh','hi','es','fr','ar','bn','pt','ja','de','ko','id','ur','uk','ru','be','kk'];
const LANGUAGE_ALIASES = { 'en-us': 'en', 'en-gb': 'en', 'zh-cn': 'zh', 'zh-tw': 'zh', 'hi-in': 'hi', 'es-es': 'es', 'es-mx': 'es', 'fr-fr': 'fr', 'ar-sa': 'ar', 'bn-bd': 'bn', 'pt-br': 'pt', 'ja-jp': 'ja', 'de-de': 'de', 'ko-kr': 'ko', 'id-id': 'id', 'ur-pk': 'ur', 'uk-ua': 'uk', 'ru-ru': 'ru', 'be-by': 'be', 'kk-kz': 'kk' };
function pickLang(language = 'en') {
  const normalized = String(language || '').toLowerCase().trim();
  const alias = LANGUAGE_ALIASES[normalized] || normalized.split('-')[0];
  return SUPPORTED_LANGUAGES.includes(alias) ? alias : 'en';
}
const LANGUAGE_REPLY_HINT = {
  en: 'Reply in English.', zh: 'Reply in Simplified Chinese.', hi: 'Reply in Hindi.', es: 'Reply in Spanish.', fr: 'Reply in French.', ar: 'Reply in Arabic.', bn: 'Reply in Bengali.', pt: 'Reply in Portuguese.', ja: 'Reply in Japanese.', de: 'Reply in German.', ko: 'Reply in Korean.', id: 'Reply in Indonesian.', ur: 'Reply in Urdu.', uk: 'Reply in Ukrainian.', ru: 'Reply in Russian.', be: 'Reply in Belarusian.', kk: 'Reply in Kazakh.'
};

function safeInteger(value, fallback = 0, min = 0, max = 100000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(Math.trunc(parsed), min, max);
}

function sanitizeRecentMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-8)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      text: String(item?.text || '').trim().slice(0, 4000),
    }))
    .filter((item) => item.text);
}

function localize(lang, ru, uk, en) {
  if (lang === 'uk') return uk;
  if (lang === 'ru') return ru;
  return en;
}

function containsRiskWords(text = '') {
  const lower = String(text || '').toLowerCase();
  return riskWords.some((word) => lower.includes(word));
}

function detectState(text = '', categoryKey = 'anxiety') {
  const sample = String(text || '');
  if (containsRiskWords(sample) || categoryKey === 'critical') return 'critical';
  for (const [key, rx] of Object.entries(stateKeywords)) {
    if (rx.test(sample) || categoryKey === key) return key;
  }
  return categoryKey || 'anxiety';
}

function normalizeWords(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function jaccardSimilarity(left = '', right = '') {
  const a = new Set(normalizeWords(left));
  const b = new Set(normalizeWords(right));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function fallbackReply({ language = 'ru', subcategory = 'Support', categoryKey = 'anxiety', lastUserMessage = '' }) {
  const lang = pickLang(language);
  const state = detectState(lastUserMessage, categoryKey);
  const opening = localize(
    lang,
    'Я рядом. Спасибо, что написал(а). Давай очень спокойно разберём это по шагам.',
    'Я поруч. Дякую, що написав(ла). Давай дуже спокійно розберемо це по кроках.',
    'I am here. Thank you for writing. Let us take this one gentle step at a time.',
  );
  const bodyMap = {
    anxiety: localize(lang, 'Похоже, нервная система сейчас перегружена тревогой: тело, мысли и ожидание опасности усиливают друг друга.', 'Схоже, нервова система зараз перевантажена тривогою: тіло, думки й очікування небезпеки підсилюють одне одного.', 'It sounds like your nervous system is overloaded by anxiety: body sensations, thoughts, and threat expectation are feeding each other.'),
    war_trauma: localize(lang, 'После травмы нервная система может долго реагировать так, будто опасность всё ещё рядом. Это не слабость.', 'Після травми нервова система може довго реагувати так, ніби небезпека досі поруч. Це не слабкість.', 'After trauma, the nervous system can keep reacting as if danger is still close. That is not weakness.'),
    trauma: localize(lang, 'Триггер или флэшбек могут резко вернуть ощущение угрозы. Сейчас важнее мягко вернуться в настоящее, чем разбирать детали травмы.', 'Тригер або флешбек можуть різко повернути відчуття загрози. Зараз важливіше м’яко повернутися в теперішнє, ніж розбирати деталі травми.', 'A trigger or flashback can abruptly bring danger back into the room. Right now it is more important to return gently to the present than to unpack the trauma details.'),
    body: localize(lang, 'Когда напряжение держится долго, оно часто уходит в тело: сон, дыхание, напряжение мышц и усталость.', 'Коли напруга тримається довго, вона часто йде в тіло: сон, дихання, м\'язи та втому.', 'When stress runs too long, it often moves into the body: sleep, breathing, muscle tension, and exhaustion.'),
    selfworth: localize(lang, 'Стыд и самокритика умеют делать боль тотальной, будто проблема не в ситуации, а в тебе целиком.', 'Сором і самокритика вміють робити біль тотальним, ніби проблема не в ситуації, а в тобі повністю.', 'Shame and self-criticism can make pain feel total, as if the whole problem is you instead of the situation.'),
  };
  const body = bodyMap[state] || localize(lang, 'Сейчас эмоции, тело и мысли могли переплестись в один тяжёлый узел. Это бывает при перегрузе.', 'Зараз емоції, тіло й думки могли сплестися в один важкий вузол. Так буває при перевантаженні.', 'Right now emotions, body reactions, and thoughts may be tangled into one heavy knot. That happens in overload.');
  const practice = localize(lang, 'На ближайшую минуту: поставь обе стопы на пол, сделай 5 длинных выдохов и назови 3 предмета вокруг.', 'На найближчу хвилину: постав обидві стопи на підлогу, зроби 5 довгих видихів і назви 3 предмети навколо.', 'For the next minute: place both feet on the floor, take 5 long exhales, and name 3 objects around you.');
  const nextStep = localize(lang, `Один маленький шаг на ближайшие 10 минут для темы «${subcategory}»: вода, душ, воздух, еда или короткое сообщение близкому человеку.`, `Один маленький крок на найближчі 10 хвилин для теми «${subcategory}»: вода, душ, повітря, їжа або коротке повідомлення близькій людині.`, `One small step for the next 10 minutes around “${subcategory}”: water, a shower, fresh air, food, or a short message to someone safe.`);
  const closing = localize(lang, 'Если хочешь, напиши одну самую тяжёлую мысль прямо сейчас — разберём её точнее.', 'Якщо хочеш, напиши одну найважчу думку прямо зараз — розберемо її точніше.', 'If you want, send the hardest thought you are carrying right now and we will work through it more precisely.');
  return [opening, body, practice, nextStep, closing].join('\n\n');
}

function buildInstructions({ language = 'ru', categoryKey = 'anxiety', categoryTitle = '', subcategory = '' }) {
  const lang = pickLang(language);
  const languageHint = LANGUAGE_REPLY_HINT[lang] || 'Reply in English.';
  const categoryPrompt = categoryPrompts[categoryKey] || categoryPrompts.anxiety;
  return [
    languageHint,
    'You are HopeBridge, a warm but practical emotional support assistant inside a mental wellness app.',
    'Be empathetic, calm, specific, and modern. Avoid robotic repetition, empty platitudes, and generic motivational fluff.',
    'Write 4 short paragraphs maximum. Prefer concrete grounding, micro-steps, and reflective questions.',
    'Do not claim to be a therapist or diagnose. Do not provide dangerous instructions.',
    'If the user shows immediate self-harm or violence risk, tell them to seek live human help and immediate safety.',
    `Current theme: ${categoryTitle || categoryKey}. Subtopic: ${subcategory || 'support'}.`,
    categoryPrompt,
  ].join(' ');
}

function extractResponseText(payload) {
  if (!payload) return '';
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  if (!Array.isArray(payload.output)) return '';
  const chunks = [];
  for (const item of payload.output) {
    if (item?.type === 'message' && Array.isArray(item?.content)) {
      for (const content of item.content) {
        if (content?.type === 'output_text' && typeof content.text === 'string') {
          chunks.push(content.text.trim());
        }
      }
    }
  }
  return chunks.filter(Boolean).join('\n\n').trim();
}

async function callResponsesApi({ instructions, input, temperature, topP, maxOutputTokens }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions,
        input,
        temperature,
        top_p: topP,
        max_output_tokens: maxOutputTokens,
        store: false,
      }),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = json?.error?.message || `responses_api_${response.status}`;
      throw new Error(detail);
    }
    return extractResponseText(json);
  } finally {
    clearTimeout(timeout);
  }
}

function recentAssistantReply(recentMessages = []) {
  return [...recentMessages].reverse().find((item) => item?.role === 'assistant' && item?.text)?.text || '';
}

function buildTranscript({ recentMessages = [], categoryTitle = '', subcategory = '', lastUserMessage = '' }) {
  const context = recentMessages
    .slice(-8)
    .map((item) => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${String(item.text || '').trim()}`)
    .filter(Boolean)
    .join('\n');
  return [
    `Category: ${categoryTitle || 'Support'}`,
    `Subcategory: ${subcategory || 'General'}`,
    context ? `Recent conversation:\n${context}` : '',
    `Current user message: ${String(lastUserMessage || '').trim()}`,
  ].filter(Boolean).join('\n\n');
}

const baseLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 80, standardHeaders: true, legacyHeaders: false });

app.disable('x-powered-by');
if (TRUST_PROXY_VALUE === 'true') app.set('trust proxy', true);
else if (TRUST_PROXY_VALUE === 'false' || TRUST_PROXY_VALUE === '') app.set('trust proxy', false);
else if (!Number.isNaN(Number(TRUST_PROXY_VALUE))) app.set('trust proxy', Number(TRUST_PROXY_VALUE));
else app.set('trust proxy', TRUST_PROXY_VALUE);

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }
    if (!ALLOWED_ORIGINS.length && !IS_PRODUCTION) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin not allowed by CORS'));
  },
}));
app.use(baseLimiter);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setTimeout(REQUEST_TIMEOUT_MS + 5000);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'ai-support-backend',
    version: APP_VERSION,
    freeLimit: FREE_LIMIT,
    aiConfigured: OPENAI_API_KEY_CONFIGURED,
    model: OPENAI_MODEL,
    transcribeModel: TRANSCRIBE_MODEL,
  });
});

app.post('/chat-support', aiLimiter, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const categoryKey = String(body.categoryKey || 'anxiety').trim() || 'anxiety';
    const categoryTitle = String(body.categoryTitle || '').trim().slice(0, 120);
    const subcategory = String(body.subcategory || 'Support').trim().slice(0, 120) || 'Support';
    const lastUserMessage = String(body.lastUserMessage || '').trim().slice(0, 8000);
    const recentMessages = sanitizeRecentMessages(body.recentMessages);
    const isPremium = Boolean(body.isPremium);
    const freeMessagesUsed = safeInteger(body.freeMessagesUsed, 0, 0, 100000);
    const language = pickLang(body.language);

    if (!lastUserMessage) {
      return res.status(400).json({ ok: false, reply: 'Missing lastUserMessage' });
    }

    const lang = language;
    const highRisk = containsRiskWords(lastUserMessage) || categoryKey === 'critical';
    if (highRisk) {
      return res.json({
        ok: true,
        reply: localize(
          lang,
          'Мне очень жаль, что тебе сейчас настолько тяжело. Сейчас важнее безопасность: не оставайся один/одна, убери опасные предметы и срочно свяжись с близким человеком, кризисной линией или экстренной службой.',
          'Мені дуже шкода, що зараз настільки важко. Зараз найважливіша безпека: не залишайся наодинці, прибери небезпечні предмети й терміново зв’яжися з близькою людиною, кризовою лінією або екстреною службою.',
          'I am very sorry this feels so intense right now. Safety comes first: do not stay alone, move dangerous objects away, and urgently contact a trusted person, a crisis line, or emergency services.'
        ),
        riskLevel: 'high',
        showCrisisBanner: true,
        paywallRequired: false,
        freeMessagesUsed,
      });
    }

    if (!isPremium && freeMessagesUsed >= FREE_LIMIT) {
      return res.json({ ok: true, reply: '', riskLevel: 'low', showCrisisBanner: false, paywallRequired: true, freeMessagesUsed });
    }

    if (!OPENAI_API_KEY_CONFIGURED) {
      return res.json({
        ok: true,
        reply: fallbackReply({ language: lang, subcategory, categoryKey, lastUserMessage }),
        riskLevel: 'low',
        showCrisisBanner: false,
        paywallRequired: false,
        freeMessagesUsed: freeMessagesUsed + 1,
        source: 'fallback',
      });
    }

    const transcript = buildTranscript({ recentMessages, categoryTitle, subcategory, lastUserMessage });
    const instructions = buildInstructions({ language: lang, categoryKey: detectState(lastUserMessage, categoryKey), categoryTitle, subcategory });
    const previousAssistant = recentAssistantReply(recentMessages);

    let answer = await callResponsesApi({
      instructions,
      input: transcript,
      temperature: clamp(OPENAI_TEMPERATURE, 0, 2),
      topP: clamp(OPENAI_TOP_P, 0, 1),
      maxOutputTokens: clamp(OPENAI_MAX_OUTPUT_TOKENS, 120, 1200),
    });

    if (!answer) {
      answer = fallbackReply({ language: lang, subcategory, categoryKey, lastUserMessage });
    }

    if (previousAssistant && jaccardSimilarity(answer, previousAssistant) >= 0.72) {
      const retryInput = `${transcript}\n\nImportant: do not repeat prior assistant wording. Offer a different framing, different concrete steps, and a fresh question.`;
      const retried = await callResponsesApi({
        instructions,
        input: retryInput,
        temperature: clamp(OPENAI_TEMPERATURE + 0.1, 0, 2),
        topP: clamp(OPENAI_TOP_P, 0, 1),
        maxOutputTokens: clamp(OPENAI_MAX_OUTPUT_TOKENS, 120, 1200),
      }).catch(() => '');
      if (retried && jaccardSimilarity(retried, previousAssistant) < 0.72) {
        answer = retried;
      }
    }

    return res.json({
      ok: true,
      reply: answer,
      riskLevel: 'low',
      showCrisisBanner: false,
      paywallRequired: false,
      freeMessagesUsed: freeMessagesUsed + 1,
      source: 'responses_api',
    });
  } catch (error) {
    return res.status(200).json({
      ok: true,
      reply: fallbackReply({ language: pickLang(req.body?.language || 'en'), subcategory: req.body?.subcategory || 'Support', categoryKey: req.body?.categoryKey || 'anxiety', lastUserMessage: req.body?.lastUserMessage || '' }),
      riskLevel: 'low',
      showCrisisBanner: false,
      paywallRequired: false,
      freeMessagesUsed: safeInteger(req.body?.freeMessagesUsed, 0, 0, 100000) + 1,
      source: 'fallback_on_error',
    });
  }
});

app.post('/transcribe', aiLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!OPENAI_API_KEY_CONFIGURED) {
      return res.status(503).json({ ok: false, text: '', error: 'OPENAI_API_KEY is not configured' });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ ok: false, text: '', error: 'Audio file is required' });
    }

    const form = new FormData();
    form.append('model', TRANSCRIBE_MODEL);
    const transcriptionLanguage = pickLang(req.body?.language);
    if (transcriptionLanguage) {
      form.append('language', transcriptionLanguage);
    }
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/m4a' }), req.file.originalname || 'voice.m4a');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ ok: false, text: '', error: json?.error?.message || 'transcription_failed' });
    }

    return res.json({ ok: true, text: String(json?.text || '').trim() });
  } catch (error) {
    return res.status(500).json({ ok: false, text: '', error: error?.message || 'transcription_failed' });
  }
});

app.use((err, req, res, next) => {
  if (err?.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ ok: false, error: err.message });
  }
  return res.status(500).json({ ok: false, error: err?.message || 'internal_server_error' });
});

app.listen(port, () => {
  console.log(`[HopeBridge] backend listening on http://localhost:${port} (${APP_VERSION})`);
});
