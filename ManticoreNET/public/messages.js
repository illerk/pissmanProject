const BASE = location.pathname.replace(/\/[^/]*$/, '');

const currentUser = localStorage.getItem("currentUser");
if (!currentUser) location.href = "index.html";
if (currentUser === "GUEST") location.href = "feed.html";
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

const basePath = location.pathname.replace(/\/[^/]*$/, '');
const proto = location.protocol === "https:" ? "wss" : "ws";
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
    const partner = (m.from === currentUser) ? m.to : m.from;
    if (partner === selectedContact) {
      (async () => { await appendMessage(m, m.from === currentUser); })();
      refreshUnread();
    } else {
      unreadCounts[m.from] = (unreadCounts[m.from] || 0) + 1;
      setContactBadge(m.from, unreadCounts[m.from]);
    }
    updateMenuBadge();
  }
});

const API_ROOT = "https://immersivethingsforsierra.ru/ManticoreNET/api";
const ASSET_ROOT = "https://immersivethingsforsierra.ru/ManticoreNET/public";
function resolveAsset(url) {
  if (!url) return url;
  if (/^(https?:|data:)/.test(url)) return url;
  if (url.startsWith("/")) return ASSET_ROOT + url;
  return url;
}

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

const unreadCounts = {};
const contactElements = new Map();
const navMessagesEl = document.getElementById('nav-messages');

function ensureContactBadge(username, parentEl) {
  let entry = contactElements.get(username);
  if (!entry) {
    const badge = document.createElement('span');
    badge.className = 'unread-badge';
    badge.style.display = 'none';
    badge.style.marginLeft = '6px';
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

async function refreshUnread() {
  const { ok, data } = await fetchJson(`/api/unread/${encodeURIComponent(currentUser)}`);
  if (!ok || !data || !data.success) return;
  Object.keys(unreadCounts).forEach(k=>delete unreadCounts[k]);
  Object.assign(unreadCounts, data.unread || {});
  for (const [username, entry] of contactElements.entries()) {
    setContactBadge(username, unreadCounts[username] || 0);
  }
  updateMenuBadge();
}

let contacts = [];
let selectedContact = null;
async function loadContacts() {
  contactsPane.innerHTML = "Loading...";
  const { ok, data } = await fetchJson("api/users");
  if (!ok || !data.users) { contactsPane.innerHTML = "<div style='color:#f66'>Failed</div>"; return; }
  contacts = data.users.filter(u => u.username !== currentUser);
  contactsPane.innerHTML = "";
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

    const entry = ensureContactBadge(u.username, item);
    item.appendChild(entry.badgeEl);

    item.addEventListener("click", async () => {
      await selectContact(u.username);
      await refreshUnread();
    });
    contactsPane.appendChild(item);
  }

  await refreshUnread();
}

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

function formatFutureDate(ts) {
  const d = new Date(Number(ts));
  d.setFullYear(d.getFullYear() + 313);
  return d.toLocaleString();
}

async function appendMessage(m, mine) {
  const b = document.createElement("div");
  b.style.display = "flex"; b.style.gap="8px"; b.style.alignItems="flex-start";
  if (mine) b.style.justifyContent = "flex-end";

  const avatarSrc = await getUserAvatar(m.from);

  const img = document.createElement("img");
  img.src = avatarSrc;
  img.style.width = "32px"; img.style.height = "32px"; img.style.borderRadius = "6px";
  img.style.objectFit = "cover";
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
  messagesPane.scrollTop = messagesPane.scrollHeight;
}

async function selectContact(username) {
  selectedContact = username;
  chatHeader.textContent = username;
  await loadHistory(username);
  await refreshUnread();
}

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
      adjustInputHeight();
    };
    reader.readAsDataURL(f);
  } else {
    const payload = { type: "message", from: currentUser, to: selectedContact, text };
    ws.send(JSON.stringify(payload));
    msgInput.value = "";
    adjustInputHeight();
  }
}

msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function adjustInputHeight() {
  msgInput.style.height = 'auto';
  const maxH = 300;
  const newH = Math.min(maxH, msgInput.scrollHeight);
  msgInput.style.height = newH + 'px';
}
msgInput.addEventListener("input", () => {
  adjustInputHeight();
});

adjustInputHeight();

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
});

setInterval(() => {
  refreshUnread().catch(()=>{});
}, 15000);

(async () => {
  await refreshUnread();
})();

loadContacts();
