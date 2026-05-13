import express from 'express';
import { config, configIncomplete, missingEnvKeys } from '../config.js';
import {
  getUserBySlug,
  getRecentSaves,
  getMutualSaves,
  getNewForUser,
  createCompareSession
} from '../services/db.js';
import { logger } from '../utils/logger.js';

export const shareRouter = express.Router();

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function configGate(res) {
  if (configIncomplete) {
    res
      .status(503)
      .type('text')
      .send(`BiteList is not fully configured yet.\n\nMissing: ${missingEnvKeys.join(', ')}\n`);
    return true;
  }
  return false;
}

shareRouter.get('/list/:slug', async (req, res) => {
  if (configGate(res)) return;

  const owner = await getUserBySlug(req.params.slug);
  if (!owner) {
    res.status(404).send('List not found');
    return;
  }

  const saves = await getRecentSaves(owner.id, 50);
  const ownerName = owner.display_name || 'Someone';

  const twilioDigits = (config.twilio.from || '').replace(/\D/g, '');
  const connectUrl = twilioDigits
    ? `https://wa.me/${twilioDigits}?text=${encodeURIComponent(
        `connect with ${ownerName} ${owner.share_slug}`
      )}`
    : null;

  res.set('Content-Type', 'text/html');
  res.send(renderListPage({ saves, ownerName, connectUrl }));
});

shareRouter.get('/compare/:slugA/:slugB', async (req, res) => {
  if (configGate(res)) return;

  const [userA, userB] = await Promise.all([
    getUserBySlug(req.params.slugA),
    getUserBySlug(req.params.slugB)
  ]);

  if (!userA || !userB) {
    res.status(404).send('List not found');
    return;
  }

  const [mutual, aOnly, bOnly] = await Promise.all([
    getMutualSaves(userA.id, userB.id),
    getNewForUser(userB.id, userA.id),
    getNewForUser(userA.id, userB.id)
  ]);

  createCompareSession(userA.share_slug, userB.share_slug).catch((err) => {
    logger.warn({ err, slugA: userA.share_slug, slugB: userB.share_slug }, 'Failed to log compare session');
  });

  res.set('Content-Type', 'text/html');
  res.send(renderComparePage({ userA, userB, mutual, aOnly, bOnly }));
});

function renderListPage({ saves, ownerName, connectUrl }) {
  const cards = saves
    .map(
      (s) => `
    <div class="card">
      <div class="card-top">
        <div>
          <h3>${escapeHtml(s.restaurant_name)}</h3>
          <div class="meta">
            ${s.area ? `<span class="chip">${escapeHtml(s.area)}</span>` : ''}
            ${s.google_rating ? `<span class="chip">⭐ ${escapeHtml(s.google_rating)}</span>` : ''}
            ${s.price_level ? `<span class="chip">${'₹'.repeat(s.price_level)}</span>` : ''}
          </div>
        </div>
        ${
          s.google_maps_url
            ? `<a class="maps-btn" href="${escapeHtml(s.google_maps_url)}" target="_blank" rel="noopener">Maps</a>`
            : ''
        }
      </div>
      ${
        s.cuisine_tags?.length
          ? `<div class="tags">${s.cuisine_tags
              .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
              .join('')}</div>`
          : ''
      }
      ${s.notes ? `<div class="note">💬 ${escapeHtml(s.notes)}</div>` : ''}
    </div>
  `
    )
    .join('');

  const connectBlock = connectUrl
    ? `<a class="connect-btn" href="${escapeHtml(connectUrl)}">
        👋 Connect with ${escapeHtml(ownerName)} on BiteList
      </a>`
    : `<div class="connect-disabled">Connect button unavailable — bot phone number not configured.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(ownerName)}'s BiteList</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; padding-bottom: 40px; }
    .header { background: white; padding: 20px 16px 16px; border-bottom: 1px solid #eee; position: sticky; top: 0; z-index: 10; }
    .header h1 { font-size: 20px; font-weight: 700; }
    .header .sub { color: #888; font-size: 13px; margin-top: 2px; }
    .connect-btn { display: block; margin: 14px 0 0; background: #25D366; color: white; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-size: 14px; font-weight: 600; text-align: center; }
    .connect-disabled { margin: 14px 0 0; background: #f0f0f0; color: #777; padding: 10px 16px; border-radius: 8px; font-size: 13px; text-align: center; }
    .list { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
    .card { background: white; border-radius: 12px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .card-top h3 { font-size: 16px; font-weight: 600; line-height: 1.3; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 5px; }
    .chip { background: #f0f0f0; padding: 2px 8px; border-radius: 20px; font-size: 12px; color: #555; }
    .maps-btn { flex-shrink: 0; background: #f0f0f0; color: #333; text-decoration: none; padding: 6px 12px; border-radius: 8px; font-size: 13px; font-weight: 500; }
    .tags { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
    .tag { background: #e8f4e8; color: #2d6a2d; padding: 2px 8px; border-radius: 20px; font-size: 11px; }
    .note { margin-top: 8px; font-size: 13px; color: #555; background: #fffbe6; padding: 6px 10px; border-radius: 6px; line-height: 1.4; }
    .empty { text-align: center; padding: 60px 16px; color: #999; font-size: 15px; }
    .footer { text-align: center; padding: 24px 16px; color: #bbb; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(ownerName)}'s BiteList</h1>
    <div class="sub">${saves.length} saved place${saves.length === 1 ? '' : 's'}</div>
    ${connectBlock}
  </div>
  <div class="list">
    ${saves.length ? cards : '<div class="empty">No saves yet.</div>'}
  </div>
  <div class="footer">BiteList — WhatsApp restaurant memory for Bangalore</div>
</body>
</html>`;
}

function renderComparePage({ userA, userB, mutual, aOnly, bOnly }) {
  const nameA = escapeHtml(userA.display_name || 'Person A');
  const nameB = escapeHtml(userB.display_name || 'Person B');

  const renderCard = (s) => `
    <div class="card">
      <div class="card-row">
        <div>
          <div class="name">${escapeHtml(s.restaurant_name)}</div>
          <div class="meta">
            ${s.area ? `<span class="chip">${escapeHtml(s.area)}</span>` : ''}
            ${s.google_rating ? `<span class="chip">⭐ ${escapeHtml(s.google_rating)}</span>` : ''}
            ${s.price_level ? `<span class="chip">${'₹'.repeat(s.price_level)}</span>` : ''}
          </div>
        </div>
        ${
          s.google_maps_url
            ? `<a class="maps-btn" href="${escapeHtml(s.google_maps_url)}" target="_blank" rel="noopener">Maps</a>`
            : ''
        }
      </div>
    </div>`;

  const shareText = mutual
    .slice(0, 5)
    .map(
      (s, i) =>
        `${i + 1}. ${s.restaurant_name}${s.area ? ` (${s.area})` : ''}${s.google_rating ? ` ⭐${s.google_rating}` : ''}`
    )
    .join('\n');
  const ownerNamePlain = userA.display_name || 'Person A';
  const friendNamePlain = userB.display_name || 'Person B';
  const waText = encodeURIComponent(
    `${ownerNamePlain} + ${friendNamePlain} both saved:\n\n${shareText}\n\nvia BiteList`
  );
  const waShareUrl = `https://wa.me/?text=${waText}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${nameA} + ${nameB} — BiteList</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; padding-bottom: 40px; }
    .header { background: white; padding: 20px 16px 16px; border-bottom: 1px solid #eee; }
    .header h1 { font-size: 19px; font-weight: 700; }
    .header .sub { color: #888; font-size: 13px; margin-top: 3px; }
    .share-btn { display: block; margin: 14px 0 0; background: #25D366; color: white; text-decoration: none; padding: 11px 16px; border-radius: 8px; font-size: 14px; font-weight: 600; text-align: center; }
    .section { padding: 16px 16px 4px; font-size: 12px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
    .cards { padding: 8px 16px; display: flex; flex-direction: column; gap: 8px; }
    .card { background: white; border-radius: 12px; padding: 12px 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .card-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .name { font-size: 15px; font-weight: 600; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
    .chip { background: #f0f0f0; padding: 2px 8px; border-radius: 20px; font-size: 12px; color: #555; }
    .maps-btn { flex-shrink: 0; background: #f0f0f0; color: #333; text-decoration: none; padding: 5px 10px; border-radius: 8px; font-size: 13px; }
    .empty-section { padding: 8px 16px 12px; color: #999; font-size: 14px; }
    .footer { text-align: center; padding: 24px 16px; color: #bbb; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${nameA} + ${nameB}</h1>
    <div class="sub">${mutual.length} place${mutual.length === 1 ? '' : 's'} you both saved</div>
    ${mutual.length ? `<a class="share-btn" href="${waShareUrl}">Share shortlist to WhatsApp 🔗</a>` : ''}
  </div>

  <div class="section">Both saved (${mutual.length})</div>
  ${
    mutual.length
      ? `<div class="cards">${mutual.map(renderCard).join('')}</div>`
      : '<div class="empty-section">No overlap yet — save more places!</div>'
  }

  <div class="section">${nameA} saved, ${nameB} hasn't (${aOnly.length})</div>
  ${
    aOnly.length
      ? `<div class="cards">${aOnly.slice(0, 5).map(renderCard).join('')}</div>`
      : '<div class="empty-section">—</div>'
  }

  <div class="section">${nameB} saved, ${nameA} hasn't (${bOnly.length})</div>
  ${
    bOnly.length
      ? `<div class="cards">${bOnly.slice(0, 5).map(renderCard).join('')}</div>`
      : '<div class="empty-section">—</div>'
  }

  <div class="footer">BiteList — WhatsApp restaurant memory for Bangalore</div>
</body>
</html>`;
}
