const username = document.getElementById("username");
const password = document.getElementById("password");
const status = document.getElementById("status");

function showStatus(msg, isError = true) {
  status.textContent = msg;
  status.style.color = isError ? "#f66" : "#8f8";
}

// add absolute API base and helper
const API_BASE = "https://immersivethingsforsierra.ru/ManticoreNET/api";
function apiUrl(path) {
  if (!path) return API_BASE;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  // avoid leading-slash resetting host when using URL(), just join
  return API_BASE + (path.startsWith("/") ? path : "/" + path);
}

async function postJson(url, body) {
  try {
    // build URL using fixed API base so sub-paths are always correct
    const full = apiUrl(url);
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
