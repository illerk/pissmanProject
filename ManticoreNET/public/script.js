const username = document.getElementById("username");
const password = document.getElementById("password");
const status = document.getElementById("status");

function showStatus(msg, isError = true) {
  status.textContent = msg;
  status.style.color = isError ? "#f66" : "#8f8";
}

// compute base (strip last path segment, e.g. "/ManticoreNET/profile.html" -> "/ManticoreNET")
const BASE = location.pathname.replace(/\/[^/]*$/, '');

async function postJson(url, body) {
  try {
    const res = await fetch(url.startsWith('/') ? (BASE + url) : (BASE + '/' + url.replace(/^\//, '')), {
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
  const { ok, data } = await postJson("/api/login", { username: username.value, password: password.value });
  if (ok && data.success) {
    // changed: save current user and go to profile
    localStorage.setItem("currentUser", username.value);
    window.location.href = (BASE || '/') + "/profile.html";
  } else {
    showStatus(data.error || "Login failed.");
  }
});

document.getElementById("registerBtn").addEventListener("click", async () => {
  if (!username.value || !password.value) {
    showStatus("Enter username and password.");
    return;
  }
  const { ok, data } = await postJson("/api/register", { username: username.value, password: password.value });
  if (ok && data.success) {
    showStatus("Account created! You can now log in.", false);
  } else {
    showStatus(data.error || "Registration failed.");
  }
});
