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

/** Inline Google-Maps-style red pin. No external requests, scales cleanly. */
const MAP_PIN_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><path fill="#EA4335" d="M12 2c-4.4 0-8 3.6-8 8 0 5.6 8 12 8 12s8-6.4 8-12c0-4.4-3.6-8-8-8z"/><circle cx="12" cy="10" r="3" fill="#fff"/></svg>`;

function mapsIconLink(url) {
  if (!url) return '';
  return `<a class="maps-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener" aria-label="Open in Google Maps" title="Open in Google Maps">${MAP_PIN_SVG}</a>`;
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
  const friendWaUrl = twilioDigits
    ? `https://wa.me/${twilioDigits}?text=${encodeURIComponent(`friend ${owner.share_slug}`)}`
    : null;

  res.set('Content-Type', 'text/html');
  res.send(renderListPage({ saves, ownerName, friendWaUrl }));
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

/** Map common cuisine tag → editorial accent color. Falls back to neutral slate. */
const CUISINE_TAG_COLOR = {
  bar: '#92400e',
  pub: '#92400e',
  microbrewery: '#92400e',
  cocktail: '#92400e',
  cafe: '#065f46',
  coffee: '#065f46',
  bakery: '#065f46',
  italian: '#1e3a5f',
  continental: '#1e3a5f',
  japanese: '#1e3a5f',
  thai: '#1e3a5f',
  chinese: '#1e3a5f',
  indian: '#7c2d12',
  'north indian': '#7c2d12',
  'south indian': '#7c2d12',
  biryani: '#7c2d12',
  vegetarian: '#14532d',
  vegan: '#14532d',
  pizza: '#7c2d12',
  seafood: '#1e3a5f',
  steak: '#7c2d12',
  'fast food': '#7c2d12',
  'ice cream': '#065f46',
  club: '#92400e'
};

function renderListPage({ saves, ownerName, friendWaUrl }) {
  const tagColor = (t) => CUISINE_TAG_COLOR[String(t).toLowerCase()] || '#374151';

  const renderCard = (s) => {
    const tags = (s.cuisine_tags || []).slice(0, 3);
    const price = s.price_level ? '₹'.repeat(s.price_level) : null;
    const initial = (s.restaurant_name || '·').trim().charAt(0) || '·';
    const photoBlock = s.google_photo_url
      ? `<div class="card-photo"><img src="${escapeHtml(s.google_photo_url)}" alt="${escapeHtml(s.restaurant_name)}" loading="lazy" referrerpolicy="no-referrer"/></div>`
      : `<div class="card-photo card-photo--placeholder"><span class="photo-initial">${escapeHtml(initial)}</span></div>`;

    const dataHref = s.google_maps_url
      ? ` data-href="${escapeHtml(s.google_maps_url)}" tabindex="0" role="link"`
      : '';

    const mapsLink = s.google_maps_url
      ? `<a class="maps-link" href="${escapeHtml(s.google_maps_url)}" target="_blank" rel="noopener">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
           Maps
         </a>`
      : '';

    const tagsBlock = tags.length
      ? `<div class="tag-row">${tags
          .map(
            (t) =>
              `<span class="tag" style="background:${tagColor(t)}22;color:${tagColor(t)}cc;border:1px solid ${tagColor(t)}44">${escapeHtml(t)}</span>`
          )
          .join('')}</div>`
      : '';

    const status = s.status === 'been_there'
      ? '<span class="status-pill status-been">Been</span>'
      : '<span class="status-pill status-want">Want</span>';

    return `
    <article class="card"${dataHref}>
      ${photoBlock}
      <div class="card-body">
        <div class="card-header">
          <h3 class="card-name">${escapeHtml(s.restaurant_name)}</h3>
          <div class="card-actions">${mapsLink}</div>
        </div>
        <div class="card-meta">
          ${s.area ? `<span class="area-label">${escapeHtml(s.area)}</span>` : ''}
          ${s.google_rating ? `<span class="rating"><svg class="star" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l1.9 3.8 4.1.6-3 2.9.7 4.1L8 10.4 4.3 12.4 5 8.3 2 5.4l4.1-.6z" fill="#E8A838"/></svg>${escapeHtml(s.google_rating)}</span>` : ''}
          ${price ? `<span class="price">${escapeHtml(price)}</span>` : ''}
          ${status}
        </div>
        ${tagsBlock}
        ${s.notes ? `<p class="note">${escapeHtml(s.notes)}</p>` : ''}
      </div>
    </article>`;
  };

  const areas = [...new Set(saves.map((s) => s.area).filter(Boolean))];
  const noArea = saves.filter((s) => !s.area);
  const groupedHtml =
    areas.length > 1
      ? areas
          .map((area) => {
            const areaSaves = saves.filter((s) => s.area === area);
            return `<section class="area-section"><h2 class="area-heading">${escapeHtml(area)}</h2>${areaSaves.map(renderCard).join('')}</section>`;
          })
          .join('') +
        (noArea.length ? `<section class="area-section">${noArea.map(renderCard).join('')}</section>` : '')
      : saves.map(renderCard).join('');

  const connectBlock = friendWaUrl
    ? `<div class="connect-wrap">
        <a class="connect-btn" href="${escapeHtml(friendWaUrl)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Link on BiteList
        </a>
      </div>`
    : `<div class="connect-wrap"><div class="connect-disabled">WhatsApp link unavailable (bot phone not configured)</div></div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0D0D0D">
  <title>${escapeHtml(ownerName)}'s BiteList · Bangalore</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0D0D0D; --bg-card: #181818; --bg-card-h: #202020;
      --accent: #E8A838; --accent-dim: rgba(232,168,56,0.08);
      --text-1: #F0EDE8; --text-2: #9A9490; --text-3: #5A5754;
      --border: rgba(255,255,255,0.07); --radius: 14px;
      --font-serif: 'Cormorant Garamond', Georgia, serif;
      --font-sans: 'Plus Jakarta Sans', system-ui, sans-serif;
    }
    html { background: var(--bg); color: var(--text-1); font-family: var(--font-sans); }
    body {
      min-height: 100vh; background: var(--bg);
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
    }
    .page-header { padding: 48px 20px 32px; max-width: 680px; margin: 0 auto; }
    .header-label { font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
    .header-name { font-family: var(--font-serif); font-size: clamp(36px, 8vw, 56px); font-weight: 700; line-height: 1.05; color: var(--text-1); letter-spacing: -0.01em; }
    .header-name em { font-style: italic; color: var(--accent); }
    .header-sub { margin-top: 10px; font-size: 14px; color: var(--text-2); display: flex; align-items: center; gap: 10px; }
    .header-sub::before { content: ''; display: inline-block; width: 24px; height: 1px; background: var(--text-3); }
    .connect-wrap { max-width: 680px; margin: 0 auto; padding: 0 20px 32px; }
    .connect-btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 14px 20px; background: transparent; border: 1px solid rgba(34,197,94,0.4); border-radius: 10px; color: #22C55E; font-family: var(--font-sans); font-size: 14px; font-weight: 600; text-decoration: none; transition: background 0.2s, border-color 0.2s; letter-spacing: 0.01em; }
    .connect-btn:hover { background: rgba(34,197,94,0.08); border-color: rgba(34,197,94,0.7); }
    .connect-btn svg { flex-shrink: 0; }
    .connect-disabled { padding: 14px 20px; border: 1px dashed var(--border); border-radius: 10px; color: var(--text-3); text-align: center; font-size: 13px; }
    .content { max-width: 680px; margin: 0 auto; padding: 0 20px; }
    .area-section { margin-bottom: 36px; }
    .area-heading { font-family: var(--font-serif); font-size: 22px; font-weight: 600; font-style: italic; color: var(--text-2); margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; display: grid; grid-template-columns: 96px 1fr; gap: 0; margin-bottom: 10px; transition: background 0.15s, border-color 0.15s, transform 0.15s; text-decoration: none; color: inherit; }
    .card[data-href] { cursor: pointer; }
    .card:hover { background: var(--bg-card-h); border-color: rgba(255,255,255,0.12); transform: translateY(-1px); }
    .card-photo { width: 96px; min-height: 96px; flex-shrink: 0; overflow: hidden; background: #232323; position: relative; }
    .card-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .card-photo--placeholder { display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #222, #1a1a1a); }
    .photo-initial { font-family: var(--font-serif); font-size: 32px; font-weight: 700; color: var(--text-3); }
    .card-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .card-name { font-size: 15px; font-weight: 600; color: var(--text-1); line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .maps-link { flex-shrink: 0; display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: var(--text-3); text-decoration: none; transition: color 0.15s; padding: 2px 0; white-space: nowrap; }
    .maps-link:hover { color: var(--accent); }
    .card-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .area-label { font-size: 12px; color: var(--text-2); }
    .rating { display: flex; align-items: center; gap: 3px; font-size: 12px; font-weight: 600; color: var(--accent); }
    .star { width: 11px; height: 11px; flex-shrink: 0; }
    .price { font-size: 12px; color: var(--text-3); letter-spacing: 0.03em; }
    .status-pill { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; }
    .status-want { background: rgba(232,168,56,0.10); color: var(--accent); border: 1px solid rgba(232,168,56,0.25); }
    .status-been { background: rgba(34,197,94,0.10); color: #22C55E; border: 1px solid rgba(34,197,94,0.25); }
    .tag-row { display: flex; gap: 5px; flex-wrap: wrap; }
    .tag { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 20px; text-transform: lowercase; letter-spacing: 0.01em; }
    .note { font-size: 12px; font-style: italic; color: var(--text-2); line-height: 1.4; background: var(--accent-dim); padding: 5px 8px; border-radius: 6px; border-left: 2px solid var(--accent); }
    .empty { text-align: center; padding: 60px 16px; color: var(--text-3); font-size: 15px; }
    .page-footer { max-width: 680px; margin: 0 auto; padding: 32px 20px 48px; display: flex; align-items: center; gap: 10px; }
    .footer-line { flex: 1; height: 1px; background: var(--border); }
    .footer-text { font-size: 11px; color: var(--text-3); letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; }
    @media (max-width: 480px) {
      .page-header { padding: 36px 16px 24px; }
      .connect-wrap { padding: 0 16px 24px; }
      .content { padding: 0 16px; }
      .card { grid-template-columns: 1fr; grid-template-rows: 160px auto; }
      .card-photo { width: 100%; min-height: 160px; }
      .card-name { font-size: 16px; white-space: normal; }
    }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    .page-header { animation: fadeUp 0.4s ease both; }
    .connect-wrap { animation: fadeUp 0.4s 0.08s ease both; }
    .card { animation: fadeUp 0.35s ease both; }
    .card:nth-child(1) { animation-delay: 0.10s; }
    .card:nth-child(2) { animation-delay: 0.15s; }
    .card:nth-child(3) { animation-delay: 0.20s; }
    .card:nth-child(4) { animation-delay: 0.25s; }
    .card:nth-child(5) { animation-delay: 0.30s; }
    .card:nth-child(n+6) { animation-delay: 0.35s; }
  </style>
</head>
<body>
  <header class="page-header">
    <p class="header-label">BiteList · Bangalore</p>
    <h1 class="header-name">${escapeHtml(ownerName)}'s <em>picks</em></h1>
    <p class="header-sub">${saves.length} saved place${saves.length === 1 ? '' : 's'}</p>
  </header>
  ${connectBlock}
  <main class="content">
    ${saves.length ? groupedHtml : '<p class="empty">No saves yet.</p>'}
  </main>
  <footer class="page-footer">
    <div class="footer-line"></div>
    <span class="footer-text">BiteList</span>
    <div class="footer-line"></div>
  </footer>
  <script>
    document.querySelectorAll('.card[data-href]').forEach(function(c){
      c.addEventListener('click', function(e){
        if (e.target.closest('a, button')) return;
        window.open(c.dataset.href, '_blank', 'noopener');
      });
      c.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.open(c.dataset.href, '_blank', 'noopener');
        }
      });
    });
  </script>
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
        ${mapsIconLink(s.google_maps_url)}
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
    .maps-btn { flex-shrink: 0; background: #fff; color: #333; text-decoration: none; padding: 6px; border-radius: 999px; font-size: 13px; line-height: 0; border: 1px solid #eee; }
    .maps-btn:hover { background: #f7f7f7; }
    .maps-btn svg { display: block; }
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
