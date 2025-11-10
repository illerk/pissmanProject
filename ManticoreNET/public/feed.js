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

    // compute vote info
    const votesArr = post.votes || [];
    const voteSum = votesArr.reduce((s, v) => s + Number(v.vote || 0), 0);
    const myVote = (votesArr.find(v => v.username === currentUser) || {}).vote || 0;

    // actions: voting and comments
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '8px';
    actions.style.marginTop = '10px';

    // vote UI
    const up = document.createElement('button'); up.textContent = '▲';
    const cnt = document.createElement('div'); cnt.textContent = voteSum; cnt.style.minWidth = '36px'; cnt.style.textAlign = 'center';
    const down = document.createElement('button'); down.textContent = '▼';

    // highlight user's vote
    if (myVote === 1) up.style.background = 'rgba(0,200,0,0.12)';
    if (myVote === -1) down.style.background = 'rgba(200,0,0,0.12)';

    up.addEventListener('click', async () => {
      const targetVote = myVote === 1 ? null : 1; // toggle off if already upvoted
      const body = { username: currentUser, vote: 1 };
      const { ok, data } = await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser, vote: 1 })
      });
      if (ok && data && data.votes) {
        post.votes = data.votes;
        // re-render simple vote UI
        const newSum = post.votes.reduce((s,v)=>s+Number(v.vote||0),0);
        cnt.textContent = newSum;
        up.style.background = (post.votes.find(v=>v.username===currentUser)?.vote === 1) ? 'rgba(0,200,0,0.12)' : '';
        down.style.background = (post.votes.find(v=>v.username===currentUser)?.vote === -1) ? 'rgba(200,0,0,0.12)' : '';
      }
    });

    down.addEventListener('click', async () => {
      const { ok, data } = await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser, vote: -1 })
      });
      if (ok && data && data.votes) {
        post.votes = data.votes;
        const newSum = post.votes.reduce((s,v)=>s+Number(v.vote||0),0);
        cnt.textContent = newSum;
        up.style.background = (post.votes.find(v=>v.username===currentUser)?.vote === 1) ? 'rgba(0,200,0,0.12)' : '';
        down.style.background = (post.votes.find(v=>v.username===currentUser)?.vote === -1) ? 'rgba(200,0,0,0.12)' : '';
      }
    });

    actions.appendChild(up); actions.appendChild(cnt); actions.appendChild(down);

    // comments toggle
    const commentsBtn = document.createElement('button');
    const commentsContainer = document.createElement('div');
    commentsContainer.style.marginTop = '8px';
    commentsContainer.style.display = 'none';
    commentsContainer.style.flexDirection = 'column';
    commentsContainer.style.gap = '8px';

    commentsBtn.textContent = 'Comments';
    commentsBtn.addEventListener('click', async () => {
      if (commentsContainer.style.display === 'none') {
        // open: load comments
        const { ok, data } = await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/comments`);
        commentsContainer.innerHTML = '';
        if (!ok || !data.comments) {
          commentsContainer.innerHTML = '<div style="color:#f66">Failed to load comments</div>';
        } else {
          // render each comment
          for (const c of data.comments) {
            const ce = document.createElement('div');
            ce.style.border = '1px solid rgba(255,255,255,0.04)';
            ce.style.padding = '8px';
            ce.style.borderRadius = '6px';
            const meta = document.createElement('div'); meta.style.fontSize='0.85rem'; meta.style.color='#999';
            meta.textContent = `${c.username} · ${formatFutureDate(c.createdAt)}`;
            const txt = document.createElement('div'); txt.style.marginTop='6px'; txt.textContent = c.text;
            // comment votes
            const cVotes = c.votes || [];
            const cSum = cVotes.reduce((s,v)=>s+Number(v.vote||0),0);
            const myCVote = (cVotes.find(v => v.username === currentUser) || {}).vote || 0;
            const cvActions = document.createElement('div'); cvActions.style.display='flex'; cvActions.style.gap='6px'; cvActions.style.marginTop='6px';
            const cup = document.createElement('button'); cup.textContent='▲'; const ccnt = document.createElement('div'); ccnt.textContent = cSum; ccnt.style.minWidth='28px'; ccnt.style.textAlign='center';
            const cdown = document.createElement('button'); cdown.textContent='▼';
            if (myCVote === 1) cup.style.background = 'rgba(0,200,0,0.12)';
            if (myCVote === -1) cdown.style.background = 'rgba(200,0,0,0.12)';
            cup.addEventListener('click', async () => {
              const { ok } = await fetchJson(`/api/comments/${encodeURIComponent(c.id)}/vote`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser, vote: 1 })
              });
              if (ok) {
                // refresh comment section by re-clicking load
                commentsBtn.click();
                commentsBtn.click();
              }
            });
            cdown.addEventListener('click', async () => {
              const { ok } = await fetchJson(`/api/comments/${encodeURIComponent(c.id)}/vote`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser, vote: -1 })
              });
              if (ok) {
                commentsBtn.click(); commentsBtn.click();
              }
            });
            cvActions.appendChild(cup); cvActions.appendChild(ccnt); cvActions.appendChild(cdown);

            ce.appendChild(meta); ce.appendChild(txt); ce.appendChild(cvActions);
            commentsContainer.appendChild(ce);
          }
          // form to add a comment
          const form = document.createElement('div'); form.style.display='flex'; form.style.flexDirection='column'; form.style.gap='8px'; form.style.marginTop='8px';
          const ta = document.createElement('textarea'); ta.placeholder = 'Write a comment...'; ta.style.minHeight='60px';
          const send = document.createElement('button'); send.textContent = 'Comment';
          send.addEventListener('click', async () => {
            const text = ta.value.trim();
            if (!text) return;
            const { ok } = await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/comments`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser, text })
            });
            if (ok) {
              // reload comments
              commentsBtn.click(); commentsBtn.click();
            }
          });
          form.appendChild(ta); form.appendChild(send);
          commentsContainer.appendChild(form);
        }
        commentsContainer.style.display = '';
      } else {
        commentsContainer.style.display = 'none';
      }
    });

    actions.appendChild(commentsBtn);
    el.appendChild(actions);
    el.appendChild(commentsContainer);

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
