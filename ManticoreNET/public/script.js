const username = document.getElementById("username");
const password = document.getElementById("password");
const status = document.getElementById("status");

function showStatus(msg, isError = true) {
  status.textContent = msg;
  status.style.color = isError ? "#f66" : "#8f8";
}

function getBasePath() {
  let p = location.pathname || "/";
  if (p === "/") return "/";
  if (!p.endsWith("/")) {
    if (p.includes(".")) p = p.replace(/\/[^\/]*$/, "/");
    else p = p + "/";
  }
  return p;
}

async function postJson(url, body) {
  try {
    const cleaned = String(url).replace(/^\/+/, "");
    const full = location.origin + getBasePath() + cleaned;
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
