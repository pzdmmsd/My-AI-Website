const messagesEl = document.querySelector("#messages");
const template = document.querySelector("#messageTemplate");
const form = document.querySelector("#chatForm");
const promptInput = document.querySelector("#promptInput");
const modelSelect = document.querySelector("#modelSelect");
const systemInput = document.querySelector("#systemInput");
const temperatureInput = document.querySelector("#temperatureInput");
const temperatureValue = document.querySelector("#temperatureValue");
const maxTokensInput = document.querySelector("#maxTokensInput");
const sendButton = document.querySelector("#sendButton");
const stopButton = document.querySelector("#stopButton");
const exportButton = document.querySelector("#exportButton");
const themeButton = document.querySelector("#themeButton");
const newChatButton = document.querySelector("#newChatButton");
const conversationList = document.querySelector("#conversationList");
const chatTitle = document.querySelector("#chatTitle");
const activeModelLabel = document.querySelector("#activeModelLabel");
const attachButton = document.querySelector("#attachButton");
const webModeButton = document.querySelector("#webModeButton");
const fileInput = document.querySelector("#fileInput");
const attachmentRow = document.querySelector("#attachmentRow");
const settingsPanel = document.querySelector("#settingsPanel");
const appShell = document.querySelector("#appShell");
const sidebarToggle = document.querySelector("#sidebarToggle");
const sidebarBackdrop = document.querySelector("#sidebarBackdrop");

const storageKey = "nim-chat-state-v3";
const TOKEN_KEY = "nim-session-token";
const maxFileBytes = 180 * 1024;
const defaultSystemPrompt = "You are a precise, direct, helpful AI assistant.";
const fallbackModels = ["google/gemma-4-31b-it"];

function getSessionToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
function authHeaders() {
  return { "Content-Type": "application/json", "X-Session-Token": getSessionToken() };
}

let state = createInitialState();
const controllers = new Map();
let pendingFiles = [];
let editingState = null;
let currentSession = null;
let isHydratingState = false;
let remoteSaveTimer = null;
let sidebarPinnedOpen = !window.matchMedia("(max-width: 860px)").matches;

function createInitialState() {
  const id = crypto.randomUUID();
  return {
    activeId: id,
    theme: "system",
    settings: {
      model: "",
      system: defaultSystemPrompt,
      temperature: "0.3",
      maxTokens: ""
    },
    conversations: [
      {
        id,
        title: "New chat",
        titleGenerated: false,
        model: "",
        webMode: false,
        updatedAt: Date.now(),
        messages: []
      }
    ]
  };
}

function getActiveConversation() {
  let conversation = state.conversations.find((item) => item.id === state.activeId);
  if (!conversation) {
    conversation = createConversation();
    state.conversations.unshift(conversation);
    state.activeId = conversation.id;
  }
  return conversation;
}

function createConversation() {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    titleGenerated: false,
    model: state.settings.model || modelSelect.value || "",
    webMode: false,
    updatedAt: Date.now(),
    messages: []
  };
}

function migrateState(parsed) {
  const fresh = createInitialState();
  const merged = {
    ...fresh,
    ...parsed,
    settings: { ...fresh.settings, ...(parsed.settings || {}) }
  };

  if (merged.settings.system.includes("Answer in Chinese unless the user asks otherwise.")) {
    merged.settings.system = defaultSystemPrompt;
  }
  if (merged.settings.maxTokens === "2048") {
    merged.settings.maxTokens = "";
  }

  merged.conversations = Array.isArray(merged.conversations) && merged.conversations.length
    ? merged.conversations
    : fresh.conversations;

  for (const conversation of merged.conversations) {
    conversation.id ||= crypto.randomUUID();
    conversation.title ||= "New chat";
    conversation.titleGenerated = Boolean(conversation.titleGenerated);
    conversation.model ||= "";
    conversation.updatedAt = Number(conversation.updatedAt) || Date.now();
    conversation.webMode = Boolean(conversation.webMode ?? merged.settings.webMode);
    conversation.messages = (conversation.messages || []).map((message) => ({
      ...message,
      id: message.id || crypto.randomUUID(),
      displayContent: message.displayContent || message.content || "",
      files: message.files || []
    }));
  }

  return merged;
}

function scopedStorageKey(username = currentSession?.username) {
  return username ? `${storageKey}:${username.toLowerCase()}` : storageKey;
}

function readStoredState(username = currentSession?.username) {
  try {
    return JSON.parse(localStorage.getItem(scopedStorageKey(username)) || "null");
  } catch {
    return null;
  }
}

function writeStoredState(username = currentSession?.username) {
  localStorage.setItem(scopedStorageKey(username), JSON.stringify(state));
}

function loadState(username = currentSession?.username) {
  const parsed = readStoredState(username) || readStoredState(null);
  state = parsed?.conversations?.length ? migrateState(parsed) : createInitialState();
  applyStateToControls();
}

function applyStateToControls() {
  systemInput.value = state.settings.system || defaultSystemPrompt;
  temperatureInput.value = state.settings.temperature;
  maxTokensInput.value = state.settings.maxTokens;
  temperatureValue.textContent = state.settings.temperature;
  applyTheme(state.theme);
}

async function loadRemoteState() {
  const response = await fetch("/api/state", { headers: { "X-Session-Token": getSessionToken() } });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.state?.conversations?.length ? migrateState(payload.state) : null;
}

async function saveRemoteStateNow() {
  if (!currentSession || isHydratingState) return;
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = null;

  try {
    await fetch("/api/state", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ state })
    });
  } catch {
    // Local state remains available; the next successful save will resync.
  }
}

function queueRemoteSave() {
  if (!currentSession || isHydratingState) return;
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(saveRemoteStateNow, 700);
}

async function hydrateSyncedState(session) {
  currentSession = session;
  isHydratingState = true;
  loadState(session.username);

  const localHadState = Boolean(readStoredState(session.username)?.conversations?.length || readStoredState(null)?.conversations?.length);
  const remoteState = await loadRemoteState();
  if (remoteState) {
    state = remoteState;
    writeStoredState(session.username);
    applyStateToControls();
  }

  isHydratingState = false;
  if (!remoteState && localHadState) {
    saveState();
    await saveRemoteStateNow();
  }
}

function saveState() {
  state.settings = {
    model: modelSelect.value,
    system: systemInput.value,
    temperature: temperatureInput.value,
    maxTokens: maxTokensInput.value.trim()
  };
  writeStoredState();
  queueRemoteSave();
}

function applyTheme(theme) {
  state.theme = theme;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  themeButton.querySelector("span").textContent = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System";
  themeButton.querySelector("svg").innerHTML =
    theme === "dark"
      ? '<path d="M12 3a7.5 7.5 0 1 0 7.5 7.5A6 6 0 0 1 12 3Z" />'
      : theme === "light"
        ? '<path d="M12 4v2m0 12v2M4 12H2m20 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4m0-12.8 1.4-1.4M4.2 19.8l1.4-1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />'
        : '<path d="M4 5h16v11H4zM8 20h8M10 16v4m4-4v4" />';
}

function cycleTheme() {
  const next = state.theme === "system" ? "dark" : state.theme === "dark" ? "light" : "system";
  applyTheme(next);
  saveState();
}

function syncSettingsDisclosure() {
  if (!settingsPanel) return;
  settingsPanel.open = !window.matchMedia("(max-width: 860px)").matches;
}

function setSidebarDrawer(open) {
  sidebarPinnedOpen = open;
  appShell.classList.toggle("is-sidebar-open", open);
  sidebarToggle?.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeSidebarDrawer() {
  setSidebarDrawer(false);
}

function toggleSidebarDrawer() {
  setSidebarDrawer(!appShell.classList.contains("is-sidebar-open"));
}

function syncRunState() {
  const activeIsBusy = controllers.has(state.activeId);
  sendButton.disabled = activeIsBusy;
  stopButton.disabled = !activeIsBusy;
  stopButton.classList.toggle("is-danger", activeIsBusy);
}

function setWebMode(enabled) {
  getActiveConversation().webMode = enabled;
  webModeButton.setAttribute("aria-pressed", enabled ? "true" : "false");
  webModeButton.classList.toggle("is-active", enabled);
}

function modelName(model) {
  return model || "Default model";
}

function titleFrom(content) {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 42 ? `${compact.slice(0, 42)}...` : compact || "New chat";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileKind(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "PDF";
  if (name.endsWith(".doc") || name.endsWith(".docx")) return "DOC";
  if (name.endsWith(".xls") || name.endsWith(".xlsx") || name.endsWith(".csv")) return "XLS";
  if (name.endsWith(".ppt") || name.endsWith(".pptx")) return "PPT";
  if (name.endsWith(".md")) return "MD";
  if (name.endsWith(".json")) return "JSON";
  if (name.endsWith(".js") || name.endsWith(".ts") || name.endsWith(".py") || name.endsWith(".html") || name.endsWith(".css")) return "CODE";
  if (file.type.startsWith("image/")) return "IMG";
  if (file.type.startsWith("text/")) return "TXT";
  return "FILE";
}

function isTextReadable(file) {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    [".txt", ".md", ".json", ".csv", ".tsv", ".js", ".ts", ".tsx", ".jsx", ".py", ".html", ".css", ".xml", ".yaml", ".yml", ".log"].some((ext) =>
      name.endsWith(ext)
    )
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeCode(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInlineMarkdown(value, sources = []) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(?:\u3010|\[)(\d+)(?:\u3011|\])/g, (match, index) => renderCitation(match, index, sources));
}

function renderCitation(label, index, sources) {
  const source = sources.find((item) => String(item.index) === String(index));
  const text = `[${index}]`;
  if (!source?.url) {
    return `<sup class="citation">${text}</sup>`;
  }
  return `<sup class="citation"><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer" title="${escapeHtml(source.title || "")}">${text}</a></sup>`;
}

function highlightCode(code, language) {
  const escaped = escapeCode(code);
  const lang = (language || "").toLowerCase();
  const keywordSets = {
    js: "\\b(const|let|var|function|return|if|else|for|while|class|new|async|await|import|from|export|try|catch|throw|switch|case|break|continue|true|false|null|undefined)\\b",
    javascript: "\\b(const|let|var|function|return|if|else|for|while|class|new|async|await|import|from|export|try|catch|throw|switch|case|break|continue|true|false|null|undefined)\\b",
    ts: "\\b(const|let|var|function|return|if|else|for|while|class|new|async|await|import|from|export|type|interface|implements|extends|private|public|readonly|true|false|null|undefined)\\b",
    python: "\\b(def|return|if|elif|else|for|while|class|import|from|as|try|except|raise|with|lambda|True|False|None|async|await)\\b",
    py: "\\b(def|return|if|elif|else|for|while|class|import|from|as|try|except|raise|with|lambda|True|False|None|async|await)\\b",
    css: "\\b(display|grid|flex|block|none|position|absolute|relative|color|background|border|padding|margin|width|height|font|transform|transition)\\b",
    html: "(&lt;/?[a-zA-Z][^&]*?&gt;)",
    json: "\\b(true|false|null)\\b",
    bash: "\\b(cd|ls|pwd|mkdir|rm|cp|mv|grep|cat|echo|export|npm|node|git|curl)\\b",
    shell: "\\b(cd|ls|pwd|mkdir|rm|cp|mv|grep|cat|echo|export|npm|node|git|curl)\\b"
  };

  let highlighted = escaped
    .replace(/(".*?"|'.*?'|`.*?`)/g, '<span class="code-string">$1</span>')
    .replace(/(\/\/.*|#.*)$/gm, '<span class="code-comment">$1</span>');

  const keywords = keywordSets[lang] || keywordSets.js;
  highlighted = highlighted.replace(new RegExp(keywords, "g"), '<span class="code-keyword">$1</span>');
  highlighted = highlighted.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="code-number">$1</span>');
  return highlighted;
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(lines, sources) {
  const headers = splitTableRow(lines[0]);
  const bodyRows = lines.slice(2).map(splitTableRow);
  return `<div class="table-wrap"><table><thead><tr>${headers
    .map((cell) => `<th>${renderInlineMarkdown(cell, sources)}</th>`)
    .join("")}</tr></thead><tbody>${bodyRows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell, sources)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

function renderMarkdown(markdown, sources = []) {
  const fences = [];
  const withoutFences = markdown.replace(/```([\w-]+)?\n([\s\S]*?)```/g, (_, language = "text", code) => {
    const token = `@@CODE${fences.length}@@`;
    const label = language || "text";
    fences.push(
      `<div class="code-block"><div class="code-header"><span>${escapeHtml(label)}</span></div><pre><code>${highlightCode(code.trim(), label)}</code></pre></div>`
    );
    return token;
  });

  const blocks = [];
  const paragraph = [];
  let listType = null;
  let listItems = [];
  const lines = withoutFences.split(/\r?\n/);
  let lineIndex = 0;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.map((line) => renderInlineMarkdown(line, sources)).join("<br>")}</p>`);
    paragraph.length = 0;
  }

  function flushList() {
    if (!listType) return;
    blocks.push(`<${listType}>${listItems.map((item) => `<li>${renderInlineMarkdown(item, sources)}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  }

  while (lineIndex < lines.length) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      lineIndex += 1;
      continue;
    }

    const fenceIndex = trimmed.match(/^@@CODE(\d+)@@$/);
    if (fenceIndex) {
      flushParagraph();
      flushList();
      blocks.push(fences[Number(fenceIndex[1])]);
      lineIndex += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length, 6);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2], sources)}</h${level}>`);
      lineIndex += 1;
      continue;
    }

    if (trimmed.includes("|") && lines[lineIndex + 1] && isTableDivider(lines[lineIndex + 1])) {
      flushParagraph();
      flushList();
      const tableLines = [line, lines[lineIndex + 1]];
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex].trim().includes("|")) {
        tableLines.push(lines[lineIndex]);
        lineIndex += 1;
      }
      blocks.push(renderTable(tableLines, sources));
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered && !trimmed.match(/^[-*]{3,}\s*$/)) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(unordered[1]);
      lineIndex += 1;
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ordered[1]);
      lineIndex += 1;
      continue;
    }

    // Horizontal rule (---, ***, ___)
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push("<hr>");
      lineIndex += 1;
      continue;
    }

    flushList();
    paragraph.push(trimmed);
    lineIndex += 1;
  }

  flushParagraph();
  flushList();
  return blocks.join("");
}

function renderModelOptions(models, selected) {
  const unique = [...new Set(models.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  modelSelect.replaceChildren();
  for (const model of unique) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelect.append(option);
  }
  modelSelect.value = unique.includes(selected) ? selected : unique[0] || "";
}

async function loadModels() {
  renderModelOptions([state.settings.model, ...fallbackModels], state.settings.model);

  try {
    const response = await fetch("/api/models", {
      headers: { "X-Session-Token": getSessionToken() }
    });
    if (!response.ok) return;

    const payload = await response.json();
    const selected = state.settings.model || payload.default_model || "";
    const models = payload.models?.length ? payload.models : fallbackModels;
    renderModelOptions(models, selected);
    state.settings.model = modelSelect.value;
    getActiveConversation().model ||= modelSelect.value;
    saveState();
    renderAll();
  } catch {
    renderModelOptions([state.settings.model, ...fallbackModels], state.settings.model);
  }
}

function scrollMessagesToEnd(behavior = "smooth") {
  messagesEl.scrollTo({
    top: messagesEl.scrollHeight,
    behavior
  });
}

function renderFileCards(container, files, removable = false) {
  const row = document.createElement("div");
  row.className = "file-card-row";
  for (const file of files) {
    const card = document.createElement("div");
    card.className = "file-card";
    card.innerHTML = `
      <span class="file-icon">${escapeHtml(file.kind || fileKind(file))}</span>
      <span class="file-info">
        <span class="file-name">${escapeHtml(file.name)}</span>
        <span class="file-size">${escapeHtml(formatBytes(file.size))}</span>
      </span>
    `;
    if (removable) {
      const removeButton = document.createElement("button");
      removeButton.className = "file-remove";
      removeButton.type = "button";
      removeButton.textContent = "x";
      removeButton.title = "Remove file";
      removeButton.addEventListener("click", () => {
        pendingFiles = pendingFiles.filter((item) => item.id !== file.id);
        renderAttachments();
      });
      card.append(removeButton);
    }
    row.append(card);
  }
  container.append(row);
}

function renderSources(container, sources) {
  if (!sources?.length) return;

  const sourceList = document.createElement("div");
  sourceList.className = "source-list";
  for (const source of sources) {
    const link = document.createElement("a");
    link.className = "source-chip";
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `[${source.index}] ${source.title}`;
    sourceList.append(link);
  }
  container.append(sourceList);
}

function addMessage(message) {
  const node = template.content.firstElementChild.cloneNode(true);
  if (message.id) {
    node.dataset.messageId = message.id;
  }
  node.classList.add(message.role);
  const meta = node.querySelector(".message-meta");
  const metaLabel = document.createElement("span");
  metaLabel.textContent = message.role === "user" ? "You" : message.role === "assistant" ? modelName(message.model) : "Error";
  meta.append(metaLabel);
  if (message.role === "user") {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "message-edit";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => startEditMessage(message.id));
    meta.append(editButton);
  }

  const body = node.querySelector(".message-body");
  if (message.role === "assistant") {
    if (!message.content) {
      // 显示 thinking 动画，等待首个 token
      body.innerHTML = `
        <div class="thinking-indicator">
          <div class="thinking-dots"><span></span><span></span><span></span></div>
          <span class="thinking-label">Thinking…</span>
        </div>`;
    } else {
      body.innerHTML = renderMarkdown(message.content, message.sources || []);
      renderSources(body, message.sources || []);
    }
  } else {
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.displayContent || message.content || "";
    body.append(text);
    if (message.files?.length) {
      renderFileCards(body, message.files, false);
    }
  }

  messagesEl.append(node);
  scrollMessagesToEnd();
  return {
    meta: node.querySelector(".message-meta"),
    body,
    node
  };
}

function renderMessages() {
  messagesEl.replaceChildren();
  const conversation = getActiveConversation();
  if (!conversation.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Start a new conversation.";
    messagesEl.append(empty);
    return;
  }
  for (const message of conversation.messages) {
    addMessage(message);
  }
}

function renderConversationList() {
  conversationList.replaceChildren();
  const sorted = [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const conversation of sorted) {
    const row = document.createElement("div");
    row.className = "conversation-row";
    row.classList.toggle("is-active", conversation.id === state.activeId);
    row.classList.toggle("is-running", controllers.has(conversation.id));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";
    // 用 span 包裹标题文字，使 text-overflow ellipsis 生效
    const titleSpan = document.createElement("span");
    titleSpan.className = "conversation-title-text";
    titleSpan.textContent = conversation.title || "New chat";
    button.appendChild(titleSpan);
    button.addEventListener("click", () => {
      state.activeId = conversation.id;
      editingState = null;
      setEditingLabel(false);
      pendingFiles = [];
      modelSelect.value = conversation.model || state.settings.model || modelSelect.value;
      saveState();
      renderAll();
      closeSidebarDrawer();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "conversation-delete";
    deleteButton.title = "Delete chat";
    deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14" /></svg>';
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteConversation(conversation.id);
    });

    row.append(button, deleteButton);
    conversationList.append(row);
  }
}

function deleteConversation(id) {
  controllers.get(id)?.abort();
  controllers.delete(id);
  if (editingState?.conversationId === id) {
    editingState = null;
    setEditingLabel(false);
    pendingFiles = [];
  }
  state.conversations = state.conversations.filter((conversation) => conversation.id !== id);
  if (!state.conversations.length) {
    state.conversations.push(createConversation());
  }
  if (state.activeId === id) {
    state.activeId = state.conversations[0].id;
  }
  saveState();
  renderAll();
}

function renderHeader() {
  const conversation = getActiveConversation();
  chatTitle.textContent = conversation.title || "New chat";
  activeModelLabel.textContent = modelName(conversation.model || modelSelect.value);
  setWebMode(Boolean(conversation.webMode));
  syncRunState();
}

function renderAttachments() {
  attachmentRow.replaceChildren();
  attachmentRow.hidden = !pendingFiles.length;
  if (pendingFiles.length) {
    renderFileCards(attachmentRow, pendingFiles, true);
  }
}

function renderAll() {
  renderConversationList();
  renderHeader();
  renderMessages();
  renderAttachments();
}

function extractUploadedFileContext(content) {
  const marker = "Uploaded files:\n\n";
  const index = content.indexOf(marker);
  return index === -1 ? "" : content.slice(index + marker.length);
}

function setEditingLabel(isEditing) {
  // no-op: editing is now inline in the message bubble
}

function startEditMessage(messageId) {
  const conversation = getActiveConversation();
  const index = conversation.messages.findIndex((message) => message.id === messageId && message.role === "user");
  if (index === -1 || controllers.has(conversation.id)) return;

  // Cancel any existing inline edit first
  document.querySelectorAll(".message.is-editing").forEach((el) => cancelInlineEdit(el));

  const message = conversation.messages[index];
  const node = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!node) return;

  node.classList.add("is-editing");

  const body = node.querySelector(".message-body");
  const originalText = message.displayContent || message.content || "";

  // Replace body content with textarea
  body.innerHTML = "";
  const textarea = document.createElement("textarea");
  textarea.className = "inline-edit";
  textarea.value = originalText;
  textarea.rows = Math.max(3, originalText.split("\n").length);
  body.appendChild(textarea);

  // Add action buttons
  const actions = document.createElement("div");
  actions.className = "inline-edit-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    cancelInlineEdit(node);
    // Re-render just this message
    const msgData = getActiveConversation().messages.find((m) => m.id === messageId);
    if (msgData) {
      body.innerHTML = "";
      const text = document.createElement("div");
      text.className = "message-text";
      text.textContent = msgData.displayContent || msgData.content || "";
      body.appendChild(text);
      if (msgData.files?.length) renderFileCards(body, msgData.files, false);
    }
  });

  const updateBtn = document.createElement("button");
  updateBtn.type = "button";
  updateBtn.className = "btn-update";
  updateBtn.textContent = "Update";
  updateBtn.addEventListener("click", async () => {
    const newText = textarea.value.trim();
    if (!newText) return;

    cancelInlineEdit(node);

    const retainedFileContext = extractUploadedFileContext(message.content || "");
    const retainedFiles = message.files || [];
    const content = await buildUserPromptContent(newText, [], retainedFileContext);

    conversation.messages.splice(index, conversation.messages.length - index, {
      id: messageId,
      role: "user",
      content,
      displayContent: newText,
      files: retainedFiles
    });
    conversation.title = "New chat";
    conversation.titleGenerated = false;
    conversation.updatedAt = Date.now();
    editingState = null;
    pendingFiles = [];
    saveState();
    renderAll();
    await sendMessage();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(updateBtn);
  node.appendChild(actions);

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function cancelInlineEdit(node) {
  node.classList.remove("is-editing");
  const actions = node.querySelector(".inline-edit-actions");
  if (actions) actions.remove();
}

function updateAssistantMessage(conversationId, assistant) {
  if (state.activeId !== conversationId) return;
  const body = document.querySelector(`[data-message-id="${assistant.id}"] .message-body`);
  const meta = document.querySelector(`[data-message-id="${assistant.id}"] .message-meta`);
  if (!body || !meta) return;
  meta.firstElementChild.textContent = modelName(assistant.model);
  // 移除 thinking 动画（如果还在）
  const thinking = body.querySelector(".thinking-indicator");
  if (thinking) thinking.remove();
  body.innerHTML = renderMarkdown(assistant.content, assistant.sources);
  renderSources(body, assistant.sources);
  scrollMessagesToEnd();
}

function readSseLines(chunk, buffer, onEvent) {
  buffer.value += chunk;
  const lines = buffer.value.split(/\r?\n/);
  buffer.value = lines.pop() || "";

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    onEvent(data);
  }
}

async function readFileAsPromptPart(file) {
  if (!isTextReadable(file)) {
    return `[File: ${file.name}, type: ${file.type || "unknown"}, size: ${formatBytes(file.size)}]\nThe file is attached in the UI, but this browser-only app does not extract text from this file type.`;
  }

  const text = await file.raw.text();
  return `[File: ${file.name}, type: ${file.type || "unknown"}, size: ${formatBytes(file.size)}]\n${text}`;
}

async function buildUserPromptContent(text, files, retainedFileContext = "") {
  if (!files.length && !retainedFileContext) return text;

  const parts = await Promise.all(files.map(readFileAsPromptPart));
  if (retainedFileContext) {
    parts.unshift(retainedFileContext);
  }
  const prefix = text ? `${text}\n\n` : "";
  return `${prefix}Uploaded files:\n\n${parts.join("\n\n---\n\n")}`;
}

function requestMessagesFor(conversation) {
  const messages = conversation.messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
  const system = systemInput.value.trim();
  return system ? [{ role: "system", content: system }, ...messages] : messages;
}

async function sendMessage() {
  const conversation = getActiveConversation();
  if (controllers.has(conversation.id)) return;

  const requestMessages = requestMessagesFor(conversation);
  const conversationId = conversation.id;

  const controller = new AbortController();
  controllers.set(conversationId, controller);
  syncRunState();
  renderConversationList();

  const selectedModel = modelSelect.value;
  conversation.model = selectedModel;
  const lastUserMessage = conversation.messages
    .slice()
    .reverse()
    .find((message) => message.role === "user");
  const searchQuery = lastUserMessage?.displayContent || lastUserMessage?.content || "";
  const assistant = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    displayContent: "",
    files: [],
    sources: [],
    model: selectedModel
  };
  conversation.messages.push(assistant);
  conversation.updatedAt = Date.now();
  if (state.activeId === conversationId) {
    addMessage(assistant);
  }

  try {
    const maxTokens = Number(maxTokensInput.value);
    const body = {
      model: selectedModel,
      messages: requestMessages,
      temperature: Number(temperatureInput.value),
      stream: true,
      web_search: Boolean(conversation.webMode),
      search_query: searchQuery
    };
    if (Number.isFinite(maxTokens) && maxTokens > 0) {
      body.max_tokens = maxTokens;
    }

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": getSessionToken()
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const buffer = { value: "" };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      readSseLines(decoder.decode(value, { stream: true }), buffer, (data) => {
        const payload = JSON.parse(data);
        if (Array.isArray(payload.web_sources)) {
          assistant.sources = payload.web_sources;
          updateAssistantMessage(conversationId, assistant);
          return;
        }

        if (payload.model && payload.model !== assistant.model) {
          assistant.model = payload.model;
          conversation.model = payload.model;
          if (state.activeId === conversationId) {
            activeModelLabel.textContent = modelName(payload.model);
          }
        }

        const delta = payload.choices?.[0]?.delta?.content || "";
        if (!delta) return;
        assistant.content += delta;
        assistant.displayContent = assistant.content;
        updateAssistantMessage(conversationId, assistant);
      });
    }

    if (!assistant.content.trim()) {
      assistant.content = "No model output was returned.";
      assistant.displayContent = assistant.content;
      updateAssistantMessage(conversationId, assistant);
    }

    conversation.updatedAt = Date.now();
    await maybeGenerateTitle(conversation);
    saveState();
    await saveRemoteStateNow();
    renderConversationList();
  } catch (error) {
    if (error.name === "AbortError") {
      assistant.content = assistant.content || "Stopped.";
      assistant.displayContent = assistant.content;
      updateAssistantMessage(conversationId, assistant);
      conversation.updatedAt = Date.now();
      saveState();
      await saveRemoteStateNow();
      renderConversationList();
      return;
    }

    conversation.messages = conversation.messages.filter((message) => message.id !== assistant.id);
    const errorMessage = {
      id: crypto.randomUUID(),
      role: "error",
      content: error.message || "Request failed.",
      displayContent: error.message || "Request failed.",
      files: []
    };
    conversation.messages.push(errorMessage);
    if (state.activeId === conversationId) {
      renderMessages();
    }
  } finally {
    controllers.delete(conversationId);
    syncRunState();
    renderConversationList();
  }
}

async function maybeGenerateTitle(conversation) {
  if (conversation.titleGenerated) return;
  const firstUser = conversation.messages.find((message) => message.role === "user");
  const firstAssistant = conversation.messages.find((message) => message.role === "assistant" && message.content.trim());
  if (!firstUser || !firstAssistant) return;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": getSessionToken()
      },
      body: JSON.stringify({
        model: conversation.model || modelSelect.value,
        stream: false,
        max_tokens: 20,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "Generate a concise chat title in the same language as the user. Use 4 to 8 words maximum. Return only the title, no punctuation at the end."
          },
          {
            role: "user",
            content: `Question:\n${firstUser.displayContent || firstUser.content}\n\nAnswer summary:\n${firstAssistant.content.slice(0, 900)}`
          }
        ]
      })
    });
    if (!response.ok) return;
    const payload = await response.json();
    const title = payload.choices?.[0]?.message?.content?.replace(/^["']|["']$/g, "").trim();
    if (title) {
      // 限制最多10个词
      const words = title.split(/\s+/);
      const trimmed = words.length > 10 ? words.slice(0, 10).join(" ") : title;
      conversation.title = trimmed;
      conversation.titleGenerated = true;
      if (state.activeId === conversation.id) chatTitle.textContent = conversation.title;
    }
  } catch {
    conversation.title = titleFrom(firstUser.displayContent || firstUser.content || "New chat");
  }
}

function autoResizePrompt() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
}

function addFiles(fileList) {
  const rejected = [];
  for (const raw of fileList) {
    if (raw.size > maxFileBytes) {
      rejected.push(raw.name);
      continue;
    }
    pendingFiles.push({
      id: crypto.randomUUID(),
      raw,
      name: raw.name,
      size: raw.size,
      type: raw.type,
      kind: fileKind(raw)
    });
  }
  if (rejected.length) {
    addMessage({
      role: "error",
      content: `These files exceed 180 KB and were not uploaded: ${rejected.join(", ")}`,
      displayContent: `These files exceed 180 KB and were not uploaded: ${rejected.join(", ")}`,
      files: []
    });
  }
  renderAttachments();
}

temperatureInput.addEventListener("input", () => {
  temperatureValue.textContent = temperatureInput.value;
  saveState();
});

for (const input of [systemInput, maxTokensInput]) {
  input.addEventListener("change", () => {
    saveState();
  });
}

modelSelect.addEventListener("change", () => {
  const conversation = getActiveConversation();
  conversation.model = modelSelect.value;
  saveState();
  renderHeader();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptInput.value.trim();
  if ((!text && !pendingFiles.length) || controllers.has(state.activeId)) return;

  const files = pendingFiles;
  const conversation = getActiveConversation();
  const isEditing = editingState?.conversationId === conversation.id;
  const retainedContext = isEditing ? editingState.retainedFileContext : "";
  const retainedFiles = isEditing ? editingState.retainedFiles : [];
  const content = await buildUserPromptContent(text, files, retainedContext);
  const user = {
    id: isEditing ? editingState.messageId : crypto.randomUUID(),
    role: "user",
    content,
    displayContent: text,
    files: [...retainedFiles, ...files.map(({ raw, ...file }) => file)]
  };

  if (isEditing) {
    conversation.messages.splice(editingState.index, conversation.messages.length - editingState.index, user);
    conversation.title = "New chat";
    conversation.titleGenerated = false;
    editingState = null;
    setEditingLabel(false);
  } else {
    conversation.messages.push(user);
  }

  conversation.updatedAt = Date.now();
  if (!isEditing && conversation.title === "New chat") {
    conversation.title = titleFrom(text || files[0]?.name || "Uploaded file");
  }

  promptInput.value = "";
  pendingFiles = [];
  autoResizePrompt();
  saveState();
  renderAll();
  await sendMessage();
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

promptInput.addEventListener("input", autoResizePrompt);

stopButton.addEventListener("click", () => {
  controllers.get(state.activeId)?.abort();
});

newChatButton.addEventListener("click", () => {
  const conversation = createConversation();
  state.conversations.unshift(conversation);
  state.activeId = conversation.id;
  editingState = null;
  setEditingLabel(false);
  pendingFiles = [];
  saveState();
  renderAll();
  closeSidebarDrawer();
});

exportButton.addEventListener("click", () => {
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), conversations: state.conversations }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `nim-chats-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

// 双击标题可编辑
let isEditingTitle = false;

chatTitle.addEventListener("dblclick", () => {
  isEditingTitle = true;
  chatTitle.contentEditable = "true";
  chatTitle.focus();
  // 选中全部文字
  const range = document.createRange();
  range.selectNodeContents(chatTitle);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});

chatTitle.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    chatTitle.blur();
  }
  if (event.key === "Escape") {
    // 恢复原标题，不保存
    isEditingTitle = false;
    const conversation = getActiveConversation();
    chatTitle.textContent = conversation.title || "New chat";
    chatTitle.contentEditable = "false";
  }
});

chatTitle.addEventListener("blur", () => {
  if (!isEditingTitle) return;
  isEditingTitle = false;
  chatTitle.contentEditable = "false";
  const newTitle = chatTitle.textContent.trim();
  const conversation = getActiveConversation();
  if (newTitle && newTitle !== (conversation.title || "New chat")) {
    // 仅当标题实际改变时才保存并标记为已生成
    conversation.title = newTitle;
    conversation.titleGenerated = true;
    saveState();
    renderConversationList();
  } else {
    // 未改变时还原显示，不影响 titleGenerated
    chatTitle.textContent = conversation.title || "New chat";
  }
});

themeButton.addEventListener("click", cycleTheme);

webModeButton.addEventListener("click", () => {
  setWebMode(webModeButton.getAttribute("aria-pressed") !== "true");
  saveState();
});

attachButton.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.theme === "system") applyTheme("system");
});

const mobileSettingsQuery = window.matchMedia("(max-width: 860px)");
mobileSettingsQuery.addEventListener("change", () => {
  syncSettingsDisclosure();
  setSidebarDrawer(!mobileSettingsQuery.matches);
});
sidebarToggle?.addEventListener("click", toggleSidebarDrawer);
sidebarBackdrop?.addEventListener("click", closeSidebarDrawer);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSidebarDrawer();
});

// ── Auth & boot ──────────────────────────────────────────────
const loginOverlay = document.getElementById("loginOverlay");
const loginForm   = document.getElementById("loginForm");
const loginError  = document.getElementById("loginError");
const loginBtn    = document.getElementById("loginBtn");
const userAvatar  = document.getElementById("userAvatar");
const userName    = document.getElementById("userName");
const userRole    = document.getElementById("userRole");
const logoutButton    = document.getElementById("logoutButton");
const adminPanelBtn   = document.getElementById("adminPanelBtn");

function showApp(session) {
  loginOverlay.hidden = true;
  appShell.hidden = false;
  userAvatar.textContent = session.username[0].toUpperCase();
  userName.textContent = session.username;
  userRole.textContent = session.isAdmin ? "admin" : "user";
  adminPanelBtn.hidden = !session.isAdmin;
}

function showLogin() {
  currentSession = null;
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = null;
  closeSidebarDrawer();
  appShell.hidden = true;
  loginOverlay.hidden = false;
}

async function boot() {
  const token = getSessionToken();
  if (token) {
    const res = await fetch("/api/auth/me", { headers: { "X-Session-Token": token } });
    if (res.ok) {
      const session = await res.json();
      await hydrateSyncedState(session);
      syncSettingsDisclosure();
      showApp(session);
      renderAll();
      syncRunState();
      autoResizePrompt();
      await loadModels();
      return;
    }
    localStorage.removeItem(TOKEN_KEY);
  }
  showLogin();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!username || !password) return;

  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in…";
  loginError.hidden = true;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      loginError.textContent = data.error || "Invalid credentials.";
      loginError.hidden = false;
      return;
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    await hydrateSyncedState(data);
    syncSettingsDisclosure();
    showApp(data);
    renderAll();
    syncRunState();
    autoResizePrompt();
    await loadModels();
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign in";
  }
});

logoutButton.addEventListener("click", async () => {
  await saveRemoteStateNow();
  await fetch("/api/auth/logout", { method: "POST", headers: { "X-Session-Token": getSessionToken() } });
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
});

adminPanelBtn.addEventListener("click", () => { location.href = "/admin.html"; });

syncSettingsDisclosure();
setSidebarDrawer(sidebarPinnedOpen);
boot();
