
export interface StoryRequest {
  topics: string[];
  level: "A1" | "A2" | "B1" | "B2";
  length: "Short" | "Medium" | "Long";
  vocabularyWords: {
    german: string;
    english: string;
  }[];
}

export interface StoryResponse {
  title: string;
  germanText: string;
  englishTranslation: string;
  level: string;
  topics: string[];
  wordsUsed: string[];
}

interface ParsedStory {
  title?: string;
  germanText?: string;
  englishTranslation?: string;
}

// Safely parse JSON returned by Groq.
function extractJson(text: string): ParsedStory {
  let cleaned = text.trim();

  // Remove optional Markdown code fences.
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as ParsedStory;
  } catch {
    // Fallback: extract the JSON object.
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const jsonText = cleaned.slice(
        firstBrace,
        lastBrace + 1
      );

      try {
        return JSON.parse(jsonText) as ParsedStory;
      } catch {
        throw new Error(
          "Groq returned invalid JSON. Please try again."
        );
      }
    }

    throw new Error(
      "Could not parse the story returned by Groq."
    );
  }
}

export async function generateGermanStory(
  req: StoryRequest
): Promise<StoryResponse> {

  const apiKey = import.meta.env.VITE_GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Groq API key not found. Check VITE_GROQ_API_KEY in your environment variables."
    );
  }

  // Keep requests reasonably small.
  const vocabulary = req.vocabularyWords.slice(0, 25);

  const lengthGuide: Record<StoryRequest["length"], string> = {
    Short: "50-70 words",
    Medium: "100-140 words",
    Long: "180-220 words"
  };

  const topicList = req.topics.length
    ? req.topics.join(", ")
    : "Everyday life";

  const vocabularyList = vocabulary
    .map(
      word => `${word.german} (English: ${word.english})`
    )
    .join("\n");

  const systemPrompt = `
You are an experienced German language teacher.

Generate German learning stories.
Always return valid JSON.
Do not use Markdown code fences.
Do not add explanations outside the JSON.
`;

  const userPrompt = `
Create a natural German story for a ${req.level} CEFR learner.

TOPICS:
${topicList}

LENGTH:
${lengthGuide[req.length]}

VOCABULARY:
${vocabularyList}

RULES:
1. Use the supplied German vocabulary naturally.
2. Highlight vocabulary in the German story using <strong>word</strong>.
3. Keep grammar and sentence structure appropriate for ${req.level}.
4. Write a complete, natural English translation.
5. Do not add introductions or explanations.
6. Keep the story within the requested length.

Return exactly this JSON structure:

{
  "title": "German title (English title)",
  "germanText": "German story with <strong>highlighted</strong> words",
  "englishTranslation": "Complete English translation"
}
`;

  const endpoint =
    "https://api.groq.com/openai/v1/chat/completions";

  const startTime = Date.now();

  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",

        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],

        // Ask Groq to return valid JSON.
        response_format: {
          type: "json_object"
        },

        // Use non-thinking mode for a simple story task.
        reasoning_effort: "none",

        temperature: 0.7,
        top_p: 0.8,
        max_completion_tokens: 1200,
        stream: false
      })
    });
  } catch (error) {
    console.error("Groq network error:", error);

    throw new Error(
      "Could not connect to Groq. Check your internet connection."
    );
  }

  console.log(
    "Groq request completed in:",
    ((Date.now() - startTime) / 1000).toFixed(2),
    "seconds"
  );

  if (!response.ok) {
    const errorText = await response.text();

    console.error("Groq API error:", errorText);

    let message = `Groq API error (${response.status})`;

    try {
      const errorData = JSON.parse(errorText);
      message = errorData?.error?.message || message;
    } catch {
      // Keep the default error message.
    }

    throw new Error(message);
  }

  const data = await response.json();

  const rawContent =
    data?.choices?.[0]?.message?.content;

  if (
    typeof rawContent !== "string" ||
    !rawContent.trim()
  ) {
    console.error("Unexpected Groq response:", data);

    throw new Error(
      "Groq returned an empty response. Please try again."
    );
  }

  if (data?.choices?.[0]?.finish_reason === "length") {
    throw new Error(
      "The story was cut off. Please try a shorter story or fewer vocabulary words."
    );
  }

  const parsed = extractJson(rawContent);

  if (!parsed.germanText?.trim()) {
    throw new Error(
      "Groq did not return a German story. Please try again."
    );
  }

  if (!parsed.englishTranslation?.trim()) {
    throw new Error(
      "Groq did not return an English translation. Please try again."
    );
  }

  return {
    title: parsed.title?.trim() || "Deutsche Geschichte",
    germanText: parsed.germanText.trim(),
    englishTranslation: parsed.englishTranslation.trim(),
    level: req.level,
    topics: req.topics.length
      ? req.topics
      : ["General"],
    wordsUsed: vocabulary.map(
      word => `${word.german} = ${word.english}`
    )
  };
}
