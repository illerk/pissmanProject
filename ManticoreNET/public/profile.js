// compute base
const BASE = location.pathname.replace(/\/[^/]*$/, '');

// add: explicit API root (always use this)
const API_ROOT = "https://immersivethingsforsierra.ru/ManticoreNET/api";
// add: assets root for avatars/posts (serve from /ManticoreNET/public)
const ASSET_ROOT = "https://immersivethingsforsierra.ru/ManticoreNET/public";

function resolveAsset(url) {
  if (!url) return url;
  if (/^(https?:|data:)/.test(url)) return url;
  if (url.startsWith("/")) return ASSET_ROOT + url;
  return url;
}

const currentUser = localStorage.getItem("currentUser");
if (!currentUser) {
  window.location.href = "index.html";
}
document.body.classList.add("logged-in");

const headerLabel = document.getElementById("headerLabel");
const headerSearch = document.getElementById("headerSearch");
const logoutTopBtn = document.getElementById("logoutTopBtn");

const profileCard = document.getElementById("profileCard");
const viewFields = document.getElementById("viewFields");
const editFields = document.getElementById("editFields");
const ageText = document.getElementById("ageText");
const genderText = document.getElementById("genderText");
const ageInput = document.getElementById("ageInput");
const genderSelect = document.getElementById("genderSelect");
const editBtn = document.getElementById("editBtn");
const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("fileInput");
const saveBtn = document.getElementById("saveBtn");

const newPostCard = document.getElementById("newPostCard");
const postText = document.getElementById("postText");
const postImageInput = document.getElementById("postImageInput");
const createPostBtn = document.getElementById("createPostBtn");

const postsListCard = document.getElementById("postsListCard");
const postsList = document.getElementById("postsList");

const contactsView = document.getElementById("contactsView");
const contactsList = document.getElementById("contactsList");
const navContacts = document.getElementById("nav-contacts");
const navProfile = document.getElementById("nav-profile");

const avatarEl = document.getElementById("avatar");
const overlay = document.getElementById("overlay");
const overlayImg = document.getElementById("overlayImg");
const status = document.getElementById("status");

let editMode = false;
let viewingUser = currentUser;
let currentProfile = {};
const userCache = {};

// small helpers
let statusTimer = null;
function showStatus(msg, isError = true, ttl = 4000) {
  status.textContent = msg;
  status.style.color = isError ? "#f66" : "#8f8";
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  if (ttl && ttl > 0) {
    statusTimer = setTimeout(() => {
      status.textContent = "";
      status.style.color = "";
      statusTimer = null;
    }, ttl);
  }
}

// unified fetch that resolves relative to current page (preserves sub-path)
async function fetchJson(url, opts) {
  try {
    // resolve to API_ROOT when requesting API paths
    let full;
    if (/^https?:\/\//.test(url)) full = url;
    else if (url.startsWith("/api/")) full = API_ROOT + url.slice(4);
    else if (url.startsWith("api/")) full = API_ROOT + url.slice(3);
    else full = new URL(url, location.href).href;
    const res = await fetch(full, opts);
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, data: { error: "Network error" } };
  }
}
function formatFutureDate(ts) {
  const d = new Date(Number(ts));
  d.setFullYear(d.getFullYear() + 313);
  return d.toLocaleString();
}
async function getUserProfile(username) {
  if (!username) return null;
  if (userCache[username]) return userCache[username];
  const r = await fetchJson(`/api/user/${encodeURIComponent(username)}`);
  if (r.ok && r.data.success) {
    // resolve avatar to full asset URL
    const prof = r.data.profile;
    if (prof && prof.avatar) prof.avatar = resolveAsset(prof.avatar);
    userCache[username] = prof;
    return prof;
  }
  return null;
}

function setEditMode(on) {
  editMode = !!on;
  editFields.style.display = editMode ? "" : "none";
  viewFields.style.display = editMode ? "none" : "";
  uploadBtn.style.display = editMode ? "" : "none";
  saveBtn.style.display = editMode ? "" : "none";
  editBtn.textContent = editMode ? "Cancel" : "Edit";
  if (editMode) {
    ageInput.value = currentProfile.age ?? "";
    genderSelect.value = currentProfile.gender ?? "";
    bioInput.value = currentProfile.bio ?? "";
  } else {
    ageText.textContent = currentProfile.age ?? "—";
    genderText.textContent = currentProfile.gender ?? "—";
    renderBio(currentProfile.bio);
    fileInput.value = "";
  }
}

// show contacts view — hide posts list and profile card
async function showContacts() {
  headerSearch.textContent = "Contacts";
  // keep headerLabel (profile name) unchanged
  profileCard.style.display = "none";
  contactsView.style.display = "";
  newPostCard.style.display = "none";
  postsListCard.style.display = "none";

  contactsList.innerHTML = "Loading...";
  const { ok, data } = await fetchJson("/api/users");
  if (!ok || !data.users) {
    contactsList.innerHTML = `<div style="color:#f66">Failed to load contacts</div>`;
    return;
  }
  contactsList.innerHTML = "";
  data.users.forEach(u => {
    const item = document.createElement("div");
    item.className = "contact-item";
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.gap = "12px";
    item.style.padding = "8px";
    item.style.border = "1px solid rgba(255,255,255,0.04)";
    item.style.borderRadius = "6px";

    const img = document.createElement("img");
    img.src = resolveAsset(u.avatar) || "default-avatar.png";
    img.style.width = "56px";
    img.style.height = "56px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "6px";
    img.style.cursor = "pointer";
    img.addEventListener("click", () => { overlayImg.src = img.src; overlay.classList.add("visible"); });

    const info = document.createElement("div"); info.style.flex = "1";
    const nameEl = document.createElement("div");
    nameEl.textContent = u.username; nameEl.style.fontWeight = "600"; nameEl.style.cursor = "pointer";
    nameEl.addEventListener("click", () => { loadProfile(u.username); });
    const meta = document.createElement("div"); meta.style.color = "#aaa"; meta.style.fontSize = "0.9rem";
    meta.textContent = `Age: ${u.age ?? '—'} · Gender: ${u.gender ?? '—'}`;

    info.appendChild(nameEl); info.appendChild(meta);

    const viewBtn = document.createElement("button"); viewBtn.textContent = "View";
    viewBtn.addEventListener("click", () => { loadProfile(u.username); });

    item.appendChild(img); item.appendChild(info); item.appendChild(viewBtn);
    contactsList.appendChild(item);
  });
}

// load posts for a user
async function loadPosts(username, options = { preserveScroll: true }) {
  // preserve scroll position if requested
  const container = postsList;
  const prevScroll = options.preserveScroll ? container.scrollTop : 0;
  postsList.innerHTML = "Loading posts...";

  try {
    // load all posts (feed) then filter to this user's posts
    const { ok, data } = await fetchJson(`${API_ROOT}/posts`);
    if (!ok || !data || !Array.isArray(data.posts)) {
      postsList.innerHTML = `<div style="color:#f66">Failed to load posts</div>`;
      return;
    }
    // filter posts that belong to the requested username
    const userPosts = data.posts.filter(p => String(p.username) === String(username))
                               .sort((a,b) => b.createdAt - a.createdAt);
    await renderPosts(userPosts);
  } catch (e) {
    postsList.innerHTML = `<div style="color:#f66">Failed to load posts</div>`;
    return;
  }

  // restore scroll
  if (options.preserveScroll) {
    // small timeout to ensure DOM layout applied
    setTimeout(() => { container.scrollTop = prevScroll; }, 0);
  }
}

// render posts sequentially to avoid race/double-appends
async function renderPosts(posts) {
  postsList.innerHTML = "";
  if (!posts.length) { postsList.innerHTML = "<div style='color:#aaa'>No posts yet.</div>"; return; }

  for (const post of posts) {
    const el = document.createElement("div");
    el.className = "post";
    el.style.border = "1px solid rgba(255,255,255,0.04)";
    el.style.padding = "12px";
    el.style.borderRadius = "8px";
    el.style.background = "linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.00))";

    const author = await getUserProfile(post.username);

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "8px";

    const authorImg = document.createElement("img");
    authorImg.src = (author && author.avatar) ? author.avatar : "default-avatar.png";
    authorImg.style.width = "36px";
    authorImg.style.height = "36px";
    authorImg.style.objectFit = "cover";
    authorImg.style.borderRadius = "6px";
    authorImg.style.cursor = "pointer";
    authorImg.addEventListener("click", () => { loadProfile(post.username); });

    const nameDiv = document.createElement("div");
    nameDiv.innerHTML = `<div style="font-weight:700">${post.username}</div>
                         <div style="color:#999;font-size:0.85rem">${formatFutureDate(post.createdAt)}</div>`;

    left.appendChild(authorImg); left.appendChild(nameDiv);
    header.appendChild(left);
    el.appendChild(header);

    if (post.text) {
      const txt = document.createElement("div"); txt.style.marginTop = "8px"; txt.textContent = post.text; el.appendChild(txt);
    }
    if (post.image) {
      const img = document.createElement("img");
      const resolved = resolveAsset(post.image);
      img.src = resolved ? (resolved + (resolved.includes("?") ? "&" : "?") + "t=" + Date.now()) : "";
      img.style.maxWidth = "100%";
      img.style.marginTop = "8px";
      img.style.borderRadius = "6px";
      img.style.cursor = "pointer";
      img.addEventListener("click", () => { overlayImg.src = img.src; overlay.classList.add("visible"); });
      el.appendChild(img);
    }

    // compute vote info
    const votesArr = post.votes || [];
    const voteSum = votesArr.reduce((s, v) => s + Number(v.vote || 0), 0);
    const myVote = (votesArr.find(v => v.username === currentUser) || {}).vote || 0;

    const actions = document.createElement("div");
    actions.style.display = "flex"; actions.style.alignItems = "center"; actions.style.gap = "8px"; actions.style.marginTop = "10px";

    const up = document.createElement("button"); up.textContent = "▲";
    const cnt = document.createElement("div"); cnt.textContent = voteSum; cnt.style.minWidth = "36px"; cnt.style.textAlign = "center";
    const down = document.createElement("button"); down.textContent = "▼";

    if (myVote === 1) up.style.background = 'rgba(0,200,0,0.12)';
    if (myVote === -1) down.style.background = 'rgba(200,0,0,0.12)';

    up.addEventListener('click', async () => {
      const { ok, data } = await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser, vote: 1 })
      });
      if (ok && data && data.votes) {
        post.votes = data.votes;
        cnt.textContent = post.votes.reduce((s,v)=>s+Number(v.vote||0),0);
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
        cnt.textContent = post.votes.reduce((s,v)=>s+Number(v.vote||0),0);
        up.style.background = (post.votes.find(v=>v.username===currentUser)?.vote === 1) ? 'rgba(0,200,0,0.12)' : '';
        down.style.background = (post.votes.find(v=>v.username===currentUser)?.vote === -1) ? 'rgba(200,0,0,0.12)' : '';
      }
    });

    actions.appendChild(up); actions.appendChild(cnt); actions.appendChild(down);

    // comments UI (toggle)
    const commentsBtn = document.createElement('button'); commentsBtn.textContent = 'Comments';
    const commentsContainer = document.createElement('div');
    commentsContainer.style.marginTop = '8px'; commentsContainer.style.display='none'; commentsContainer.style.flexDirection='column'; commentsContainer.style.gap='8px';

    commentsBtn.addEventListener('click', async () => {
      if (commentsContainer.style.display === 'none') {
        const { ok, data } = await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/comments`);
        commentsContainer.innerHTML = '';
        if (!ok || !data.comments) {
          commentsContainer.innerHTML = '<div style="color:#f66">Failed to load comments</div>';
        } else {
          for (const c of data.comments) {
            const ce = document.createElement('div');
            ce.style.border = '1px solid rgba(255,255,255,0.04)';
            ce.style.padding = '8px';
            ce.style.borderRadius = '6px';
            const meta = document.createElement('div'); meta.style.fontSize='0.85rem'; meta.style.color='#999';
            meta.textContent = `${c.username} · ${formatFutureDate(c.createdAt)}`;
            const txt = document.createElement('div'); txt.style.marginTop='6px'; txt.innerHTML = c.text;
            const cVotes = c.votes || []; const cSum = cVotes.reduce((s,v)=>s+Number(v.vote||0),0);
            const cActions = document.createElement('div'); cActions.style.display='flex'; cActions.style.gap='6px'; cActions.style.marginTop='6px';
            const cup = document.createElement('button'); cup.textContent='▲'; const ccnt = document.createElement('div'); ccnt.textContent = cSum; ccnt.style.minWidth='28px'; ccnt.style.textAlign='center';
            const cdown = document.createElement('button'); cdown.textContent='▼';
            if ((c.votes || []).find(v=>v.username===currentUser)?.vote === 1) cup.style.background='rgba(0,200,0,0.12)';
            if ((c.votes || []).find(v=>v.username===currentUser)?.vote === -1) cdown.style.background='rgba(200,0,0,0.12)';
            cup.addEventListener('click', async () => {
              const { ok } = await fetchJson(`/api/comments/${encodeURIComponent(c.id)}/vote`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser, vote: 1 })
              });
              if (ok) { commentsBtn.click(); commentsBtn.click(); }
            });
            cdown.addEventListener('click', async () => {
              const { ok } = await fetchJson(`/api/comments/${encodeURIComponent(c.id)}/vote`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser, vote: -1 })
              });
              if (ok) { commentsBtn.click(); commentsBtn.click(); }
            });
            cActions.appendChild(cup); cActions.appendChild(ccnt); cActions.appendChild(cdown);
            ce.appendChild(meta); ce.appendChild(txt); ce.appendChild(cActions);
            commentsContainer.appendChild(ce);
          }
          // add comment form
          const form = document.createElement('div'); form.style.display='flex'; form.style.flexDirection='column'; form.style.gap='8px'; form.style.marginTop='8px';
          const ta = document.createElement('textarea'); ta.placeholder='Write a comment...'; ta.style.minHeight='60px';
          const send = document.createElement('button'); send.textContent='Comment';
          send.addEventListener('click', async () => {
            const text = ta.value.trim();
            if (!text) return;
            const { ok } = await fetchJson(`/api/posts/${encodeURIComponent(post.id)}/comments`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser, text })
            });
            if (ok) { commentsBtn.click(); commentsBtn.click(); }
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

    postsList.appendChild(el);
  }
}

// load profile (single entry point)
async function loadProfile(username = currentUser) {
  viewingUser = username;
  const isOwn = viewingUser === currentUser;

  headerLabel.textContent = viewingUser;
  headerSearch.textContent = isOwn ? "Profile" : `${viewingUser}'s Profile`;

  // show profile card and posts list
  contactsView.style.display = "none";
  profileCard.style.display = "";
  postsListCard.style.display = "";
  newPostCard.style.display = isOwn ? "" : "none";

  // load profile data
  const { ok, data } = await fetchJson(`/api/user/${encodeURIComponent(viewingUser)}`);
  if (!ok || !data.success) {
    showStatus(data.error || "Failed to load profile");
    return;
  }
  currentProfile = data.profile;
  avatarEl.src = resolveAsset(currentProfile.avatar) || "default-avatar.png";
  ageText.textContent = currentProfile.age ?? "—";
  genderText.textContent = currentProfile.gender ?? "—";
  // ensure bio exists
  if (typeof currentProfile.bio === "undefined") currentProfile.bio = "";
  renderBio(currentProfile.bio);
  setEditMode(false);

  // load posts for this user
  await loadPosts(viewingUser);
}

// nav bindings
if (navContacts) navContacts.addEventListener("click", () => { showContacts(); });
if (navProfile) navProfile.addEventListener("click", () => { loadProfile(currentUser); });

// file upload for avatar (only active in edit mode)
fileInput.addEventListener("change", async () => {
  if (!editMode) return;
  const f = fileInput.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    showStatus("Uploading avatar...", false);
    const { ok } = await fetchJson("/api/avatar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser, image: dataUrl })
    });
    if (ok) {
      // refresh profile avatar
      const p = await getUserProfile(currentUser);
      userCache[currentUser] = null; // clear cache so next getUserProfile fetches updated avatar
      await loadProfile(viewingUser);
    } else {
      showStatus("Upload failed");
    }
  };
  reader.readAsDataURL(f);
});

// edit/save handlers (only for own profile)
editBtn.addEventListener("click", async () => {
  if (viewingUser !== currentUser) return;
  if (!editMode) setEditMode(true);
  else await loadProfile(viewingUser); // cancel -> reload profile
});
saveBtn.addEventListener("click", async () => {
  if (viewingUser !== currentUser) return;
  const age = ageInput.value;
  const gender = genderSelect.value;
  const bio = bioInput.value;
  const { ok } = await fetchJson("api/profile", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: currentUser, age, gender, bio })
  });
  if (ok) await loadProfile(viewingUser);
});

// create post (only for own profile)
createPostBtn.addEventListener("click", async () => {
  if (viewingUser !== currentUser) return;
  const text = postText.value.trim();
  const f = postImageInput.files[0];
  if (f) {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const { ok } = await fetchJson("/api/posts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: currentUser, text, image: dataUrl })
      });
      if (ok) { postText.value = ""; postImageInput.value = ""; await loadPosts(viewingUser); }
    };
    reader.readAsDataURL(f);
  } else {
    const { ok } = await fetchJson("/api/posts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser, text })
    });
    if (ok) { postText.value = ""; await loadPosts(viewingUser); }
  }
});

// logout top
if (logoutTopBtn) logoutTopBtn.addEventListener("click", () => {
  localStorage.removeItem("currentUser");
  document.body.classList.remove("logged-in");
  window.location.href = "index.html";
});

// init: respect ?user= and #contacts, run only once
(async function init() {
  const params = new URLSearchParams(location.search);
  const userParam = params.get('user');
  if (userParam) {
    await loadProfile(userParam);
    return;
  }
  if (location.hash === '#contacts') {
    await showContacts();
    return;
  }
  await loadProfile();
})();

// added: make Upload avatar button open file picker
uploadBtn.addEventListener("click", () => {
  fileInput.click();
});

// added: close overlay when clicking background or the image
overlay.addEventListener("click", () => {
  overlay.classList.remove("visible");
});
overlayImg.addEventListener("click", () => {
  overlay.classList.remove("visible");
});

const BIO_LIMIT = 200;
const bioTextEl = document.getElementById("bioText");
const bioToggleBtn = document.getElementById("bioToggle");
const bioInput = document.getElementById("bioInput");

function renderBio(bio) {
  bio = bio ?? "";
  if (!bio) {
    bioTextEl.textContent = "—";
    bioToggleBtn.style.display = "none";
    return;
  }
  if (bio.length > BIO_LIMIT) {
    const short = bio.slice(0, BIO_LIMIT).trim();
    bioTextEl.textContent = short + "…";
    bioToggleBtn.style.display = "";
    bioToggleBtn.textContent = "▼";
    bioToggleBtn.dataset.expanded = "0";
    bioToggleBtn.onclick = () => {
      const expanded = bioToggleBtn.dataset.expanded === "1";
      if (!expanded) {
        bioTextEl.textContent = bio;
        bioToggleBtn.textContent = "▲";
        bioToggleBtn.dataset.expanded = "1";
      } else {
        bioTextEl.textContent = bio.slice(0, BIO_LIMIT).trim() + "…";
        bioToggleBtn.textContent = "▼";
        bioToggleBtn.dataset.expanded = "0";
      }
    };
  } else {
    bioTextEl.textContent = bio;
    bioToggleBtn.style.display = "none";
  }
}

// open avatar in full-screen overlay when clicked
avatarEl.addEventListener("click", () => {
  if (!avatarEl.src) return;
  overlayImg.src = avatarEl.src;
  overlay.classList.add("visible");
});
