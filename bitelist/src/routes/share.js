import express from 'express';
import { configIncomplete, missingEnvKeys } from '../config.js';
import { getUserBySlug, getRecentSaves } from '../services/db.js';

export const shareRouter = express.Router();

shareRouter.get('/list/:slug', async (req, res) => {
  if (configIncomplete) {
    res
      .status(503)
      .type('text')
      .send(`BiteList is not fully configured yet.\n\nMissing: ${missingEnvKeys.join(', ')}\n`);
    return;
  }

  const user = await getUserBySlug(req.params.slug);
  if (!user) {
    res.status(404).send('List not found');
    return;
  }

  const saves = await getRecentSaves(user.id, 50);

  res.set('Content-Type', 'text/html');
  res.send(renderList(saves, user.display_name));
});

function renderList(saves, ownerName) {
  const ownerLabel = ownerName ? `${ownerName}'s` : 'A BiteList';
  const escape = (s) =>
    String(s || '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  const cards = saves
    .map(
      (s) => `
    <div class="card">
      <h3>${escape(s.restaurant_name)}</h3>
      <div class="meta">
        ${s.area ? `<span>${escape(s.area)}</span>` : ''}
        ${s.google_rating ? `<span>⭐ ${s.google_rating}</span>` : ''}
        ${s.price_level ? `<span>${'₹'.repeat(s.price_level)}</span>` : ''}
      </div>
      ${s.cuisine_tags?.length ? `<div class="tags">${s.cuisine_tags.map((t) => `<span class="tag">${escape(t)}</span>`).join(' ')}</div>` : ''}
      ${s.google_maps_url ? `<a class="maps" href="${escape(s.google_maps_url)}" target="_blank" rel="noopener">Open in Maps →</a>` : ''}
    </div>
  `
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(ownerLabel)} restaurant list — BiteList</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px 16px; background: #fafafa; color: #222; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .sub { color: #888; font-size: 14px; margin-bottom: 24px; }
    .card { background: white; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .card h3 { margin: 0 0 6px; font-size: 17px; }
    .meta { color: #666; font-size: 13px; display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
    .tags { margin: 8px 0; }
    .tag { display: inline-block; background: #f0f0f0; padding: 2px 8px; border-radius: 10px; font-size: 12px; margin-right: 6px; }
    .maps { color: #0066cc; font-size: 14px; text-decoration: none; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <h1>${escape(ownerLabel)} restaurant list</h1>
  <div class="sub">${saves.length} saved place${saves.length === 1 ? '' : 's'}</div>
  ${cards || '<p style="color:#888">No saves yet.</p>'}
  <div class="footer">Powered by BiteList — WhatsApp restaurant memory for Bangalore</div>
</body>
</html>`;
}
