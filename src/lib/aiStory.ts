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

  const lengthGuide = req.length === 'Short' ? '~70 words' : req.length === 'Medium' ? '~150 words' : '~250 words';
  const topicList = req.topics.length ? req.topics.join(', ') : 'Everyday life';
  const vocabSample = req.vocabularyWords.map(w => `${w.german} (${w.english})`).join(', ');

  const prompt = `You are a German language teacher. Write a coherent German story tailored for a ${req.level} CEFR learner.
Topics: ${topicList}
Target Length: Approximately ${lengthGuide}.
Vocabulary to include naturally: ${vocabSample}.

Formatting instructions:
1. Wrap each used vocabulary word or target phrase in <strong>word</strong> tags in the German story text so it is highlighted.
2. The vocabulary, sentence structure, and grammar must strictly match CEFR ${req.level} difficulty.
3. Provide a complete, natural English translation.

Return ONLY a valid JSON object matching this schema without any markdown formatting or backticks:
{
  "title": "German title with English meaning in parentheses",
  "germanText": "The German story with <strong>highlighted</strong> words...",
  "englishTranslation": "The full English translation...",
  "wordsUsed": ["der Tisch = table", "laufen = to run"]
}`;

  // Using the supported gemini-2.5-flash model on v1beta
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7
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