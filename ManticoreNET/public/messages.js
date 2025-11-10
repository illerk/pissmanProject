// compute base
const BASE = location.pathname.replace(/\/[^/]*$/, '');

// top code
const currentUser = localStorage.getItem("currentUser");
// NEW: guest sentinel
const GUEST_ID = "__guest__";
// redirect guests away from messages page (they cannot send messages)
if (!currentUser || currentUser === GUEST_ID) location.href = "feed.html";
document.body.classList.add("logged-in");

const contactsPane = document.getElementById("contactsPane");
const messagesPane = document.getElementById("messagesPane");
const chatHeader = document.getElementById("chatHeader");
const msgInput = document.getElementById("msgInput");
const msgImage = document.getElementById("msgImage");
const overlay = document.getElementById("overlay");
const overlayImg = document.getElementById("overlayImg");

const logoutTopBtn = document.getElementById("logoutTopBtn");
if (logoutTopBtn) logoutTopBtn.addEventListener("click", () => { localStorage.removeItem("currentUser"); location.href = "index.html"; });

// compute ws base (path part of current URL)
const basePath = location.pathname.replace(/\/[^/]*$/, ''); // e.g. "/ManticoreNET"
const proto = location.protocol === "https:" ? "wss" : "ws";
// build ws URL relative to current location so sub-paths are respected
const wsUrl = `${proto}://${location.host}${basePath}/ws`;
const ws = new WebSocket(wsUrl);
ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "auth", username: currentUser }));
});
ws.addEventListener("message", (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch (e) { return; }
  if (msg.type === "message") {
    const m = msg.message;
    // if conversation with m.from or m.to is currently open, append
    const partner = (m.from === currentUser) ? m.to : m.from;
    if (partner === selectedContact) {
      // call async function to append
      (async () => { await appendMessage(m, m.from === currentUser); })();
      // server already marked as read for this user when opening conversation via GET.
      // optionally ensure unread refreshed.
      refreshUnread();
    } else {
      // increment local unread count (so it shows immediately)
      unreadCounts[m.from] = (unreadCounts[m.from] || 0) + 1;
      setContactBadge(m.from, unreadCounts[m.from]);
    }
    // update menu badge
    updateMenuBadge();
  }
});

// add: explicit API root
const API_ROOT = "https://immersivethingsforsierra.ru/ManticoreNET/api";
// add: assets root for avatars/posts (serve from /ManticoreNET/public)
const ASSET_ROOT = "https://immersivethingsforsierra.ru/ManticoreNET/public";
function resolveAsset(url) {
  if (!url) return url;
  if (/^(https?:|data:)/.test(url)) return url;
  if (url.startsWith("/")) return ASSET_ROOT + url;
  return url;
}

// unified fetch that resolves relative to current page (preserves sub-path)
async function fetchJson(url, opts) {
  try {
    let full;
    if (/^https?:\/\//.test(url)) full = url;
    else if (url.startsWith("/api/")) full = API_ROOT + url.slice(4);
    else if (url.startsWith("api/")) full = API_ROOT + url.slice(3);
    else full = new URL(url, location.href).href;
    const r = await fetch(full, opts);
    return { ok: r.ok, data: await r.json() };
  } catch (e) { return { ok: false, data: null }; }
}

// add: cache for user profiles/avatars
const userCache = {};
async function getUserAvatar(username) {
  if (!username) return "default-avatar.png";
  if (userCache[username]) return userCache[username].avatar || "default-avatar.png";
  const { ok, data } = await fetchJson(`/api/user/${encodeURIComponent(username)}`);
  if (ok && data && data.success) {
    userCache[username] = data.profile;
    if (userCache[username].avatar) userCache[username].avatar = resolveAsset(userCache[username].avatar);
    return userCache[username].avatar || "default-avatar.png";
  }
  return "default-avatar.png";
}

// add: client-side unread map and DOM references
const unreadCounts = {}; // partner -> count
const contactElements = new Map(); // username -> { itemEl, badgeEl }
const navMessagesEl = document.getElementById('nav-messages');

// add near top (keep previous total for notifications)
let __prevUnreadTotal = 0;

// create or update badge helper
function ensureContactBadge(username, parentEl) {
  let entry = contactElements.get(username);
  if (!entry) {
    const badge = document.createElement('span');
    badge.className = 'unread-badge';
    badge.style.display = 'none';
    badge.style.marginLeft = '6px';
    // attach later beside name; return entry
    entry = { badgeEl: badge, itemEl: parentEl };
    contactElements.set(username, entry);
  }
  return entry;
}

function setContactBadge(username, count) {
  const entry = contactElements.get(username);
  if (!entry) return;
  if (count && count > 0) {
    entry.badgeEl.textContent = count > 99 ? '99+' : String(count);
    entry.badgeEl.style.display = '';
  } else {
    entry.badgeEl.style.display = 'none';
  }
  // update global menu badge
  updateMenuBadge();
}

function updateMenuBadge() {
  const total = Object.values(unreadCounts).reduce((s,n)=>s+(n||0),0);
  if (!navMessagesEl) return;
  let menuBadge = navMessagesEl.querySelector('.unread-badge');
  if (!menuBadge) {
    menuBadge = document.createElement('span');
    menuBadge.className = 'unread-badge';
    menuBadge.style.marginLeft = '8px';
    navMessagesEl.appendChild(menuBadge);
  }
  if (total > 0) {
    menuBadge.textContent = total > 99 ? '99+' : String(total);
    menuBadge.style.display = '';
  } else {
    menuBadge.style.display = 'none';
  }
}

// fetch unread from server and update badges
async function refreshUnread() {
  const { ok, data } = await fetchJson(`/api/unread/${encodeURIComponent(currentUser)}`);
  if (!ok || !data || !data.success) return;
  // replace unreadCounts
  Object.keys(unreadCounts).forEach(k=>delete unreadCounts[k]);
  Object.assign(unreadCounts, data.unread || {});
  // apply to contact elements
  for (const [username, entry] of contactElements.entries()) {
    setContactBadge(username, unreadCounts[username] || 0);
  }
  updateMenuBadge();

  // show desktop notification if total increased
  try {
    const total = Object.values(unreadCounts).reduce((s,n)=>s+(n||0),0);
    if (total > __prevUnreadTotal) {
      // request permission if needed
      if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        try { await Notification.requestPermission(); } catch(e) {}
      }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const diff = total - __prevUnreadTotal;
        const title = 'ManticoreNET — New messages';
        const body = diff === 1 ? 'You have 1 new message' : `You have ${diff} new messages`;
        const n = new Notification(title, { body, icon: '/default-avatar.png' });
        setTimeout(()=>{ try { n.close(); } catch(e){} }, 8000);
      }
    }
    __prevUnreadTotal = total;
  } catch(e){}
}

// load contacts
let contacts = [];
let selectedContact = null;
async function loadContacts() {
  contactsPane.innerHTML = "Loading...";
  const { ok, data } = await fetchJson("api/users");
  if (!ok || !data.users) { contactsPane.innerHTML = "<div style='color:#f66'>Failed</div>"; return; }
  contacts = data.users.filter(u => u.username !== currentUser);
  contactsPane.innerHTML = "";
  // store contacts in cache with resolved avatar URLs so later lookups use full /ManticoreNET/public path
  contacts.forEach(u => {
    userCache[u.username] = { ...u, avatar: resolveAsset(u.avatar) || u.avatar };
  });

  for (const u of contacts) {
    const item = document.createElement("div");
    item.style.display = "flex"; item.style.alignItems = "center"; item.style.gap = "8px"; item.style.cursor="pointer";
    item.style.padding="6px"; item.style.border="1px solid rgba(255,255,255,0.03)"; item.style.borderRadius="6px";
    const img = document.createElement("img");
    img.src = resolveAsset(u.avatar) || "default-avatar.png";
    img.style.width="40px"; img.style.height="40px"; img.style.borderRadius="6px";
    img.style.objectFit = "cover";
    img.addEventListener("click", ()=> location.href = new URL(`profile.html?user=${encodeURIComponent(u.username)}`, location.href).href);
    const name = document.createElement("div"); name.textContent = u.username; name.style.fontWeight="600";
    item.appendChild(img); item.appendChild(name);

    // badge
    const entry = ensureContactBadge(u.username, item);
    item.appendChild(entry.badgeEl);

    item.addEventListener("click", async () => {
      await selectContact(u.username);
      // after opening conversation, refresh unread (server marks read on GET)
      await refreshUnread();
    });
    contactsPane.appendChild(item);
  }

  // initial unread refresh after contacts are in DOM
  await refreshUnread();
}

// load conversation history via REST — use async loop and await appendMessage
async function loadHistory(withUser) {
  messagesPane.innerHTML = "Loading history...";
  const { ok, data } = await fetchJson(`/api/messages/${encodeURIComponent(currentUser)}/${encodeURIComponent(withUser)}`);
  if (!ok || !data.messages) { messagesPane.innerHTML = "<div style='color:#f66'>Failed to load history</div>"; return; }
  messagesPane.innerHTML = "";
  for (const m of data.messages) {
    await appendMessage(m, m.from === currentUser);
  }
  messagesPane.scrollTop = messagesPane.scrollHeight;
}

// add: format date shifted by 313 years
function formatFutureDate(ts) {
  const d = new Date(Number(ts));
  d.setFullYear(d.getFullYear() + 313);
  return d.toLocaleString();
}

// ensure avatars are displayed as squares (object-fit: cover) where created
// update appendMessage to set objectFit and to be async (uses getUserAvatar)
async function appendMessage(m, mine) {
  const b = document.createElement("div");
  b.style.display = "flex"; b.style.gap="8px"; b.style.alignItems="flex-start";
  if (mine) b.style.justifyContent = "flex-end";

  // get avatar for message sender (already resolved by getUserAvatar)
  const avatarSrc = await getUserAvatar(m.from);

  const img = document.createElement("img");
  img.src = avatarSrc;
  img.style.width = "32px"; img.style.height = "32px"; img.style.borderRadius = "6px";
  img.style.objectFit = "cover"; // ensure square crop
  img.style.cursor = "pointer";
  img.addEventListener("click", ()=> location.href = `profile.html?user=${encodeURIComponent(m.from)}`);

  const content = document.createElement("div"); content.style.maxWidth = "70%";
  const meta = document.createElement("div"); meta.style.fontSize="0.85rem"; meta.style.color="#999";
  meta.textContent = `${m.from} · ${formatFutureDate(m.createdAt)}`;
  content.appendChild(meta);

  if (m.text) {
    const txt = document.createElement("div"); txt.textContent = m.text; txt.style.marginTop = "6px";
    content.appendChild(txt);
  }
  if (m.image) {
    const im = document.createElement("img");
    im.src = resolveAsset(m.image) || m.image;
    im.style.maxWidth = "240px"; im.style.marginTop="6px"; im.style.borderRadius="6px"; im.style.cursor="pointer";
    im.addEventListener("click", ()=> { overlayImg.src = im.src; overlay.classList.add("visible"); });
    content.appendChild(im);
  }

  if (mine) { b.appendChild(content); b.appendChild(img); }
  else { b.appendChild(img); b.appendChild(content); }

  messagesPane.appendChild(b);
  // ensure scroll to bottom
  messagesPane.scrollTop = messagesPane.scrollHeight;
}

// select contact
async function selectContact(username) {
  selectedContact = username;
  chatHeader.textContent = username;
  await loadHistory(username);
  // server marks messages read for current user in GET /api/messages; refresh badges
  await refreshUnread();
}

// sendMessage extracted and used by Enter handler
async function sendMessage() {
  if (!selectedContact) return alert("Select a contact");
  const text = msgInput.value.trim();
  const f = msgImage.files[0];
  if (f) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const payload = { type: "message", from: currentUser, to: selectedContact, text, image: dataUrl };
      ws.send(JSON.stringify(payload));
      msgInput.value = ""; msgImage.value = "";
      adjustInputHeight(); // reset height
    };
    reader.readAsDataURL(f);
  } else {
    const payload = { type: "message", from: currentUser, to: selectedContact, text };
    ws.send(JSON.stringify(payload));
    msgInput.value = "";
    adjustInputHeight(); // reset height
  }
}

// Enter sends (Shift+Enter -> newline)
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// dynamic height adjustment: autosize textarea height to content, clamped by max-height
function adjustInputHeight() {
  // reset to auto to measure scrollHeight
  msgInput.style.height = 'auto';
  const maxH = 300; // px
  const newH = Math.min(maxH, msgInput.scrollHeight);
  msgInput.style.height = newH + 'px';
}
msgInput.addEventListener("input", () => {
  adjustInputHeight();
});

// initialize input height on load
adjustInputHeight();

// ensure nav handlers exist on messages page so other tabs open
const navProfileBtn = document.getElementById('nav-profile');
if (navProfileBtn) navProfileBtn.addEventListener('click', () => {
  if (!localStorage.getItem('currentUser')) return window.location.href = 'index.html';
  window.location.href = 'profile.html';
});
const navContactsBtn = document.getElementById('nav-contacts');
if (navContactsBtn) navContactsBtn.addEventListener('click', () => {
  if (!localStorage.getItem('currentUser')) return window.location.href = 'index.html';
  window.location.href = 'profile.html#contacts';
});
const navFeedBtn = document.getElementById('nav-feed');
if (navFeedBtn) navFeedBtn.addEventListener('click', () => {
  if (!localStorage.getItem('currentUser')) return window.location.href = 'index.html';
  window.location.href = 'feed.html';
});
const navMessagesBtn = document.getElementById('nav-messages');
if (navMessagesBtn) navMessagesBtn.addEventListener('click', () => {
  if (!localStorage.getItem('currentUser')) return window.location.href = 'index.html';
  // already on messages page — optionally focus
});

// periodically refresh unread badges (menu + contact badges)
setInterval(() => {
  refreshUnread().catch(()=>{});
}, 15000);

// initial unread refresh for messages page menu badge immediately
(async () => {
  await refreshUnread();
})();

// initial load
loadContacts();
