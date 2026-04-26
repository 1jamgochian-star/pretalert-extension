/**
 * PretAlert service worker – gestionează badge-ul și notificările
 * pentru toate magazinele suportate.
 */
'use strict';

const BADGE_ON    = { text: 'ON', color: '#00b4d8' };
const BADGE_SAVED = { text: '✓',  color: '#22c55e' };
const BADGE_STORE = { text: '·',  color: '#475569' };
const BADGE_OFF   = { text: '',   color: '#475569' };

const SUPPORTED_DOMAINS = [
  'emag.ro', 'altex.ro', 'flanco.ro', 'cel.ro', 'pcgarage.ro',
  'evomag.ro', 'mediagalaxy.ro', 'dedeman.ro', 'ikea.com', 'zara.com',
];

function getStoreDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return SUPPORTED_DOMAINS.find(d => hostname === d || hostname.endsWith('.' + d)) || null;
  } catch {
    return null;
  }
}

function isProductUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, '');
    if (host.endsWith('emag.ro'))        return /\/pd\/[A-Z0-9]+/i.test(pathname);
    if (host.endsWith('altex.ro'))       return /[/-]p\d{4,}\/?$/.test(pathname);
    if (host.endsWith('ikea.com'))       return /\/catalog\/products\//.test(pathname);
    if (host.endsWith('cel.ro'))         return /\/produs\//.test(pathname);
    if (host.endsWith('pcgarage.ro'))    return /\/produs\//.test(pathname);
    if (host.endsWith('evomag.ro'))      return /\/produs\//.test(pathname);
    // Magento-based stores (flanco, mediagalaxy, dedeman) and Zara
    return pathname.endsWith('.html') || /\/\d{4,}/.test(pathname);
  } catch {
    return false;
  }
}

function setTabBadge(tabId, badge) {
  chrome.action.setBadgeText({ text: badge.text, tabId });
  chrome.action.setBadgeBackgroundColor({ color: badge.color, tabId });
}

function updateBadgeForTab(tabId, url) {
  const domain = getStoreDomain(url);
  if (!domain) {
    setTabBadge(tabId, BADGE_OFF);
    return;
  }
  if (isProductUrl(url)) {
    setTabBadge(tabId, BADGE_ON);
  } else {
    setTabBadge(tabId, BADGE_STORE);
  }
}

// ── Listeners ─────────────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateBadgeForTab(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, tab => {
    if (tab?.url) updateBadgeForTab(tabId, tab.url);
  });
});

// Curăță storage-ul când tab-ul e închis
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(`pretalert_product_${tabId}`);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id ?? null });
    return false;
  }

  if (msg.type === 'PRODUCT_SAVED' && sender.tab?.id) {
    setTabBadge(sender.tab.id, BADGE_SAVED);

    chrome.notifications.create(`pa-${msg.emagId}`, {
      type:    'basic',
      iconUrl: 'icons/icon48.png',
      title:   'PretAlert – Produs salvat!',
      message: `Produsul de pe ${msg.storeName} a fost adăugat în lista ta de urmărire.`,
    });

    setTimeout(() => {
      chrome.tabs.get(sender.tab.id, tab => {
        if (tab?.url && getStoreDomain(tab.url)) {
          updateBadgeForTab(sender.tab.id, tab.url);
        }
      });
    }, 4000);
  }
});
