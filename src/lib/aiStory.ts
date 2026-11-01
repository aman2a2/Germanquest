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
    throw new Error('API key not found. Please verify VITE_GEMINI_API_KEY in your Netlify / environment settings.');
  }

  const lengthGuide = req.length === 'Short' ? '50-70 words' : req.length === 'Medium' ? '100-140 words' : '180-220 words';
  const topicList = req.topics.length ? req.topics.join(', ') : 'Everyday life';
  const vocabSample = req.vocabularyWords.map(w => `${w.german} (${w.english})`).join(', ');

  // Direct, concise instruction without complex JSON constraints for minimum latency
  const prompt = `Write a short German story for a ${req.level} learner.
Topics: ${topicList}
Length: ${lengthGuide}
Include these words with <strong>word</strong> around them: ${vocabSample}

Format your output exactly with these three section tags and no other text:
[TITLE]
German title (English translation)
[GERMAN]
The German story here...
[ENGLISH]
The English translation here...`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800,
        thinkingConfig: {
          thinkingLevel: 'low',
          thinkingBudget: 0
        }
      }
    })
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    throw new Error(errorJson?.error?.message || `Google API error (Status ${response.status})`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  if (!rawText.trim()) {
    throw new Error('The AI model did not return any text.');
  }

  // Fast parsing via delimiters
  let title = 'Deutsche Geschichte';
  let germanText = '';
  let englishTranslation = '';

  const titleMatch = rawText.match(/\[TITLE\]([\s\S]*?)(?=\[GERMAN\]|$)/i);
  const germanMatch = rawText.match(/\[GERMAN\]([\s\S]*?)(?=\[ENGLISH\]|$)/i);
  const englishMatch = rawText.match(/\[ENGLISH\]([\s\S]*?)$/i);

  if (titleMatch && titleMatch[1].trim()) title = titleMatch[1].trim();
  if (germanMatch && germanMatch[1].trim()) germanText = germanMatch[1].trim();
  if (englishMatch && englishMatch[1].trim()) englishTranslation = englishMatch[1].trim();

  // Fallback in case the model outputs plain text
  if (!germanText) {
    germanText = rawText.replace(/\[TITLE\]|\[GERMAN\]|\[ENGLISH\]/gi, '').trim();
    englishTranslation = 'Translation available on next generation.';
  }

  return {
    title,
    germanText,
    englishTranslation,
    level: req.level,
    topics: req.topics.length ? req.topics : ['General'],
    wordsUsed: req.vocabularyWords.map(w => `${w.german} = ${w.english}`)
  };
}