const TOKEN_KEY = "nim-session-token";
const storageKey = "nim-chat-state-v3";
let editingUsername = null;
let editingAdminPassword = false;
let currentAdminUsername = "";

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function authHeaders() {
  return { "Content-Type": "application/json", "X-Session-Token": getToken() };
}

function showToast(message, type = "") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `admin-toast ${type} show`;
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => {
    el.className = "admin-toast";
  }, 3200);
}

function redirectToChat() {
  location.href = "/";
}

function readStoredState(username) {
  const keys = username ? [`${storageKey}:${username.toLowerCase()}`, storageKey] : [storageKey];
  for (const key of keys) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      if (parsed) return parsed;
    } catch {
      // Ignore malformed local state and fall back to defaults.
    }
  }
  return {};
}

function writeStoredState(username, state) {
  if (!username || !state) return;
  localStorage.setItem(`${storageKey}:${username.toLowerCase()}`, JSON.stringify(state));
}

function applyStoredTheme(username) {
  const stored = readStoredState(username);
  const theme = stored.theme || "system";
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.color = stored.settings?.color || "blue";
}

async function applySyncedTheme(username) {
  try {
    const response = await fetch("/api/state", { headers: { "X-Session-Token": getToken() } });
    if (response.ok) {
      const payload = await response.json();
      if (payload.state && typeof payload.state === "object") {
        writeStoredState(username, payload.state);
      }
    }
  } catch {
    // Local theme state is still available when sync cannot be reached.
  }
  applyStoredTheme(username);
}

async function jsonFrom(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function boot() {
  const res = await fetch("/api/auth/me", { headers: authHeaders() });
  if (!res.ok) {
    redirectToChat();
    return;
  }

  const { username, isAdmin } = await res.json();
  currentAdminUsername = username;
  await applySyncedTheme(username);
  if (!isAdmin) {
    redirectToChat();
    return;
  }

  document.getElementById("adminLabel").textContent = `Logged in as ${username} (admin)`;
  await loadUsers();
}

function renderEmpty(tbody, message) {
  tbody.replaceChildren();
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.className = "admin-empty";
  cell.textContent = message;
  row.append(cell);
  tbody.append(row);
}

function renderUserRow(user) {
  const row = document.createElement("tr");

  const nameCell = document.createElement("td");
  const name = document.createElement("strong");
  name.textContent = user.username;
  nameCell.append(name);

  const createdCell = document.createElement("td");
  createdCell.className = "admin-muted admin-date";
  createdCell.textContent = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-";

  const roleCell = document.createElement("td");
  const role = document.createElement("span");
  role.className = "admin-badge";
  role.textContent = "user";
  roleCell.append(role);

  const actionCell = document.createElement("td");
  actionCell.className = "admin-actions-cell";

  const passwordButton = document.createElement("button");
  passwordButton.className = "admin-btn admin-btn-ghost admin-btn-sm";
  passwordButton.type = "button";
  passwordButton.textContent = "Change Password";
  passwordButton.addEventListener("click", () => openPwModal(user.username));

  const deleteButton = document.createElement("button");
  deleteButton.className = "admin-btn admin-btn-danger admin-btn-sm";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => deleteUser(user.username));

  actionCell.append(passwordButton, deleteButton);
  row.append(nameCell, createdCell, roleCell, actionCell);
  return row;
}

async function loadUsers() {
  const res = await fetch("/api/admin/users", { headers: authHeaders() });
  if (!res.ok) {
    showToast("Failed to load users", "error");
    if (res.status === 401 || res.status === 403) redirectToChat();
    return;
  }

  const { users = [] } = await res.json();
  const tbody = document.getElementById("userTableBody");
  document.getElementById("userCount").textContent = `${users.length} user${users.length === 1 ? "" : "s"}`;

  if (!users.length) {
    renderEmpty(tbody, "No users yet. Add one above.");
    return;
  }

  tbody.replaceChildren(...users.map(renderUserRow));
}

async function addUser() {
  const usernameInput = document.getElementById("newUsername");
  const passwordInput = document.getElementById("newPassword");
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    showToast("Fill in username and password", "error");
    return;
  }

  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ username, password })
  });
  const data = await jsonFrom(res);
  if (!res.ok) {
    showToast(data.error || "Error", "error");
    return;
  }

  showToast(`User "${data.username || username}" created`, "success");
  usernameInput.value = "";
  passwordInput.value = "";
  await loadUsers();
}

async function deleteUser(username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;

  const res = await fetch("/api/admin/users", {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify({ username })
  });
  const data = await jsonFrom(res);
  if (!res.ok) {
    showToast(data.error || "Error", "error");
    return;
  }

  showToast(`User "${username}" deleted`, "success");
  await loadUsers();
}

function openPwModal(username, adminPassword = false) {
  editingUsername = username;
  editingAdminPassword = adminPassword;
  document.getElementById("pwModalUser").textContent = adminPassword ? `Admin: ${username}` : `User: ${username}`;
  document.getElementById("pwCurrentLabel").hidden = !adminPassword;
  document.getElementById("pwCurrentInput").value = "";
  document.getElementById("pwInput").value = "";
  document.getElementById("pwModal").classList.add("open");
  document.getElementById(adminPassword ? "pwCurrentInput" : "pwInput").focus();
}

function closePwModal() {
  document.getElementById("pwModal").classList.remove("open");
  editingAdminPassword = false;
}

async function savePassword() {
  const newPassword = document.getElementById("pwInput").value;
  if (!editingUsername || !newPassword) {
    showToast("Enter a new password", "error");
    return;
  }

  if (editingAdminPassword) {
    const currentPassword = document.getElementById("pwCurrentInput").value;
    if (!currentPassword) {
      showToast("Enter the current password", "error");
      return;
    }

    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await jsonFrom(res);
    if (!res.ok) {
      showToast(data.error || "Error", "error");
      return;
    }

    showToast("Password changed. Sign in again.", "success");
    closePwModal();
    await logout();
    return;
  }

  const res = await fetch("/api/admin/users", {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ username: editingUsername, newPassword })
  });
  const data = await jsonFrom(res);
  if (!res.ok) {
    showToast(data.error || "Error", "error");
    return;
  }

  showToast("Password changed", "success");
  closePwModal();
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() });
  localStorage.removeItem(TOKEN_KEY);
  redirectToChat();
}

document.getElementById("backBtn").addEventListener("click", redirectToChat);
document.getElementById("adminPasswordBtn").addEventListener("click", () => openPwModal(currentAdminUsername, true));
document.getElementById("addBtn").addEventListener("click", addUser);
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("pwCancelBtn").addEventListener("click", closePwModal);
document.getElementById("pwSaveBtn").addEventListener("click", savePassword);
document.getElementById("pwModal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closePwModal();
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  applyStoredTheme(currentAdminUsername);
});

window.addEventListener("storage", (event) => {
  if (event.key === storageKey || event.key === `${storageKey}:${currentAdminUsername.toLowerCase()}`) {
    applyStoredTheme(currentAdminUsername);
  }
});

applyStoredTheme();
boot();
