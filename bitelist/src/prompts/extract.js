export const extractionPrompt = (rawText) => `You extract restaurant information from Instagram reel metadata for an Indian user in Bangalore.

Input text (caption / og-description from Instagram):
"""
${rawText}
"""

Return ONLY valid JSON, no preamble or markdown. Schema:
{
  "restaurant_name": string,
  "area": string | null,
  "city": string,
  "cuisine_hints": string[],
  "confidence": number
}

Rules:
- "area" = Bangalore neighborhood like "Indiranagar", "JP Nagar", "Koramangala", "HSR Layout", "Whitefield", "MG Road", "Jayanagar", "Malleshwaram", "Brigade Road", "Church Street". Null if not mentioned.
- "city" = "Bangalore" by default. Only change if another Indian city is clearly mentioned.
- "confidence" = 0.0 to 1.0. Rate how sure you are about the restaurant name.
  - >0.8: restaurant name explicitly mentioned and unambiguous
  - 0.5-0.8: name inferred from context but reasonable
  - <0.5: unclear, ambiguous, or generic content
- "cuisine_hints": lowercase tags from this list when applicable: italian, chinese, indian, north indian, south indian, biryani, cafe, microbrewery, bar, pub, vegetarian, vegan, continental, japanese, thai, mexican, pizza, dessert, bakery, coffee.

If the input is clearly NOT about a restaurant, return: {"restaurant_name": "", "area": null, "city": "Bangalore", "cuisine_hints": [], "confidence": 0}`;
