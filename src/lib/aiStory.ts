
export async function generateGermanStory(
  req: StoryRequest
): Promise<StoryResponse> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Gemini API key not found.");
  }

  const startedAt = performance.now();

  // Limit vocabulary to keep prompts manageable.
  const selectedWords = req.vocabularyWords.slice(0, 20);

  const lengthGuide = {
    Short: "50-70 words",
    Medium: "100-140 words",
    Long: "180-220 words"
  }[req.length];

  const topicList = req.topics.length
    ? req.topics.join(", ")
    : "Everyday life";

  const vocabSample = selectedWords
    .map(w => `${w.german} (${w.english})`)
    .join(", ");

  const prompt = `
Write a natural German story for a ${req.level} CEFR learner.

Topics: ${topicList}
Length: ${lengthGuide}

Use these vocabulary words naturally:
${vocabSample}

Highlight vocabulary with <strong>word</strong>.

Keep sentences and grammar appropriate for ${req.level}.
Avoid unnecessary introductions and explanations.

Return exactly:
[TITLE]
German title

[GERMAN]
German story

[ENGLISH]
English translation
`;

  // Lightweight model to benchmark.
  const model = "gemini-3.5-flash-lite";

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 700,
        thinkingConfig: {
          thinkingLevel: "minimal"
        }
      }
    })
  });

  console.log(
    "Gemini response headers received:",
    ((performance.now() - startedAt) / 1000).toFixed(2),
    "seconds"
  );

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    throw new Error(
      errorJson?.error?.message ||
      `Google API error (${response.status})`
    );
  }

  const data = await response.json();

  const rawText =
    data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("") || "";

  console.log(
    "Complete story generated in:",
    ((performance.now() - startedAt) / 1000).toFixed(2),
    "seconds"
  );

  if (!rawText.trim()) {
    throw new Error("The AI model returned no text.");
  }

  const extract = (tag: string, nextTag?: string) => {
    const pattern = nextTag
      ? new RegExp(
          `\\[${tag}\\]([\\s\\S]*?)\\[${nextTag}\\]`,
          "i"
        )
      : new RegExp(`\\[${tag}\\]([\\s\\S]*)$`, "i");

    return rawText.match(pattern)?.[1]?.trim() || "";
  };

  const title = extract("TITLE", "GERMAN") || "Deutsche Geschichte";
  const germanText = extract("GERMAN", "ENGLISH");
  const englishTranslation = extract("ENGLISH");

  if (!germanText) {
    throw new Error("Could not extract the German story.");
  }

  return {
    title,
    germanText,
    englishTranslation,
    level: req.level,
    topics: req.topics.length ? req.topics : ["General"],
    wordsUsed: selectedWords.map(
      w => `${w.german} = ${w.english}`
    )
  };
}
