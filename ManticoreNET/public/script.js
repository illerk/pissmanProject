const username = document.getElementById("username");
const password = document.getElementById("password");
const status = document.getElementById("status");

// compute API root based on current location and optional app base (e.g. /ManticoreNET)
const _origin = location.origin;
const _parts = location.pathname.split('/').filter(Boolean);
const _appBase = (_parts.length && !_parts[0].includes('.')) ? '/' + _parts[0] : '';
const API_ROOT = _origin + _appBase + '/api';

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

function buildApiUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith("/api/")) return API_ROOT + url.slice(4); // "/api/foo" -> API_ROOT + "/foo"
  if (url.startsWith("api/")) return API_ROOT + url.slice(3);  // "api/foo" -> API_ROOT + "/foo"
  return url;
}

async function postJson(url, body) {
  try {
    const full = buildApiUrl(url);
    const res = await fetch(full, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, data: { error: "Network error" } };
  }
}

document.getElementById("loginBtn").addEventListener("click", async () => {
  if (!username.value || !password.value) {
    showStatus("Enter username and password.");
    return;
  }
  // NOTE: relative API path (no leading slash)
  const { ok, data } = await postJson("api/login", { username: username.value, password: password.value });
  if (ok && data.success) {
    localStorage.setItem("currentUser", username.value);
    // navigate to profile page in same base path
    window.location.href = new URL("profile.html", location.href).href;
  } else {
    showStatus(data.error || "Login failed.");
  }
});

document.getElementById("registerBtn").addEventListener("click", async () => {
  if (!username.value || !password.value) {
    showStatus("Enter username and password.");
    return;
  }
  const { ok, data } = await postJson("api/register", { username: username.value, password: password.value });
  if (ok && data.success) {
    showStatus("Account created! You can now log in.", false);
  } else {
    showStatus(data.error || "Registration failed.");
  }
});
