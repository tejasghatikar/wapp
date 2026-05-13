export function formatSaveList(saves, header = null) {
  if (!saves || saves.length === 0) {
    return "Nothing matches yet. Try saving a few places first by forwarding Instagram reels or typing 'Save <name> <area>'.";
  }

  const lines = [];
  if (header) lines.push(header, '');

  saves.forEach((s, i) => {
    const rating = s.google_rating ? `⭐${s.google_rating}` : '';
    const price = s.price_level ? '₹'.repeat(s.price_level) : '';
    const cuisine = s.cuisine_tags?.length ? s.cuisine_tags.slice(0, 2).join(', ') : '';
    const meta = [cuisine, price].filter(Boolean).join(' · ');

    lines.push(`${i + 1}. *${s.restaurant_name}*${s.area ? `, ${s.area}` : ''} ${rating}`);
    if (meta) lines.push(`   ${meta}`);
    if (s.google_maps_url) lines.push(`   📍 ${s.google_maps_url}`);
    lines.push('');
  });

  return lines.join('\n').trim();
}

export function formatCandidates(candidates) {
  const lines = ['I found a few options — reply with the number:', ''];
  candidates.forEach((c, i) => {
    const rating = c.rating ? `⭐${c.rating}` : '';
    lines.push(`${i + 1}. *${c.name}* ${rating}`);
    lines.push(`   ${c.address}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

export function formatSaveConfirmation(save) {
  const rating = save.google_rating ? `⭐${save.google_rating}` : '';
  const cuisine = save.cuisine_tags?.length ? save.cuisine_tags.slice(0, 2).join(', ') : '';
  const price = save.price_level ? '₹'.repeat(save.price_level) : '';
  const meta = [cuisine, price].filter(Boolean).join(' · ');

  return [
    `✅ Saved: *${save.restaurant_name}*${save.area ? `, ${save.area}` : ''}`,
    rating && meta ? `${rating} · ${meta}` : rating || meta,
    save.google_maps_url ? `📍 ${save.google_maps_url}` : '',
    '',
    `Reply with any notes if you want to add them, or just keep forwarding reels.`
  ]
    .filter(Boolean)
    .join('\n');
}
