'use strict';

const sdot          = document.getElementById('sdot');
const stxt          = document.getElementById('stxt');
const section       = document.getElementById('main-section');
const actionsSection = document.getElementById('actions-section');
const emailInput    = document.getElementById('email-input');
const pretInput     = document.getElementById('pret-input');
const btnFav        = document.getElementById('btn-fav');
const btnAlert      = document.getElementById('btn-alert');
const confirmMsg    = document.getElementById('confirm-msg');
const storesSection = document.getElementById('stores-section');
const storesGrid    = document.getElementById('stores-grid');
const btnView       = document.getElementById('btn-view');

const SUPPORTED_STORES = [
  { domain: 'emag.ro',        name: 'eMAG' },
  { domain: 'altex.ro',       name: 'Altex' },
  { domain: 'flanco.ro',      name: 'Flanco' },
  { domain: 'cel.ro',         name: 'CEL' },
  { domain: 'pcgarage.ro',    name: 'PC Garage' },
  { domain: 'evomag.ro',      name: 'EvoMag' },
  { domain: 'mediagalaxy.ro', name: 'Media Galaxy' },
  { domain: 'dedeman.ro',     name: 'Dedeman' },
  { domain: 'ikea.com',          name: 'IKEA' },
  { domain: 'zara.com',          name: 'Zara' },
  { domain: 'pentruacasa.com',   name: 'PentruAcasa' },
];

const STATUS_MAP = {
  saved:        ['saved',   '✓ Salvat pe PretAlert'],
  pending:      ['pending', '⏳ Se salvează...'],
  detecting:    ['pending', '🔍 Detectare produs...'],
  offline:      ['offline', '⚡ Offline – va fi reîncercat'],
  api_error:    ['error',   '✗ Eroare server'],
  extract_fail: ['error',   '✗ Nu s-a putut extrage prețul'],
  no_price:     ['error',   '✗ Preț negăsit'],
};

function getActiveStore(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return SUPPORTED_STORES.find(s => hostname === s.domain || hostname.endsWith('.' + s.domain));
  } catch {
    return null;
  }
}

function setStatus(dotClass, text) {
  sdot.className = 'dot ' + dotClass;
  stxt.textContent = text;
}

function fmt(price) {
  return price.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderEmpty(emoji, msg) {
  section.innerHTML = `
    <div class="placeholder">
      <div class="big-emoji">${emoji}</div>
      <p>${msg}</p>
    </div>`;
}

function renderLoading(msg = 'Se detectează produsul...') {
  section.innerHTML = `
    <div class="loading-row">
      <div class="spin"></div>
      <span>${msg}</span>
    </div>`;
}

function renderProduct(p) {
  const [badgeClass, badgeLabel] = STATUS_MAP[p.status] ?? ['pending', '⏳ Se procesează...'];

  const imgHTML = p.image
    ? `<img src="${p.image}" alt="" onerror="this.parentElement.innerHTML='<span class=fallback>📦</span>'">`
    : `<span class="fallback">📦</span>`;

  const storeLabel = p.sursa ? `<div class="pstore">${p.sursa}</div>` : '';

  section.innerHTML = `
    <div class="product-card">
      <div class="pimg-wrap">${imgHTML}</div>
      <div class="pinfo">
        <div class="pname">${p.title ?? 'Produs'}</div>
        ${storeLabel}
        ${p.price ? `<div class="pprice">${fmt(p.price)}<span class="currency">Lei</span></div>` : ''}
        <div class="sbadge ${badgeClass}">${badgeLabel}</div>
      </div>
    </div>`;

  if (p.pretalertUrl) {
    btnView.href = p.pretalertUrl;
    btnView.classList.remove('hidden');
  }
}

let _confirmTimer = null;
function showConfirm(type, msg) {
  confirmMsg.className = 'confirm-msg ' + type;
  confirmMsg.textContent = msg;
  confirmMsg.style.display = 'block';
  clearTimeout(_confirmTimer);
  _confirmTimer = setTimeout(() => { confirmMsg.style.display = 'none'; }, 4000);
}

function showActions(produsId) {
  actionsSection.style.display = 'block';

  chrome.storage.local.get('pretalert_email', ({ pretalert_email: saved }) => {
    if (saved) emailInput.value = saved;
  });

  btnFav.onclick = async () => {
    const email = emailInput.value.trim();
    if (!email) { showConfirm('error', 'Introdu email-ul contului PretAlert'); return; }
    chrome.storage.local.set({ pretalert_email: email });
    btnFav.disabled = true;
    try {
      const r = await fetch('https://www.pretalert.ro/api/extensie/favorit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produs_id: produsId, email }),
      });
      const d = await r.json();
      showConfirm(d.status === 'ok' ? 'ok' : 'error',
        d.status === 'ok' ? '✓ Adăugat la favorite!' : d.mesaj);
    } catch {
      showConfirm('error', 'Eroare de rețea');
    }
    btnFav.disabled = false;
  };

  btnAlert.onclick = async () => {
    const email = emailInput.value.trim();
    const pret  = parseFloat(pretInput.value);
    if (!email)           { showConfirm('error', 'Introdu email-ul contului PretAlert'); return; }
    if (!pret || pret <= 0) { showConfirm('error', 'Introdu un preț dorit valid'); return; }
    chrome.storage.local.set({ pretalert_email: email });
    btnAlert.disabled = true;
    try {
      const r = await fetch('https://www.pretalert.ro/api/extensie/alerta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produs_id: produsId, email, pret_dorit: pret }),
      });
      const d = await r.json();
      showConfirm(d.status === 'ok' ? 'ok' : 'error',
        d.status === 'ok' ? '✓ Alertă setată!' : d.mesaj);
    } catch {
      showConfirm('error', 'Eroare de rețea');
    }
    btnAlert.disabled = false;
  };
}

function renderStoresList(activeStoreName) {
  storesGrid.innerHTML = '';
  for (const s of SUPPORTED_STORES) {
    const chip = document.createElement('span');
    chip.className = 'store-chip' + (s.name === activeStoreName ? ' active' : '');
    chip.textContent = s.name;
    storesGrid.appendChild(chip);
  }
  storesSection.style.display = 'block';
}

async function init() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    setStatus('grey', 'Eroare la tab');
    renderEmpty('⚠️', 'Nu se poate citi tab-ul activ.');
    return;
  }

  const url         = tab?.url ?? '';
  const activeStore = getActiveStore(url);

  if (!activeStore) {
    setStatus('grey', 'Magazin nesuptat');
    renderEmpty('🛒', 'Deschide un magazin suportat pentru a urmări prețul.');
    renderStoresList(null);
    return;
  }

  let pathname = '';
  try { pathname = new URL(url).pathname; } catch { /* ignore */ }

  // Simplified product page detection by store
  const productPatterns = {
    'emag.ro':        /\/pd\/[A-Z0-9]+/i,
    'altex.ro':       /[/-]p\d{4,}\/?$/,
    'ikea.com':       /\/catalog\/products\//,
    'cel.ro':         /\/produs\//,
    'pcgarage.ro':    /\/produs\//,
    'evomag.ro':      /\/produs\//,
  };
  const pattern = productPatterns[activeStore.domain];
  const onProduct = pattern ? pattern.test(pathname) : (pathname.endsWith('.html') || /\/\d{4,}/.test(pathname));

  if (!onProduct) {
    setStatus('green', `Activ pe ${activeStore.name}`);
    renderEmpty('🔎', `Navighează pe o pagină de produs pe ${activeStore.name} pentru a activa urmărirea.`);
    renderStoresList(activeStore.name);
    return;
  }

  setStatus('blue', `Activ pe ${activeStore.name} – pagină produs`);
  renderStoresList(activeStore.name);

  const storageKey = `pretalert_product_${tab.id}`;
  chrome.storage.local.get(storageKey, (result) => {
    const p = result[storageKey];
    if (!p) { renderLoading(); return; }

    if (p.status === 'saved') {
      setStatus('green', `Activ pe ${activeStore.name} – produs salvat`);
      if (p.produsId) showActions(p.produsId);
    }
    renderProduct(p);
  });
}

init();
