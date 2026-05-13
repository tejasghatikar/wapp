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
    if (s._friends_who_saved?.length) {
      lines.push(`   👥 Also saved by ${s._friends_who_saved.join(', ')}`);
    }
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

export function formatSaveConfirmation(save, { askStatus = false } = {}) {
  const rating = save.google_rating ? `⭐${save.google_rating}` : '';
  const cuisine = save.cuisine_tags?.length ? save.cuisine_tags.slice(0, 2).join(', ') : '';
  const price = save.price_level ? '₹'.repeat(save.price_level) : '';
  const meta = [cuisine, price].filter(Boolean).join(' · ');

  const lines = [
    `✅ Saved: *${save.restaurant_name}*${save.area ? `, ${save.area}` : ''}`,
    rating && meta ? `${rating} · ${meta}` : rating || meta,
    save.google_maps_url ? `📍 ${save.google_maps_url}` : ''
  ].filter(Boolean);

  if (askStatus) {
    lines.push(
      '',
      'Have you been here?',
      "1 · Haven't been — *want to go*",
      '2 · *Been here* before'
    );
  } else {
    lines.push('', 'Add a note: *note your text here* (attached to your latest save).');
  }

  return lines.join('\n');
}

export function formatStatusUpdated(save, status) {
  const label = status === 'been_there' ? 'Been there' : 'Want to go';
  return `Got it. *${save.restaurant_name}* marked as *${label}*.`;
}
