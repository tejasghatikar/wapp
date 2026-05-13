# BiteList — Share Page UI Redesign

> Design spec for Claude Code. Target: the `/list/:slug` page.
> Current state: white, flat, generic. Target: dark editorial, warm amber accents, restaurant photos, feels like a curated city guide.
> Mobile-first. Most users will open shared links on their phones.

---

## Design Direction

**Aesthetic:** Dark editorial — like a premium Bangalore nightlife guide, not a to-do list app.
**Reference feel:** Beli's social warmth + a physical restaurant magazine's visual weight.
**One unforgettable thing:** Restaurant photos with a warm amber glow. When someone opens this link it should feel like opening a menu, not a spreadsheet.

**Typography:**
- Headlines: `Cormorant Garamond` — refined Italian serif, feels like a real guide
- Body/UI: `Plus Jakarta Sans` — clean, contemporary, slightly geometric

**Color palette:**
```
Background:     #0D0D0D  (near-black, warm undertone)
Card:           #181818
Card hover:     #202020
Accent:         #E8A838  (warm amber — ratings, highlights)
Text primary:   #F0EDE8  (warm white)
Text secondary: #9A9490  (warm gray)
Text muted:     #5A5754
Border:         rgba(255,255,255,0.07)
Tag bg:         rgba(255,255,255,0.06)
Connect green:  #22C55E
Note bg:        rgba(232,168,56,0.08)
```

---

## Step 1 — DB Change (Add Photo Storage)

Run in Supabase SQL editor:

```sql
alter table saves add column if not exists google_photo_url text;
```

---

## Step 2 — Update Places API Fetch to Get Photo URL

In `src/services/places.js`, update `normalizePlace` to extract the first photo reference, then resolve it to a CDN URL.

Add this function:

```javascript
/**
 * Resolve a Google Places photo name to a public CDN URL (no API key exposed).
 * Google redirects to lh3.googleusercontent.com — follow it, capture the final URL.
 */
export async function resolvePhotoUrl(photoName) {
  if (!photoName) return null;
  try {
    const apiUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=600&maxWidthPx=800&key=${config.google.placesApiKey}`;
    const res = await fetch(apiUrl, { redirect: 'follow' });
    // After redirect, the final URL is a public CDN URL — no API key in it
    return res.url || null;
  } catch {
    return null;
  }
}
```

Update `normalizePlace` to include photo name:

```javascript
function normalizePlace(p) {
  const priceMap = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
  const firstPhoto = p.photos?.[0]?.name || null;  // ADD THIS
  return {
    place_id: p.id,
    name: p.displayName?.text,
    address: p.formattedAddress,
    rating: p.rating,
    price_level: priceMap[p.priceLevel] || null,
    types: p.types || [],
    google_maps_url: p.googleMapsUri,
    latitude: p.location?.latitude,
    longitude: p.location?.longitude,
    cuisine_tags: inferCuisineTags(p.types || []),
    photo_name: firstPhoto   // ADD THIS
  };
}
```

Update the `X-Goog-FieldMask` header to include photos:

```javascript
'X-Goog-FieldMask': [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.rating',
  'places.priceLevel',
  'places.types',
  'places.googleMapsUri',
  'places.location',
  'places.photos'   // ADD THIS
].join(',')
```

---

## Step 3 — Update Save Flow to Store Photo URL

In `src/handlers/save.js`, in the `runPlaceLookup` function, after `searchPlaces` returns candidates, resolve the photo URL before saving:

```javascript
// After: const candidates = await searchPlaces(name, area);
// Before: if (candidates.length === 0) { ...

// Resolve photo URL for top candidate (async, non-blocking if it fails)
if (candidates[0]?.photo_name) {
  try {
    const { resolvePhotoUrl } = await import('../services/places.js');
    candidates[0].google_photo_url = await resolvePhotoUrl(candidates[0].photo_name);
  } catch { /* non-fatal */ }
}
```

In `createSave` calls, add `google_photo_url: place.google_photo_url || null` to the save object.

---

## Step 4 — Full Redesigned `renderListPage` Function

Replace the entire `renderListPage` function in `src/routes/share.js` with this:

```javascript
function renderListPage({ saves, ownerName, connectUrl }) {
  const escape = s => String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const priceLabel = level => level ? '₹'.repeat(level) : null;

  // Cuisine tag color mapping
  const tagColor = tag => {
    const map = {
      bar: '#92400e', pub: '#92400e', microbrewery: '#92400e',
      cafe: '#065f46', coffee: '#065f46', bakery: '#065f46',
      italian: '#1e3a5f', continental: '#1e3a5f', japanese: '#1e3a5f',
      indian: '#7c2d12', 'north indian': '#7c2d12', 'south indian': '#7c2d12',
      biryani: '#7c2d12', vegetarian: '#14532d', vegan: '#14532d',
    };
    return map[tag] || '#374151';
  };

  const renderCard = s => {
    const tags = (s.cuisine_tags || []).slice(0, 3);
    const price = priceLabel(s.price_level);

    return `
    <article class="card" ${s.google_maps_url ? `onclick="window.open('${escape(s.google_maps_url)}','_blank')"` : ''} style="${s.google_maps_url ? 'cursor:pointer' : ''}">
      ${s.google_photo_url
        ? `<div class="card-photo">
             <img src="${escape(s.google_photo_url)}" alt="${escape(s.restaurant_name)}" loading="lazy" />
           </div>`
        : `<div class="card-photo card-photo--placeholder">
             <span class="photo-initial">${escape(s.restaurant_name.charAt(0))}</span>
           </div>`
      }
      <div class="card-body">
        <div class="card-header">
          <h3 class="card-name">${escape(s.restaurant_name)}</h3>
          <div class="card-actions">
            ${s.google_maps_url
              ? `<a class="maps-link" href="${escape(s.google_maps_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
                   Maps
                 </a>`
              : ''}
          </div>
        </div>
        <div class="card-meta">
          ${s.area ? `<span class="area-label">${escape(s.area)}</span>` : ''}
          ${s.google_rating ? `<span class="rating"><svg class="star" viewBox="0 0 16 16"><path d="M8 1l1.9 3.8 4.1.6-3 2.9.7 4.1L8 10.4 4.3 12.4 5 8.3 2 5.4l4.1-.6z" fill="#E8A838"/></svg>${s.google_rating}</span>` : ''}
          ${price ? `<span class="price">${escape(price)}</span>` : ''}
        </div>
        ${tags.length ? `
        <div class="tag-row">
          ${tags.map(t => `<span class="tag" style="background:${tagColor(t)}22;color:${tagColor(t)}cc;border:1px solid ${tagColor(t)}44">${escape(t)}</span>`).join('')}
        </div>` : ''}
        ${s.notes ? `<p class="note">"${escape(s.notes)}"</p>` : ''}
      </div>
    </article>`;
  };

  // Group saves by area for display
  const areas = [...new Set(saves.map(s => s.area).filter(Boolean))];
  const noArea = saves.filter(s => !s.area);

  const groupedHtml = areas.length > 1
    ? areas.map(area => {
        const areaSaves = saves.filter(s => s.area === area);
        return `
          <section class="area-section">
            <h2 class="area-heading">${escape(area)}</h2>
            ${areaSaves.map(renderCard).join('')}
          </section>`;
      }).join('') + (noArea.length ? `<section class="area-section">${noArea.map(renderCard).join('')}</section>` : '')
    : saves.map(renderCard).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0D0D0D">
  <title>${escape(ownerName)}'s BiteList · Bangalore</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:           #0D0D0D;
      --bg-card:      #181818;
      --bg-card-h:    #202020;
      --accent:       #E8A838;
      --accent-dim:   rgba(232,168,56,0.12);
      --text-1:       #F0EDE8;
      --text-2:       #9A9490;
      --text-3:       #5A5754;
      --border:       rgba(255,255,255,0.07);
      --radius:       14px;
      --font-serif:   'Cormorant Garamond', Georgia, serif;
      --font-sans:    'Plus Jakarta Sans', system-ui, sans-serif;
    }

    html { background: var(--bg); color: var(--text-1); font-family: var(--font-sans); }

    body {
      min-height: 100vh;
      background: var(--bg);
      /* Subtle grain texture */
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
    }

    /* ── Header ─────────────────────────────── */
    .page-header {
      padding: 48px 20px 32px;
      max-width: 680px;
      margin: 0 auto;
    }

    .header-label {
      font-family: var(--font-sans);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 10px;
    }

    .header-name {
      font-family: var(--font-serif);
      font-size: clamp(36px, 8vw, 56px);
      font-weight: 700;
      line-height: 1.05;
      color: var(--text-1);
      letter-spacing: -0.01em;
    }

    .header-name em {
      font-style: italic;
      color: var(--accent);
    }

    .header-sub {
      margin-top: 10px;
      font-size: 14px;
      color: var(--text-2);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .header-sub::before {
      content: '';
      display: inline-block;
      width: 24px;
      height: 1px;
      background: var(--text-3);
    }

    /* ── Connect button ─────────────────────── */
    .connect-wrap {
      max-width: 680px;
      margin: 0 auto;
      padding: 0 20px 32px;
    }

    .connect-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px 20px;
      background: transparent;
      border: 1px solid rgba(34,197,94,0.4);
      border-radius: 10px;
      color: #22C55E;
      font-family: var(--font-sans);
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      transition: background 0.2s, border-color 0.2s;
      letter-spacing: 0.01em;
    }

    .connect-btn:hover {
      background: rgba(34,197,94,0.08);
      border-color: rgba(34,197,94,0.7);
    }

    .connect-btn svg { flex-shrink: 0; }

    /* ── Area grouping ───────────────────────── */
    .content {
      max-width: 680px;
      margin: 0 auto;
      padding: 0 20px;
    }

    .area-section { margin-bottom: 36px; }

    .area-heading {
      font-family: var(--font-serif);
      font-size: 22px;
      font-weight: 600;
      font-style: italic;
      color: var(--text-2);
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }

    /* ── Cards ──────────────────────────────── */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      display: grid;
      grid-template-columns: 88px 1fr;
      gap: 0;
      margin-bottom: 10px;
      transition: background 0.15s, border-color 0.15s, transform 0.15s;
      text-decoration: none;
      color: inherit;
    }

    .card:hover {
      background: var(--bg-card-h);
      border-color: rgba(255,255,255,0.12);
      transform: translateY(-1px);
    }

    /* Photo column */
    .card-photo {
      width: 88px;
      min-height: 88px;
      flex-shrink: 0;
      overflow: hidden;
      background: #232323;
      position: relative;
    }

    .card-photo img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .card-photo--placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #222, #1a1a1a);
    }

    .photo-initial {
      font-family: var(--font-serif);
      font-size: 32px;
      font-weight: 700;
      color: var(--text-3);
    }

    /* Info column */
    .card-body {
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      min-width: 0;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }

    .card-name {
      font-family: var(--font-sans);
      font-size: 15px;
      font-weight: 600;
      color: var(--text-1);
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .maps-link {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-3);
      text-decoration: none;
      transition: color 0.15s;
      padding: 2px 0;
      white-space: nowrap;
    }

    .maps-link:hover { color: var(--accent); }

    /* Meta row: area · rating · price */
    .card-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .area-label {
      font-size: 12px;
      color: var(--text-2);
    }

    .rating {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 12px;
      font-weight: 600;
      color: var(--accent);
    }

    .star {
      width: 11px;
      height: 11px;
      flex-shrink: 0;
    }

    .price {
      font-size: 12px;
      color: var(--text-3);
      letter-spacing: 0.03em;
    }

    /* Cuisine tags */
    .tag-row {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }

    .tag {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 20px;
      text-transform: lowercase;
      letter-spacing: 0.01em;
    }

    /* Notes */
    .note {
      font-size: 12px;
      font-style: italic;
      color: var(--text-2);
      line-height: 1.4;
      background: var(--accent-dim);
      padding: 5px 8px;
      border-radius: 6px;
      border-left: 2px solid var(--accent);
    }

    /* ── Footer ─────────────────────────────── */
    .page-footer {
      max-width: 680px;
      margin: 0 auto;
      padding: 32px 20px 48px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .footer-line {
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    .footer-text {
      font-size: 11px;
      color: var(--text-3);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    /* ── Mobile ──────────────────────────────── */
    @media (max-width: 480px) {
      .page-header { padding: 36px 16px 24px; }
      .connect-wrap { padding: 0 16px 24px; }
      .content { padding: 0 16px; }

      .card {
        grid-template-columns: 1fr;
        grid-template-rows: 160px auto;
      }

      .card-photo {
        width: 100%;
        min-height: 160px;
      }

      .card-name { font-size: 16px; white-space: normal; }
    }

    /* ── Animations ──────────────────────────── */
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .page-header { animation: fadeUp 0.4s ease both; }
    .connect-wrap { animation: fadeUp 0.4s 0.08s ease both; }
    .card {
      animation: fadeUp 0.35s ease both;
    }
    /* Stagger each card */
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
    <h1 class="header-name">${escape(ownerName)}'s <em>picks</em></h1>
    <p class="header-sub">${saves.length} saved place${saves.length === 1 ? '' : 's'}</p>
  </header>

  <div class="connect-wrap">
    <a class="connect-btn" href="${connectUrl}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      Connect with ${escape(ownerName)}
    </a>
  </div>

  <main class="content">
    ${saves.length ? groupedHtml : '<p style="color:var(--text-3);padding:40px 0;text-align:center">No saves yet.</p>'}
  </main>

  <footer class="page-footer">
    <div class="footer-line"></div>
    <span class="footer-text">BiteList</span>
    <div class="footer-line"></div>
  </footer>

</body>
</html>`;
}
```

---

## Step 5 — Update `/list/:slug` Route (Minor Fix)

The current route passes `ownerName` but the DB column `display_name` is often null (user never set it). Add a fallback:

```javascript
shareRouter.get('/list/:slug', async (req, res) => {
  const owner = await getUserBySlug(req.params.slug);
  if (!owner) return res.status(404).send('List not found');

  const saves = await getRecentSaves(owner.id, 50);

  // Use display_name if set, otherwise "Someone" is replaced by first-name logic
  const ownerName = owner.display_name || 'Someone';

  const twilioDigits = config.twilio.from.replace(/\D/g, '');
  const connectText = encodeURIComponent(`connect with ${ownerName} ${owner.share_slug}`);
  const connectUrl = `https://wa.me/${twilioDigits}?text=${connectText}`;

  res.set('Content-Type', 'text/html');
  res.send(renderListPage({ saves, ownerName, connectUrl }));
});
```

---

## Step 6 — Let Users Set Their Name

Right now every page says "Someone's picks." Add a `setname` command to the bot:

In `src/handlers/commands.js`:

```javascript
// "name Tejas" or "setname Tejas"
export async function handleSetName(user, text) {
  const name = text.replace(/^(name|setname|my name is)\s+/i, '').trim();
  if (!name || name.length < 2 || name.length > 40) {
    await sendMessage(user.whatsapp_number, "What name should I use? Reply: *name Tejas*");
    return;
  }

  await supabase
    .from('users')
    .update({ display_name: name })
    .eq('id', user.id);

  await sendMessage(user.whatsapp_number,
    `Got it — your list is now *${name}'s picks*.\n\n${config.publicUrl}/list/${user.share_slug}`);
}
```

Add to router before the query fallback:
```javascript
if (/^(name|setname|my name is)\s+/i.test(body)) return handleSetName(user, body);
```

Add to HELP text:
```
• *name Tejas* → personalise your list page
```

---

## What the Redesign Changes (Before → After)

| Element | Before | After |
|---|---|---|
| Background | White | Near-black `#0D0D0D` with grain |
| Font | System (Inter/Roboto) | Cormorant Garamond + Plus Jakarta Sans |
| Header | Small "Someone's BiteList" | Large serif "Tejas's *picks*" |
| Cards | White box, thin border | Dark card, photo column on left |
| Photos | None | Google Places photo (fallback: letter initial) |
| Rating | `⭐ 4.4` emoji | Amber amber SVG star, amber text |
| Tags | Gray pills | Color-coded by cuisine category |
| Notes | Yellow background | Amber left-border callout |
| Area grouping | None | Grouped by area with italic headers |
| Connect button | Solid green block | Outlined, subtle, refined |
| Mobile layout | Same as desktop | Photo full-width top, info below |
| Animation | None | Staggered fade-up on load |

---

## Test After Building

- [ ] Open `/list/:slug` — dark background loads, fonts load from Google
- [ ] First card animates in, subsequent cards stagger
- [ ] Cards with photos show the restaurant image
- [ ] Cards without photos show the letter initial placeholder
- [ ] Rating is amber colored
- [ ] Tags are color-coded (pub/bar = amber-brown, cafe = green-teal)
- [ ] Notes have amber left border
- [ ] If user has saves in multiple areas, they're grouped with italic area headers
- [ ] "Connect with" button has green outline, no fill
- [ ] On mobile (375px), photo stacks above card info
- [ ] Page title shows owner's name if set; "Someone" if not
- [ ] Bot command `name Tejas` updates display_name, links sends updated page title
- [ ] Clicking a card opens Google Maps (entire card is clickable)
- [ ] Maps link in top-right also works independently (stops propagation)
