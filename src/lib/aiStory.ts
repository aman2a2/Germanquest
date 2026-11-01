export interface StoryRequest {
  topics: string[];
  level: 'A1' | 'A2' | 'B1' | 'B2';
  length: 'Short' | 'Medium' | 'Long';
  vocabularyWords: { german: string; english: string }[];
}

export interface StoryResponse {
  title: string;
  germanText: string;
  englishTranslation: string;
  level: string;
  topics: string[];
  wordsUsed: string[];
}

export async function generateGermanStory(req: StoryRequest): Promise<StoryResponse> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('API key not found. Please add VITE_GEMINI_API_KEY to your .env file and restart the server.');
  }

  const lengthGuide = req.length === 'Short' ? '~70 words' : req.length === 'Medium' ? '~140 words' : '~220 words';
  const topicList = req.topics.length ? req.topics.join(', ') : 'Everyday life';
  const vocabSample = req.vocabularyWords.map(w => `${w.german} (${w.english})`).join(', ');

  const prompt = `You are a German teacher. Write a short story for a ${req.level} CEFR learner.
Topics: ${topicList}
Length: ${lengthGuide}.
Vocabulary to include naturally: ${vocabSample}.

Instructions:
1. Wrap each used target vocabulary word in <strong>word</strong> tags in the German story text.
2. Grammar and vocabulary must match CEFR ${req.level}.
3. Provide an English translation.

Return ONLY a valid JSON object matching this schema without any markdown formatting or backticks:
{
  "title": "German title with English meaning in parentheses",
  "germanText": "The German story with <strong>highlighted</strong> words...",
  "englishTranslation": "The full English translation...",
  "wordsUsed": ["der Tisch = table", "laufen = to run"]
}`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7,
        maxOutputTokens: 1000,
        // Reduces internal reasoning latency from minutes down to seconds
        thinkingConfig: {
          thinkingLevel: 'low'
        }
      }
    })
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    throw new Error(errorJson?.error?.message || `Google API error (Status ${response.status})`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('The AI model did not return any text.');
  }

  const parsed = JSON.parse(rawText);
  return {
    title: parsed.title || 'Deutsche Geschichte',
    germanText: parsed.germanText || '',
    englishTranslation: parsed.englishTranslation || '',
    level: req.level,
    topics: req.topics.length ? req.topics : ['General'],
    wordsUsed: Array.isArray(parsed.wordsUsed) && parsed.wordsUsed.length 
      ? parsed.wordsUsed 
      : req.vocabularyWords.map(w => `${w.german} = ${w.english}`)
  };
}