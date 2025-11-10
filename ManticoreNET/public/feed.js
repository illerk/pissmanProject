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

function voteCount(votes) { return (votes||[]).reduce((s,v)=>s + Number(v.vote), 0); }
function userVote(votes, username) { const v=(votes||[]).find(x=>x.username===username); return v?v.vote:0; }

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

const GUEST_USER = "GUEST";
const isGuest = currentUser === GUEST_USER;

// hide composer for guests
if (isGuest && document.getElementById('newPostCardFeed')) {
  document.getElementById('newPostCardFeed').style.display = 'none';
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

    const up = document.createElement('button'); up.textContent = '▲';
    const down = document.createElement('button'); down.textContent = '▼';
    const count = document.createElement('span'); count.textContent = voteCount(post.votes);
    // disable voting for guests
    if (isGuest) {
      up.disabled = true;
      down.disabled = true;
      up.title = "Guests cannot vote";
      down.title = "Guests cannot vote";
      up.style.opacity = "0.5";
      down.style.opacity = "0.5";
    }

    up.addEventListener('click', async () => {
      if (isGuest) { alert("Guests cannot vote"); return; }
      const container = feedPosts;
      const prev = container.scrollTop;
      const { ok, data } = await fetchJson(`/api/posts/${post.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, vote: 1 })
      });
      if (ok && data.success) {
        post.votes = data.votes;
        await loadFeed({ preserveScroll: true });
        container.scrollTop = prev;
      }
    });
    down.addEventListener('click', async () => {
      if (isGuest) { alert("Guests cannot vote"); return; }
      const container = feedPosts;
      const prev = container.scrollTop;
      const { ok, data } = await fetchJson(`/api/posts/${post.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, vote: -1 })
      });
      if (ok && data.success) {
        post.votes = data.votes;
        await loadFeed({ preserveScroll: true });
        container.scrollTop = prev;
      }
    });

    actions.appendChild(up);
    actions.appendChild(count);
    actions.appendChild(down);

    if (post.username === currentUser) {
      const delBtn = document.createElement('button'); delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        if (!confirm('Delete this post?')) return;
        const res = await fetch(`${API_ROOT}/posts/${post.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser })
        });
        if (res.ok) loadFeed();
      });
      actions.appendChild(delBtn);
    }

    const commentsToggle = document.createElement('button'); commentsToggle.textContent = `Comments (${(post.comments||[]).length})`;
    actions.appendChild(commentsToggle);
    el.appendChild(actions);

    const commentsArea = document.createElement('div'); commentsArea.style.display = 'none'; commentsArea.style.marginTop = '10px';
    const cl = document.createElement('div');

    for (const c of (post.comments||[])) {
      const ci = document.createElement('div');
      ci.style.borderTop = '1px solid rgba(255,255,255,0.03)';
      ci.style.padding = '8px 0';

      const cHeader = document.createElement('div'); cHeader.style.display='flex'; cHeader.style.alignItems='center'; cHeader.style.gap='8px';
      const cImg = document.createElement('img');
      const cAuthor = await getUserProfile(c.username);
      cImg.src = resolveAsset(cAuthor && cAuthor.avatar) || 'default-avatar.png';
      cImg.style.width='28px'; cImg.style.height='28px'; cImg.style.objectFit='cover'; cImg.style.borderRadius='6px'; cImg.style.cursor='pointer';
      cImg.addEventListener('click', ()=> window.location.href = `profile.html?user=${encodeURIComponent(c.username)}`);
      const cMeta = document.createElement('div');
      cMeta.innerHTML = `<div style="font-weight:600">${c.username} <span style="color:#999;font-weight:400;font-size:0.85rem">· ${formatFutureDate(c.createdAt)}</span></div>
                         <div style="margin-top:6px">${c.text}</div>`;
      cHeader.appendChild(cImg); cHeader.appendChild(cMeta);
      ci.appendChild(cHeader);

      const cv = document.createElement('div'); cv.style.display='flex'; cv.style.alignItems='center'; cv.style.gap='6px'; cv.style.marginTop='6px';
      const cup = document.createElement('button'); cup.textContent='▲';
      const cdown = document.createElement('button'); cdown.textContent='▼';
      const ccount = document.createElement('span'); ccount.textContent = voteCount(c.votes);
      cup.addEventListener('click', async ()=> {
        const { ok } = await fetchJson(`/api/comments/${c.id}/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser, vote: 1 })
        });
        if (ok) loadFeed();
      });
      cdown.addEventListener('click', async ()=> {
        const { ok } = await fetchJson(`/api/comments/${c.id}/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser, vote: -1 })
        });
        if (ok) loadFeed();
      });
      cv.appendChild(cup); cv.appendChild(ccount); cv.appendChild(cdown);
      ci.appendChild(cv);
      cl.appendChild(ci);
    }

    commentsArea.appendChild(cl);

    // add comment form
    const commentForm = document.createElement('div'); commentForm.style.marginTop='8px';
    const commentInput = document.createElement('input'); commentInput.placeholder='Write a comment...'; commentInput.style.width='70%';
    const commentBtn = document.createElement('button'); commentBtn.textContent='Comment';

    if (isGuest) {
      commentInput.disabled = true;
      commentBtn.disabled = true;
      commentBtn.title = "Guests cannot comment";
      commentInput.title = "Guests cannot comment";
      commentBtn.style.opacity = "0.5";
    }

    commentBtn.addEventListener('click', async ()=> {
      if (isGuest) { alert("Guests cannot comment"); return; }
      const txt = commentInput.value.trim();
      if (!txt) return;
      const { ok } = await fetchJson(`/api/posts/${post.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, text: txt })
      });
      if (ok) loadFeed();
    });
    commentForm.appendChild(commentInput); commentForm.appendChild(commentBtn);
    commentsArea.appendChild(commentForm);

    el.appendChild(commentsArea);
    commentsToggle.addEventListener('click', ()=> { commentsArea.style.display = commentsArea.style.display === 'none' ? '' : 'none'; });

    feedPosts.appendChild(el);
  }
}

// ensure create post handler blocks guests
createPostBtnFeed.addEventListener('click', async () => {
  if (currentUser === GUEST_USER) { alert("Guests cannot create posts"); return; }
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

const navMessages = document.getElementById('nav-messages');
if (navMessages) navMessages.addEventListener('click', () => {
  if (!localStorage.getItem('currentUser')) return window.location.href = 'index.html';
  window.location.href = 'messages.html';
});

loadFeed();

const overlay = document.getElementById('overlay');
const overlayImg = document.getElementById('overlayImg');
if (overlay) {
  overlay.addEventListener('click', () => overlay.classList.remove('visible'));
}
if (overlayImg) {
  overlayImg.addEventListener('click', () => overlay.classList.remove('visible'));
}
