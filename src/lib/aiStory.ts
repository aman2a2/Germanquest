
export async function generateGermanStory(
  req: StoryRequest
): Promise<StoryResponse> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Gemini API key is missing.");
  }

  const model = "gemini-3.5-flash-lite";

  const lengthGuide: Record<StoryRequest["length"], string> = {
    Short: "50-70 words",
    Medium: "100-140 words",
    Long: "180-220 words"
  };

  // Limit vocabulary to avoid unnecessarily large prompts.
  const vocabulary = req.vocabularyWords.slice(0, 20);

  const topics = req.topics.length
    ? req.topics.join(", ")
    : "Everyday life";

  const words = vocabulary
    .map(word => `${word.german} (${word.english})`)
    .join(", ");

  const prompt = `
Write a natural German story for a ${req.level} learner.

Topics: ${topics}
Story length: ${lengthGuide[req.length]}

Use these German vocabulary words naturally:
${words}

Requirements:
- Use grammar appropriate for ${req.level}.
- Highlight selected vocabulary using <strong>word</strong>.
- Do not force words into unnatural sentences.
- Write a complete English translation.
- Do not include explanations outside the requested format.

Return exactly this format:

[TITLE]
German story title

[GERMAN]
German story

[ENGLISH]
English translation
`;

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const startTime = Date.now();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        maxOutputTokens: 900,
        thinkingConfig: {
          thinkingLevel: "minimal"
        }
      }
    })
  });

  console.log(
    "Gemini request time:",
    ((Date.now() - startTime) / 1000).toFixed(2),
    "seconds"
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(
      errorData?.error?.message ||
      `Gemini API error: ${response.status}`
    );
  }

  const data = await response.json();

  const rawText: string =
    data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("") || "";

  console.log(
    "Total generation time:",
    ((Date.now() - startTime) / 1000).toFixed(2),
    "seconds"
  );

  if (!rawText.trim()) {
    throw new Error("Gemini returned an empty story.");
  }

  // Extract the three sections.
  const extractSection = (
    text: string,
    section: string,
    nextSection?: string
  ): string => {
    const startTag = `[${section}]`;
    const startIndex = text.indexOf(startTag);

    if (startIndex === -1) {
      return "";
    }

    const contentStart = startIndex + startTag.length;

    const endIndex = nextSection
      ? text.indexOf(`[${nextSection}]`, contentStart)
      : -1;

    return text
      .slice(
        contentStart,
        endIndex === -1 ? undefined : endIndex
      )
      .trim();
  };

  const title =
    extractSection(rawText, "TITLE", "GERMAN") ||
    "Deutsche Geschichte";

  const germanText =
    extractSection(rawText, "GERMAN", "ENGLISH");

  const englishTranslation =
    extractSection(rawText, "ENGLISH");

  if (!germanText) {
    throw new Error(
      "Could not extract the German story. Please try again."
    );
  }

  return {
    title,
    germanText,
    englishTranslation,
    level: req.level,
    topics: req.topics.length
      ? req.topics
      : ["General"],
    wordsUsed: vocabulary.map(
      word => `${word.german} = ${word.english}`
    )
  };
}
