const username = document.getElementById("username");
const password = document.getElementById("password");
const status = document.getElementById("status");

const API_ROOT = "https://immersivethingsforsierra.ru/ManticoreNET/api";
const GUEST_ID = "__guest__"; 

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
  if (url.startsWith("/api/")) return API_ROOT + url.slice(4); 
  if (url.startsWith("api/")) return API_ROOT + url.slice(3);  
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
  const { ok, data } = await postJson("api/login", { username: username.value, password: password.value });
  if (ok && data.success) {
    localStorage.setItem("currentUser", username.value);
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

const guestBtn = document.getElementById("guestBtn");
if (guestBtn) {
  guestBtn.addEventListener("click", () => {
    localStorage.setItem("currentUser", GUEST_ID);
    window.location.href = new URL("feed.html", location.href).href;
  });
}
