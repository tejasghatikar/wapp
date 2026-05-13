export const queryPrompt = (userQuery, userSaves) => {
  const compact = userSaves.map((s) => ({
    id: s.id,
    name: s.restaurant_name,
    area: s.area,
    rating: s.google_rating,
    price_level: s.price_level,
    cuisine_tags: s.cuisine_tags
  }));

  return `You help a user find restaurants from their personal saved list.

User's saved restaurants (JSON):
${JSON.stringify(compact, null, 2)}

User's query: "${userQuery}"

Return ONLY valid JSON. Schema:
{
  "matched_ids": string[],
  "reasoning": string
}

Matching rules:
- If query mentions an area (Indiranagar, JP Nagar, Koramangala, etc.), filter to that area first.
- If query mentions cuisine (italian, drinks, biryani, coffee, etc.), filter to matching cuisine_tags.
- If query mentions vibe ("date", "casual", "fancy", "drinks"), use cuisine_tags + price_level as proxies. Pubs/microbreweries match "drinks". Higher price_level matches "fancy". Cafes match "casual".
- If query is generic ("where should I eat", "any recos"), return top-rated saves by rating.
- Always cap at 5 results, ordered most-relevant first.
- If no good matches, return empty matched_ids array.
- "reasoning" is one short internal line, never shown to user.

Be liberal in interpretation. Indian users often mix English with Hindi/Kannada — "khaane ka kuch achha hai?" = "is there something good to eat?" Map to top-rated.`;
};
