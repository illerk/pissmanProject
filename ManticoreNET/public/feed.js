const currentUser = localStorage.getItem('currentUser');
if (!currentUser) {
  window.location.href = 'index.html';
}
document.body.classList.add('logged-in');

const headerSearch = document.getElementById('headerSearch');
const logoutTopBtn = document.getElementById('logoutTopBtn');
const postTextFeed = document.getElementById('postTextFeed');
const postImageInputFeed = document.getElementById('postImageInputFeed');
const createPostBtnFeed = document.getElementById('createPostBtnFeed');
const feedPosts = document.getElementById('feedPosts');

const basePath = location.pathname.replace(/\/[^/]*$/, '');
const proto = location.protocol === "https:" ? "wss" : "ws";
const wsUrl = `${proto}://${location.host}${basePath}/ws`;

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

// unified fetch
async function fetchJson(url, opts) {
  try {
    let full;
    if (/^https?:\/\//.test(url)) full = url;
    else if (url.startsWith("/api/")) full = API_ROOT + url.slice(4);
    else if (url.startsWith("api/")) full = API_ROOT + url.slice(3);
    else full = new URL(url, location.href).href;
    const res = await fetch(full, opts);
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, data: { error: 'Network error' } };
  }
}

function formatFutureDate(ts) {
  const d = new Date(Number(ts));
  d.setFullYear(d.getFullYear() + 313);
  return d.toLocaleString();
}

const userCache = {};
async function getUserProfile(username) {
  if (!username) return null;
  if (userCache[username]) return userCache[username];
  const r = await fetchJson(`/api/user/${encodeURIComponent(username)}`);
  if (r.ok && r.data.success) {
    const prof = r.data.profile;
    if (prof && prof.avatar) prof.avatar = resolveAsset(prof.avatar);
    userCache[username] = prof;
    return prof;
  }
  return null;
}

async function loadFeed(options = { preserveScroll: true }) {
  const container = feedPosts;
  const prevScroll = options.preserveScroll ? container.scrollTop : 0;
  feedPosts.innerHTML = 'Loading...';
  const { ok, data } = await fetchJson('/api/posts');
  if (!ok || !data.posts) { feedPosts.innerHTML = '<div style="color:#f66">Failed to load feed</div>'; return; }
  await renderPosts(data.posts);
  if (options.preserveScroll) {
    setTimeout(()=>{ container.scrollTop = prevScroll; }, 0);
  }
}

async function renderPosts(posts) {
  feedPosts.innerHTML = '';
  if (!posts.length) { feedPosts.innerHTML = "<div style='color:#aaa'>No posts yet.</div>"; return; }
  for (const post of posts) {
    const author = await getUserProfile(post.username);
    const el = document.createElement('div');
    el.className = 'post';
    el.style.border = '1px solid rgba(255,255,255,0.04)';
    el.style.padding = '12px';
    el.style.borderRadius = '8px';
    el.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.00))';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '8px';

    const authorImg = document.createElement('img');
    authorImg.src = resolveAsset(author?.avatar) || 'default-avatar.png';
    authorImg.style.width = '36px';
    authorImg.style.height = '36px';
    authorImg.style.objectFit = 'cover';
    authorImg.style.borderRadius = '6px';
    authorImg.style.cursor = 'pointer';
    authorImg.addEventListener('click', () => {
      window.location.href = `profile.html?user=${encodeURIComponent(post.username)}`;
    });

    const nameDiv = document.createElement('div');
    nameDiv.innerHTML = `<div style="font-weight:700">${post.username}</div>
                         <div style="color:#999;font-size:0.85rem">${formatFutureDate(post.createdAt)}</div>`;

    left.appendChild(authorImg);
    left.appendChild(nameDiv);
    header.appendChild(left);
    el.appendChild(header);

    if (post.text) { const txt = document.createElement('div'); txt.style.marginTop='8px'; txt.textContent = post.text; el.appendChild(txt); }
    if (post.image) {
      const img = document.createElement('img');
      const resolved = resolveAsset(post.image);
      img.src = resolved ? (resolved + (resolved.includes("?") ? "&" : "?") + "t=" + Date.now()) : '';
      img.style.maxWidth='100%'; img.style.marginTop='8px'; img.style.borderRadius='6px'; img.style.cursor='pointer';
      img.addEventListener('click', ()=>{ document.getElementById('overlayImg').src = img.src; document.getElementById('overlay').classList.add('visible'); });
      el.appendChild(img);
    }

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '8px';
    actions.style.marginTop = '10px';

    el.appendChild(actions);

    // --- NEW: comments toggle (hidden by default) ---
    const commentsToggle = document.createElement('button');
    commentsToggle.className = 'comments-toggle';
    commentsToggle.style.marginTop = '8px';
    commentsToggle.textContent = 'Show comments';
    const commentsSection = document.createElement('div');
    commentsSection.style.display = 'none';
    commentsSection.style.marginTop = '10px';
    commentsSection.style.borderTop = '1px solid rgba(255,255,255,0.03)';
    commentsSection.style.paddingTop = '10px';
    const commentsList = document.createElement('div');
    commentsList.style.display = 'flex';
    commentsList.style.flexDirection = 'column';
    commentsList.style.gap = '6px';
    commentsSection.appendChild(commentsList);

    commentsToggle.addEventListener('click', async () => {
      const opening = commentsSection.style.display === 'none';
      if (opening) {
        await loadCommentsForPost(post.id, commentsList);
        if (currentUser) {
          // avoid adding multiple composers when toggling repeatedly
          if (!commentsSection.querySelector('.comment-composer')) {
            const composer = document.createElement('div');
            composer.className = 'comment-composer';
            composer.style.display = 'flex';
            composer.style.gap = '8px';
            composer.style.marginTop = '8px';
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Write a comment...';
            input.style.flex = '1';
            input.style.background = 'transparent';
            input.style.border = '1px solid rgba(255,255,255,0.06)';
            input.style.color = '#fff';
            input.style.padding = '6px';
            input.style.borderRadius = '6px';
            const btn = document.createElement('button');
            btn.textContent = 'Comment';
            btn.addEventListener('click', async () => {
              const txt = input.value.trim();
              if (!txt) return;
              const { ok } = await fetchJson(`/api/comments/${encodeURIComponent(post.id)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: currentUser, text: txt })
              });
              if (ok) {
                input.value = '';
                await loadCommentsForPost(post.id, commentsList);
              } else {
                console.warn('Failed to post comment');
              }
            });
            composer.appendChild(input);
            composer.appendChild(btn);
            commentsSection.appendChild(composer);
          }
        }
        commentsToggle.textContent = 'Hide comments';
        commentsSection.style.display = '';
      } else {
        commentsSection.style.display = 'none';
        commentsToggle.textContent = 'Show comments';
      }
    });

    el.appendChild(commentsToggle);
    el.appendChild(commentsSection);
    feedPosts.appendChild(el);

    // do not auto-load comments
  }
}

// NEW helper for feed.js
async function loadCommentsForPost(postId, container) {
  container.innerHTML = 'Loading comments...';
  const { ok, data } = await fetchJson(`/api/comments/${encodeURIComponent(postId)}`);
  if (!ok || !data || !Array.isArray(data.comments)) {
    container.innerHTML = '<div style="color:#f66">Failed to load comments</div>';
    return;
  }
  const comments = data.comments;
  container.innerHTML = '';
  if (!comments.length) {
    container.innerHTML = "<div style='color:#aaa'>No comments yet.</div>";
    return;
  }
  for (const c of comments) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'flex-start';
    const avatar = document.createElement('img');
    avatar.src = resolveAsset('/default-avatar.png');
    avatar.style.width = '28px';
    avatar.style.height = '28px';
    avatar.style.borderRadius = '6px';
    avatar.style.objectFit = 'cover';
    avatar.style.cursor = 'pointer';
    avatar.addEventListener('click', () => {
      window.location.href = `profile.html?user=${encodeURIComponent(c.username)}`;
    });
    const body = document.createElement('div');
    body.style.flex = '1';
    body.innerHTML = `<div style="font-weight:600">${c.username} <span style="color:#999;font-size:0.8rem;margin-left:8px">${formatFutureDate(c.createdAt)}</span></div>
                      <div style="color:#ddd; margin-top:4px">${c.text}</div>`;
    row.appendChild(avatar);
    row.appendChild(body);
    container.appendChild(row);
  }
}

createPostBtnFeed.addEventListener('click', async () => {
  const text = postTextFeed.value.trim();
  const f = postImageInputFeed.files[0];
  if (f) {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const { ok } = await fetchJson('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, text, image: dataUrl })
      });
      if (ok) { postTextFeed.value=''; postImageInputFeed.value=''; loadFeed(); }
    };
    reader.readAsDataURL(f);
  } else {
    const { ok } = await fetchJson('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser, text })
    });
    if (ok) { postTextFeed.value=''; loadFeed(); }
  }
});

if (logoutTopBtn) logoutTopBtn.addEventListener('click', ()=> { localStorage.removeItem('currentUser'); window.location.href='index.html'; });

const navProfile = document.getElementById('nav-profile');
if (navProfile) navProfile.addEventListener('click', ()=> window.location.href='profile.html');

const navContacts = document.getElementById('nav-contacts');
if (navContacts) navContacts.addEventListener('click', ()=> window.location.href='profile.html#contacts');

// ensure nav->messages works from feed page
const navMessages = document.getElementById('nav-messages');
if (navMessages) navMessages.addEventListener('click', () => {
  if (!localStorage.getItem('currentUser')) return window.location.href = 'index.html';
  window.location.href = 'messages.html';
});

loadFeed();

// ensure overlay references and allow closing full-screen preview
const overlay = document.getElementById('overlay');
const overlayImg = document.getElementById('overlayImg');
if (overlay) {
  overlay.addEventListener('click', () => overlay.classList.remove('visible'));
}
if (overlayImg) {
  overlayImg.addEventListener('click', () => overlay.classList.remove('visible'));
}
