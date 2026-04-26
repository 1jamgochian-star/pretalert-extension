/**
 * PretAlert content script – rulează pe toate magazinele suportate din România.
 * Detectează automat magazinul, extrage datele produsului și le trimite la API.
 */
'use strict';

console.log('[PretAlert] content.js loaded on', location.hostname, location.pathname);

const API       = 'https://www.pretalert.ro/api/extensie';
let STORAGE_KEY = 'pretalert_product'; // înlocuit cu cheie per-tab după GET_TAB_ID

// ── Generic DOM helpers ───────────────────────────────────────────────────────

function qs(selectors) {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

function qsText(selectors) {
  const el = qs(selectors);
  if (el) return el.textContent.trim().replace(/\s+/g, ' ');
  const og = document.querySelector('meta[property="og:title"]');
  if (og) return og.content.trim();
  return document.title.trim();
}

function extractNumericPrice(el) {
  if (!el) return null;
  const attr = el.getAttribute('data-price') || el.getAttribute('data-price-amount') || el.getAttribute('content');
  if (attr) {
    const v = parseFloat(String(attr).replace(',', '.'));
    if (v > 0) return v;
  }
  const raw = el.textContent.trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  const v = parseFloat(raw);
  return v > 0 ? v : null;
}

function qsPrice(selectors) {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (!el) continue;
    const v = extractNumericPrice(el);
    if (v && v > 0) return v;
  }
  const ogMeta = document.querySelector('meta[property="og:price:amount"]')
    || document.querySelector('meta[property="product:price:amount"]');
  if (ogMeta) {
    const v = parseFloat(ogMeta.content);
    if (v > 0) return v;
  }
  return null;
}

function qsImage(selectors) {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (!el) continue;
    const src = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy');
    if (src && !src.startsWith('data:') && src.length > 10) return src;
  }
  const og = document.querySelector('meta[property="og:image"]');
  return og ? og.content : '';
}

// ── Per-store configs ─────────────────────────────────────────────────────────

const STORES = {

  'emag.ro': {
    name: 'eMAG',
    isProduct: () => /\/pd\/[A-Z0-9]+/i.test(location.pathname),
    getId: () => {
      const m = location.pathname.match(/\/pd\/([A-Z0-9]+)/i);
      return m ? m[1].toUpperCase() : null;
    },
    getTitle: () => qsText([
      'h1.page-header', 'h1[itemprop="name"]', '.page-header-title h1',
      'h1.product-page-heading', 'h1.product-title', 'h1',
    ]),
    getPrice: () => {
      // eMAG renders integer + <sup> decimals separately
      const el = document.querySelector('.product-new-price')
        || document.querySelector('.offer-price')
        || document.querySelector('.product-highlight-price')
        || document.querySelector('[data-price]');
      if (el) {
        // Try data-price attribute first (most reliable)
        const dpAttr = el.getAttribute('data-price');
        if (dpAttr) {
          const v = parseFloat(String(dpAttr).replace(',', '.'));
          if (v > 0) return v;
        }
        // Fall back to parsing integer + <sup> decimals
        const sup   = el.querySelector('sup');
        const clone = el.cloneNode(true);
        clone.querySelectorAll('sup, span, small').forEach(n => n.remove());
        const intText = clone.textContent.trim().replace(/\./g, '').replace(/[^\d]/g, '');
        const intPart = parseInt(intText, 10);
        if (!isNaN(intPart) && intPart > 0) {
          const dec = sup ? parseInt(sup.textContent.trim().replace(/\D/g, ''), 10) : 0;
          return intPart + (isNaN(dec) ? 0 : dec) / 100;
        }
      }
      return qsPrice(['[itemprop="price"]', '.pricing .price', '.rrp-lrg']);
    },
    getImage: () => qsImage([
      '.product-images-main .img-responsive', '.product-images-main img',
      '.product-gallery-main img', '.product-page-media-main img',
      '#main-image img', '.product-page-media img',
      'img[itemprop="image"]',
    ]),
    waitSelectors: ['.product-new-price', '.offer-price', '.product-highlight-price', '[data-price]'],
  },

  'altex.ro': {
    name: 'Altex',
    isProduct: () => document.querySelector('[itemtype*="schema.org/Product"]') !== null
      || /[/-]p\d{4,}\/?$/.test(location.pathname),
    getId: () => {
      const m = location.pathname.match(/[/-]p(\d{4,})\/?$/);
      if (m) return `altex:${m[1]}`;
      const el = document.querySelector('[data-product-id]');
      if (el) return `altex:${el.getAttribute('data-product-id')}`;
      return null;
    },
    getTitle: () => qsText([
      'h1.product-title', '.product-name h1', '.product-title h1',
      'h1[itemprop="name"]', 'h1',
    ]),
    getPrice: () => qsPrice([
      '.price__over', '.price-over', '.price .current', '.price-new',
      '.product-price .price', '[itemprop="price"]', '.price',
    ]),
    getImage: () => qsImage([
      '.fotorama__img', '.product-image img', '.MagicZoom img',
      'img[itemprop="image"]',
    ]),
    waitSelectors: ['.price__over', '.price-over', '.price .current', '.price-new', '[itemprop="price"]'],
  },

  'flanco.ro': {
    name: 'Flanco',
    isProduct: () => document.querySelector('.product-info-main') !== null
      || document.querySelector('[itemtype*="schema.org/Product"]') !== null,
    getId: () => {
      const el = document.querySelector('[data-product-id]')
        || document.querySelector('input[name="product"]');
      if (el) {
        const id = el.getAttribute('data-product-id') || el.value;
        if (id) return `flanco:${id}`;
      }
      const og = document.querySelector('meta[property="product:retailer_item_id"]');
      if (og) return `flanco:${og.content}`;
      const m = location.pathname.match(/\/(\d{4,})\.html$/);
      return m ? `flanco:${m[1]}` : null;
    },
    getTitle: () => qsText(['.page-title h1', 'h1[itemprop="name"]', 'h1.product-name', 'h1']),
    getPrice: () => qsPrice([
      '.special-price .price', '.price-box .price',
      '[itemprop="price"]', '.price-final_price .price', '.price',
    ]),
    getImage: () => qsImage([
      '.product.media img.photo', '.fotorama__img',
      'img[itemprop="image"]', '.product-image-photo',
    ]),
    waitSelectors: ['.price-box', '.price-final_price', '[itemprop="price"]'],
  },

  'cel.ro': {
    name: 'CEL',
    // New URL format: /slug-pMCIxxxxxx-l/   Old: /produse/slug--cID.html
    isProduct: () => /-pMCI[A-Za-z0-9]+-l\/?$/.test(location.pathname)
      || /\/produse\/.*--c\d+\.html$/.test(location.pathname)
      || document.querySelector('div.pret') !== null
      || document.querySelector('[itemtype*="schema.org/Product"]') !== null,
    getId: () => {
      const newFmt = location.pathname.match(/-pMCI([A-Za-z0-9]+)-l\/?$/);
      if (newFmt) return `cel:${newFmt[1]}`;
      const oldFmt = location.pathname.match(/--c(\d+)\.html$/);
      if (oldFmt) return `cel:${oldFmt[1]}`;
      const el = document.querySelector('[data-product-id]');
      return el ? `cel:${el.getAttribute('data-product-id')}` : null;
    },
    getTitle: () => qsText([
      'h1', 'h1.product-title', '.product-page-title h1', 'h1[itemprop="name"]',
    ]),
    getPrice: () => qsPrice([
      'div.pret', '.pret-produs .pret-intreg', '.pret-produs', '.price-new',
      '.product-price', '[itemprop="price"]', '.price',
    ]),
    getImage: () => qsImage([
      'img[src*="s1.cel.ro/images/Products"]',
      '.product-image-main img', '.images-container img', 'img[itemprop="image"]',
    ]),
    waitSelectors: ['div.pret', '.pret-produs', '.product-price', '[itemprop="price"]'],
  },

  'pcgarage.ro': {
    name: 'PC Garage',
    // URLs: /category/brand/slug/  – at least 3 path segments, ends with /
    isProduct: () => document.querySelector('[itemtype*="schema.org/Product"]') !== null
      || (location.pathname.split('/').filter(Boolean).length >= 3
          && location.pathname.endsWith('/')),
    getId: () => {
      // Slug is the last path segment: /cat/brand/slug/
      const parts = location.pathname.split('/').filter(Boolean);
      if (parts.length >= 3) return `pcgarage:${parts[parts.length - 1]}`;
      const el = document.querySelector('[data-id]');
      return el ? `pcgarage:${el.getAttribute('data-id')}` : null;
    },
    getTitle: () => qsText([
      'h1.product-title', 'h1.title', '.product_heading h1', 'h1[itemprop="name"]', 'h1',
    ]),
    getPrice: () => qsPrice([
      '.price_with_vat .price', '.price_with_vat', '.price-with-tax',
      '[data-price-type="finalPrice"]', '.product-price .price',
      '[itemprop="price"]', '.price',
    ]),
    getImage: () => qsImage([
      '.product-img img', '.product-images .main-image img',
      '.product-images img', 'img[itemprop="image"]', '.product-photo img',
    ]),
    waitSelectors: ['.price_with_vat', '.price-with-tax', '[itemprop="price"]'],
  },

  'evomag.ro': {
    name: 'EvoMag',
    // URLs: /category/name-ID.html  – body has class "htmlbody_product" on product pages
    isProduct: () => document.querySelector('body.htmlbody_product') !== null
      || document.querySelector('#product') !== null
      || /\-\d{5,}\.html$/.test(location.pathname)
      || document.querySelector('[itemtype*="schema.org/Product"]') !== null,
    getId: () => {
      // URL ends with -ID.html, e.g. /portabile/lenovo-v15-4122947.html
      const m = location.pathname.match(/-(\d{4,})\.html$/);
      if (m) return `evomag:${m[1]}`;
      const el = document.querySelector('[data-id-product]');
      if (el) return `evomag:${el.getAttribute('data-id-product')}`;
      // Fallback: data attribute on gallery link
      const gallery = document.querySelector('a.gallery-link[href*="id="]');
      if (gallery) {
        const gm = gallery.href.match(/id=(\d+)/);
        if (gm) return `evomag:${gm[1]}`;
      }
      return null;
    },
    getTitle: () => qsText([
      'h1.product_name', 'h1[itemprop="name"]', '.product_name h1', 'h1',
    ]),
    getPrice: () => qsPrice([
      'span[itemprop="price"]', '[itemprop="price"]',
      '.our_price_display', '.price-product', '.product-price', '.price',
    ]),
    getImage: () => qsImage([
      '.produs_body_focus_img img', '.MainProductGallery img[loading="eager"]',
      '.product-cover img', '.product-images img', 'img[itemprop="image"]', '#bigpic',
    ]),
    waitSelectors: ['span[itemprop="price"]', '[itemprop="price"]', '.our_price_display'],
  },

  'mediagalaxy.ro': {
    name: 'Media Galaxy',
    isProduct: () => document.querySelector('.product-info-main') !== null
      || document.querySelector('[itemtype*="schema.org/Product"]') !== null
      || /\.html$/.test(location.pathname),
    getId: () => {
      const el = document.querySelector('[data-product-id]')
        || document.querySelector('input[name="product"]');
      if (el) {
        const id = el.getAttribute('data-product-id') || el.value;
        if (id) return `mediagalaxy:${id}`;
      }
      const og = document.querySelector('meta[property="product:retailer_item_id"]');
      if (og) return `mediagalaxy:${og.content}`;
      const m = location.pathname.match(/\/(\d{4,})\.html/);
      return m ? `mediagalaxy:${m[1]}` : null;
    },
    getTitle: () => qsText([
      '.page-title h1', 'h1.page-title', 'h1[itemprop="name"]', 'h1.product-name', 'h1',
    ]),
    getPrice: () => qsPrice([
      '[data-price-type="finalPrice"]',
      '.special-price .price', '.price-box .price',
      '[itemprop="price"]', '.price-final_price .price', '.price',
    ]),
    getImage: () => qsImage([
      '.product.media img.photo', '.fotorama__img', '.gallery-placeholder__image',
      'img[itemprop="image"]', '.product-image-photo',
    ]),
    waitSelectors: ['[data-price-type="finalPrice"]', '.price-box', '[itemprop="price"]'],
  },

  'dedeman.ro': {
    name: 'Dedeman',
    isProduct: () => document.querySelector('.product-info-main') !== null
      || document.querySelector('[itemtype*="schema.org/Product"]') !== null,
    getId: () => {
      const el = document.querySelector('[data-product-id]')
        || document.querySelector('input[name="product"]');
      if (el) {
        const id = el.getAttribute('data-product-id') || el.value;
        if (id) return `dedeman:${id}`;
      }
      const og = document.querySelector('meta[property="product:retailer_item_id"]');
      if (og) return `dedeman:${og.content}`;
      // Dedeman URLs: /ro/nume-produs/p/1043019
      const m = location.pathname.match(/\/p\/(\d{4,})\/?$/);
      return m ? `dedeman:${m[1]}` : null;
    },
    getTitle: () => qsText([
      '.page-title h1', 'h1.page-title-wrapper', 'h1[itemprop="name"]', 'h1',
    ]),
    getPrice: () => qsPrice([
      // Magento 2: data-price-amount holds the numeric value
      '[data-price-type="finalPrice"]',
      '.final-price', '.special-price .price',
      '.price-box .price', '[itemprop="price"]', '.price',
    ]),
    getImage: () => qsImage([
      '.gallery-placeholder__image',
      '.product.media img.photo', '.fotorama__img',
      'img[itemprop="image"]', '.product-image-photo',
    ]),
    waitSelectors: ['.final-price', '[data-price-type="finalPrice"]', '.price-box', '[itemprop="price"]'],
  },

  'ikea.com': {
    name: 'IKEA',
    // Romanian IKEA URLs: /ro/ro/p/name-XXXXXXXX/
    isProduct: () => /\/p\/[a-z0-9-]+-\d{8,}\/?$/i.test(location.pathname)
      || document.querySelector('.pip-price') !== null
      || document.querySelector('[class*="pip-header"]') !== null
      || document.querySelector('[class*="pip-price"]') !== null,
    getId: () => {
      // /ro/ro/p/billy-biblioteca-alb-00263850/ → 00263850
      const m = location.pathname.match(/-(\d{8})\/?$/);
      if (m) return `ikea:${m[1]}`;
      // Fallback: any 8+ digit number in path
      const m2 = location.pathname.match(/\/(\d{8,})\/?$/);
      if (m2) return `ikea:${m2[1]}`;
      const el = document.querySelector('[data-product-id]');
      return el ? `ikea:${el.getAttribute('data-product-id')}` : null;
    },
    getTitle: () => qsText([
      '.pip-header-section__title--big', '.pip-header-section__title',
      'h1[class*="pip"]', '.range-description-header__title',
      'h1[class*="header"]', 'h1',
    ]),
    getPrice: () => qsPrice([
      '.pip-price__integer', '.pip-price-module__price',
      '.range-description-price__numeric',
      '.pip-price', '[class*="pip-price"]', '.price',
    ]),
    getImage: () => qsImage([
      '.pip-media-list__item img', 'img[src*="ikea.com/ro/ro/images/products"]',
      '.range-image-aspect-ratio-box img',
      '.pip-image img', 'img[class*="pip-image"]',
    ]),
    waitSelectors: ['.pip-price', '.pip-price__integer', '[class*="pip-price"]'],
  },

  'zara.com': {
    name: 'Zara',
    // Romanian Zara URLs: /ro/ro/name-pNUMBER.html
    isProduct: () => /-p\d{7,}\.html/i.test(location.pathname)
      || document.querySelector('.product-detail-info') !== null
      || document.querySelector('[class*="product-detail-info"]') !== null,
    getId: () => {
      // /ro/ro/jacheta-p05619337.html → 05619337
      const m = location.pathname.match(/-p(\d{7,})\.html/i);
      if (m) return `zara:${m[1]}`;
      const m2 = location.pathname.match(/\/(\d{7,})\/?(?:\.html)?/);
      if (m2) return `zara:${m2[1]}`;
      const el = document.querySelector('[data-productid]') || document.querySelector('[data-product-id]');
      if (el) return `zara:${el.getAttribute('data-productid') || el.getAttribute('data-product-id')}`;
      return null;
    },
    getTitle: () => qsText([
      '.product-detail-info__header-name', 'h1[class*="product-detail"]',
      'h1[class*="product"]', '.product-name', 'h1',
    ]),
    getPrice: () => qsPrice([
      '.price__amount .money-amount__main', '.price__amount',
      '[class*="price-amount"]', '[class*="price__amount"]', '.price',
    ]),
    getImage: () => qsImage([
      '.media-image__image', '.product-media img',
      'img[class*="media-image"]', 'img[class*="product"]', '.image-container img',
    ]),
    waitSelectors: ['.product-detail-info', '.price__amount', '.price'],
  },

  'pentruacasa.com': {
    name: 'PentruAcasa',
    // URLs: /category/subcategory/product-name-pID/
    isProduct: () => /-p\d{3,}\/?$/.test(location.pathname)
      || document.querySelector('h1.pr-titlu') !== null
      || document.querySelector('.pret-c') !== null,
    getId: () => {
      const m = location.pathname.match(/-p(\d{3,})\/?$/);
      if (m) return `pentruacasa:${m[1]}`;
      const cod = document.querySelector('.cod-prod');
      if (cod) return `pentruacasa:${cod.textContent.trim()}`;
      return null;
    },
    getTitle: () => qsText(['h1.pr-titlu', '.pr-titlu', 'h1']),
    getPrice: () => qsPrice([
      'p.pret', '.pret-c p.pret', '.pret',
      '[itemprop="price"]', '.price',
    ]),
    getImage: () => qsImage([
      'img[src*="pentruacasa.com/continut/produse"]',
      'img[itemprop="image"]',
      '.produs-info img', '.produs img',
    ]),
    waitSelectors: ['p.pret', '.pret-c', 'h1.pr-titlu'],
  },
};

// ── Store detection ───────────────────────────────────────────────────────────

function detectStore() {
  const hostname = location.hostname.replace(/^www\./, '');
  if (STORES[hostname]) return STORES[hostname];
  for (const key of Object.keys(STORES)) {
    if (hostname === key || hostname.endsWith('.' + key)) return STORES[key];
  }
  return null;
}

// ── Wait for element ──────────────────────────────────────────────────────────

function waitFor(selectors, timeout = 7000) {
  if (!selectors || selectors.length === 0) return Promise.resolve(true);
  return new Promise(resolve => {
    const deadline = Date.now() + timeout;
    const tick = () => {
      for (const s of selectors) {
        if (document.querySelector(s)) return resolve(true);
      }
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 250);
    };
    tick();
  });
}

// ── Core ──────────────────────────────────────────────────────────────────────

let lastProcessedId = null;

async function processPage() {
  const store = detectStore();

  if (!store || !store.isProduct()) {
    chrome.storage.local.set({ [STORAGE_KEY]: null });
    return;
  }

  const productId = store.getId();
  if (!productId) {
    chrome.storage.local.set({ [STORAGE_KEY]: null });
    return;
  }

  if (productId === lastProcessedId) return;
  lastProcessedId = productId;

  chrome.storage.local.set({
    [STORAGE_KEY]: { emagId: productId, sursa: store.name, status: 'detecting', link: location.href },
  });

  await waitFor(store.waitSelectors);

  const title = store.getTitle();
  const price = store.getPrice();
  const image = store.getImage();
  const link  = location.href;

  if (!title || !price) {
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        emagId: productId, sursa: store.name,
        status: price ? 'extract_fail' : 'no_price',
        link,
      },
    });
    return;
  }

  chrome.storage.local.set({
    [STORAGE_KEY]: { emagId: productId, sursa: store.name, title, price, image, link, status: 'pending' },
  });

  try {
    const resp = await fetch(API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        emag_id: productId,
        nume:    title,
        link,
        poza:    image,
        pret:    price,
        sursa:   store.name,
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();

    chrome.storage.local.set({
      [STORAGE_KEY]: {
        emagId:       productId,
        sursa:        store.name,
        title, price, image, link,
        status:       data.status === 'ok' ? 'saved' : 'api_error',
        produsId:     data.produs_id  ?? null,
        pretalertUrl: data.url        ?? null,
        savedAt:      Date.now(),
      },
    });

    chrome.runtime.sendMessage({ type: 'PRODUCT_SAVED', emagId: productId, storeName: store.name });

  } catch (err) {
    console.warn('[PretAlert] API error:', err.message);
    chrome.storage.local.set({
      [STORAGE_KEY]: { emagId: productId, sursa: store.name, title, price, image, link, status: 'offline' },
    });
  }
}

// ── Pornire + SPA navigation ──────────────────────────────────────────────────

let _lastHref = location.href;
const _observer = new MutationObserver(() => {
  if (location.href !== _lastHref) {
    _lastHref       = location.href;
    lastProcessedId = null;
    setTimeout(processPage, 500);
  }
});
_observer.observe(document.body, { childList: true, subtree: true });

// Cere tabId de la background pentru cheie de storage izolată per-tab
chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (resp) => {
  if (chrome.runtime.lastError) { /* extensia reîncărcată – ignoră */ }
  if (resp?.tabId) STORAGE_KEY = `pretalert_product_${resp.tabId}`;
  processPage();
});
