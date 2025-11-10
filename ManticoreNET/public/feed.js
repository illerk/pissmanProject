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

    // actions: voting & comments
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '8px';
    actions.style.marginTop = '10px';

    // vote helpers
    const totalVotes = (post.votes || []).reduce((s,v)=>s + Number(v.vote||0), 0);
    const userVoteEntry = (post.votes || []).find(v => v.username === currentUser);
    const userVoteVal = userVoteEntry ? userVoteEntry.vote : 0;

    const upBtn = document.createElement('button');
    upBtn.textContent = `▲ ${totalVotes > 0 ? totalVotes : ''}`.trim();
    upBtn.style.fontWeight = userVoteVal === 1 ? '700' : '400';
    upBtn.addEventListener('click', async () => {
      await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, vote: 1 })
      });
      await loadFeed({ preserveScroll: true });
    });

    const downBtn = document.createElement('button');
    downBtn.textContent = `▼ ${totalVotes < 0 ? Math.abs(totalVotes) : ''}`.trim();
    downBtn.style.fontWeight = userVoteVal === -1 ? '700' : '400';
    downBtn.addEventListener('click', async () => {
      await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, vote: -1 })
      });
      await loadFeed({ preserveScroll: true });
    });

    // comments toggle
    const commentsBtn = document.createElement('button');
    const commentsCount = (post.comments || []).length;
    commentsBtn.textContent = `Comments (${commentsCount})`;
    const commentsArea = document.createElement('div');
    commentsArea.style.display = 'none';
    commentsArea.style.marginTop = '8px';
    commentsArea.style.borderTop = '1px solid rgba(255,255,255,0.02)';
    commentsBtn.addEventListener('click', () => {
      commentsArea.style.display = commentsArea.style.display === 'none' ? '' : 'none';
      if (commentsArea.style.display !== 'none') {
        // render comments
        commentsArea.innerHTML = '';
        const list = document.createElement('div');
        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '8px';
        for (const c of (post.comments || [])) {
          const ce = document.createElement('div');
          ce.style.border = '1px solid rgba(255,255,255,0.03)';
          ce.style.padding = '8px';
          ce.style.borderRadius = '6px';
          const meta = document.createElement('div');
          meta.style.fontSize = '0.85rem';
          meta.style.color = '#999';
          meta.textContent = `${c.username} · ${formatFutureDate(c.createdAt)}`;
          const txt = document.createElement('div'); txt.textContent = c.text; txt.style.marginTop='6px';
          // comment vote buttons
          const cVotes = (c.votes || []).reduce((s,v)=>s + Number(v.vote||0), 0);
          const cUserVote = (c.votes || []).find(v=>v.username===currentUser)?.vote || 0;
          const cup = document.createElement('button'); cup.textContent = `▲ ${cVotes>0?cVotes:""}`.trim(); cup.style.fontWeight = cUserVote===1 ? '700' : '400';
          const cdown = document.createElement('button'); cdown.textContent = `▼ ${cVotes<0?Math.abs(cVotes):""}`.trim(); cdown.style.fontWeight = cUserVote===-1 ? '700' : '400';
          cup.addEventListener('click', async () => {
            await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(c.id)}/vote`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: currentUser, vote: 1 })
            });
            await loadFeed({ preserveScroll: true });
          });
          cdown.addEventListener('click', async () => {
            await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(c.id)}/vote`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: currentUser, vote: -1 })
            });
            await loadFeed({ preserveScroll: true });
          });

          const cvs = document.createElement('div'); cvs.style.marginTop='6px'; cvs.style.display='flex'; cvs.style.gap='6px';
          cvs.appendChild(cup); cvs.appendChild(cdown);

          ce.appendChild(meta); ce.appendChild(txt); ce.appendChild(cvs);
          list.appendChild(ce);
        }

        // add new comment box
        const addBox = document.createElement('div');
        addBox.style.display = 'flex'; addBox.style.flexDirection = 'column'; addBox.style.gap = '6px'; addBox.style.marginTop = '8px';
        const ta = document.createElement('textarea'); ta.placeholder = 'Write a comment...'; ta.style.width='100%'; ta.style.minHeight='48px';
        const send = document.createElement('button'); send.textContent = 'Comment';
        send.addEventListener('click', async () => {
          const text = (ta.value || '').trim();
          if (!text) return;
          await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/comments`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser, text })
          });
          await loadFeed({ preserveScroll: true });
        });
        addBox.appendChild(ta); addBox.appendChild(send);

        commentsArea.appendChild(list);
        commentsArea.appendChild(addBox);
      }
    });

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(commentsBtn);
    el.appendChild(actions);
    el.appendChild(commentsArea);

    feedPosts.appendChild(el);
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
