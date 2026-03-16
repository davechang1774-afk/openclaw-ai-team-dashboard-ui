const STOCK_SETTINGS_KEY = "openclaw.control.settings.v1";
const DEVICE_AUTH_STORAGE_KEY = "openclaw.device.auth.v1";
const DEVICE_IDENTITY_STORAGE_KEY = "openclaw-device-identity-v1";
const DASHBOARD_THEME_KEY = "openclaw.team-dashboard.theme.v1";
const DASHBOARD_TOKEN_KEY = "openclaw.team-dashboard.token.v1";
const ROUTE_RUNTIME_STORAGE_KEY = "openclaw.team-dashboard.route-runtime.v1";
const COMPOSE_HEIGHT_STORAGE_KEY = "openclaw.team-dashboard.compose-height.v1";
const DEFAULT_GATEWAY_TOKEN = "";
const AGENT_ORDER = ["main", "work", "translation", "lifestyle"];
const NO_REPLY_PATTERN = /^\s*NO_REPLY\s*$/i;
const AUTH_CODES = new Set([
  "AUTH_REQUIRED",
  "AUTH_UNAUTHORIZED",
  "AUTH_TOKEN_MISSING",
  "AUTH_TOKEN_MISMATCH",
  "AUTH_TOKEN_NOT_CONFIGURED",
  "AUTH_PASSWORD_MISSING",
  "AUTH_PASSWORD_MISMATCH",
  "AUTH_PASSWORD_NOT_CONFIGURED",
  "AUTH_RATE_LIMITED",
  "PAIRING_REQUIRED",
]);

const state = {
  app: null,
  basePath: "",
  gatewayUrl: "",
  gatewayToken: "",
  gatewayTokenDraft: "",
  theme: loadTheme(),
  activeTab: "overview",
  overviewSection: "as-today",
  pendingScrollTarget: "",
  contentScroll: {},
  chatScroll: {},
  client: null,
  connected: false,
  connecting: true,
  authRequired: false,
  connectError: "",
  serverVersion: "",
  agents: [],
  defaultAgentId: "main",
  sessionKey: "agent:main:main",
  selectedAgentId: "main",
  configSnapshot: null,
  health: null,
  sessions: [],
  sessionsCount: 0,
  skillsReport: null,
  routeRuntime: loadRouteRuntimeStore(),
  chatMessages: [],
  chatMessagesRaw: [],
  chatLoading: false,
  chatSending: false,
  chatRunId: null,
  chatStream: "",
  chatDraft: "",
  lastError: "",
  fallbackLabel: "",
  toolsExpanded: false,
  composeHeight: loadComposeHeight(),
  forceChatBottom: true,
  renderQueued: false,
  healthPollId: null,
  sessionsPollId: null,
  agentsPollId: null,
};

class GatewayRequestError extends Error {
  constructor(error) {
    super(error?.message || "request failed");
    this.gatewayCode = error?.code || "UNAVAILABLE";
    this.details = error?.details;
  }
}

function norm(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTime(ts) {
  const value = Number(ts);
  if (!Number.isFinite(value)) {
    return "刚刚";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAge(ms) {
  const age = Number(ms);
  if (!Number.isFinite(age) || age < 1000) {
    return "刚刚";
  }
  const minutes = Math.floor(age / 60000);
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.floor(hours / 24)} 天前`;
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeSessionKey(value) {
  const text = norm(value);
  if (!text) {
    return "";
  }
  if (text.startsWith("agent:") || text.includes(":")) {
    return text;
  }
  return `agent:${text}:main`;
}

function currentChatScrollKey(tab = state.activeTab) {
  return `${norm(tab) || "monitor"}:${normalizeSessionKey(state.sessionKey) || "agent:main:main"}`;
}

function currentContentScrollKey(tab = state.activeTab) {
  return norm(tab) || "overview";
}

function agentIdFromSession(sessionKey) {
  const match = /^agent:([^:]+):/.exec(sessionKey || "");
  return match?.[1] || "";
}

function configObject() {
  return state.configSnapshot?.config || state.configSnapshot || null;
}

function feishuGroupAgentMap() {
  const groups = configObject()?.channels?.feishu?.groups;
  if (!groups || typeof groups !== "object") {
    return {};
  }
  return Object.entries(groups).reduce((acc, [groupId, entry]) => {
    const agentId = norm(entry?.agent);
    if (groupId && agentId) {
      acc[groupId] = agentId;
    }
    return acc;
  }, {});
}

function mappedAgentIdForText(value) {
  const text = norm(value);
  if (!text) {
    return "";
  }
  const groupMap = feishuGroupAgentMap();
  for (const [groupId, agentId] of Object.entries(groupMap)) {
    if (text.includes(groupId)) {
      return agentId;
    }
  }
  return "";
}

function sessionDisplayLabel(entry) {
  return (
    norm(entry?.derivedTitle) ||
    norm(entry?.displayName) ||
    norm(entry?.label) ||
    compactSessionKey(entry?.key)
  );
}

function resolveSessionAgentId(input) {
  if (!input) {
    return "";
  }
  if (typeof input === "string") {
    return mappedAgentIdForText(input) || agentIdFromSession(input);
  }
  return (
    mappedAgentIdForText(input.key) ||
    mappedAgentIdForText(input.displayName) ||
    mappedAgentIdForText(input.label) ||
    mappedAgentIdForText(input.derivedTitle) ||
    norm(input.agentId) ||
    agentIdFromSession(input.key)
  );
}

function normalizeSessionRow(entry) {
  const key = normalizeSessionKey(entry?.key);
  const updatedAt = Number(entry?.updatedAt || 0);
  const age = Number(entry?.age);
  const resolvedAge =
    Number.isFinite(age) && age >= 0
      ? age
      : Number.isFinite(updatedAt) && updatedAt > 0
        ? Math.max(0, Date.now() - updatedAt)
        : Number.POSITIVE_INFINITY;
  return {
    ...entry,
    key,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    age: resolvedAge,
    channel: norm(entry?.channel),
    kind: norm(entry?.kind),
    agentId: resolveSessionAgentId(entry),
  };
}

function inferBasePath(pathname) {
  const known = [
    "/chat",
    "/overview",
    "/channels",
    "/instances",
    "/sessions",
    "/usage",
    "/cron",
    "/skills",
    "/nodes",
    "/agents",
    "/config",
    "/debug",
    "/logs",
    "/stock/index.html",
    "/index.html",
  ];
  for (const suffix of known) {
    if (pathname === suffix) {
      return "";
    }
    if (pathname.endsWith(suffix)) {
      return pathname.slice(0, -suffix.length);
    }
  }
  return "";
}

function buildGatewayUrl(basePath) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${basePath}`;
}

function isStockRoute() {
  return /\/stock(?:\/|$)/i.test(window.location.pathname);
}

function stockBasePath() {
  const pathname = window.location.pathname || "";
  const index = pathname.toLowerCase().indexOf("/stock");
  if (index <= 0) {
    return "";
  }
  const base = pathname.slice(0, index);
  return base === "/" ? "" : base;
}

function joinBasePath(basePath, suffix) {
  if (!basePath) {
    return suffix;
  }
  return `${basePath}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

async function bootStockControlUi() {
  const mount = document.getElementById("app");
  if (!mount) {
    return;
  }
  const basePath = stockBasePath();
  const session = new URL(window.location.href).searchParams.get("session");
  window.__OPENCLAW_CONTROL_UI_BASE_PATH__ = basePath;
  try {
    const key = STOCK_SETTINGS_KEY;
    const raw = window.localStorage.getItem(key);
    const current = raw ? JSON.parse(raw) : {};
    const next = { ...current, chatFocusMode: true, navCollapsed: true };
    if (session) {
      next.sessionKey = session;
      next.lastActiveSessionKey = session;
    }
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // ignore
  }
  try {
    const indexResponse = await fetch(joinBasePath(basePath, "/official-index-current.txt"), {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!indexResponse.ok) {
      throw new Error(`无法读取官方控制台入口 (${indexResponse.status})`);
    }
    const html = await indexResponse.text();
    const jsAsset = html.match(/src="\.\/assets\/([^"]+\.js)"/i)?.[1];
    const cssAsset = html.match(/href="\.\/assets\/([^"]+\.css)"/i)?.[1];
    if (!jsAsset || !cssAsset) {
      throw new Error("未找到官方控制台所需的 js/css 资源");
    }
    document.title = "OpenClaw Control";
    mount.outerHTML = "<openclaw-app></openclaw-app>";
    const cssUrl = joinBasePath(basePath, `/assets/${cssAsset}`);
    const jsUrl = new URL(joinBasePath(basePath, `/assets/${jsAsset}`), window.location.origin).href;
    const officialCss = document.createElement("link");
    officialCss.rel = "stylesheet";
    officialCss.crossOrigin = "";
    officialCss.href = cssUrl;
    document.head.appendChild(officialCss);
    await import(jsUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "加载失败");
    mount.innerHTML = `<div style="padding:32px;color:#f5f7fb;font-family:system-ui;background:#0f1117;min-height:100vh"><h1 style="margin:0 0 12px;font-size:24px">OpenClaw 原生控制台加载失败</h1><p style="margin:0;color:#9ba6bf;line-height:1.8">当前无法装载官方 3.13 控制台资源。<br/>错误：${esc(message)}</p></div>`;
  }
}

function saveStockSettings(patch) {
  try {
    const raw = window.localStorage.getItem(STOCK_SETTINGS_KEY);
    const current = raw ? JSON.parse(raw) : {};
    window.localStorage.setItem(STOCK_SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // ignore
  }
}

function loadRouteRuntimeStore() {
  try {
    const raw = window.localStorage.getItem(ROUTE_RUNTIME_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.reduce((acc, item) => {
      const sessionKey = normalizeSessionKey(item?.sessionKey);
      const agentId = norm(item?.agentId);
      const model = norm(item?.model);
      const key = norm(item?.key) || sessionKey || (agentId ? `agent:${agentId}` : "");
      if (!key || !model) {
        return acc;
      }
      acc[key] = {
        key,
        sessionKey,
        agentId,
        model,
        updatedAt: Number(item?.updatedAt) || 0,
        source: norm(item?.source) || "runtime",
      };
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function persistRouteRuntimeStore() {
  try {
    const entries = Object.values(state.routeRuntime || {})
      .filter((item) => norm(item?.model))
      .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
      .slice(0, 120)
      .map((item) => {
        const sessionKey = normalizeSessionKey(item?.sessionKey);
        const agentId = norm(item?.agentId);
        return {
          key: norm(item?.key) || sessionKey || (agentId ? `agent:${agentId}` : ""),
          sessionKey,
          agentId,
          model: norm(item?.model),
          updatedAt: Number(item?.updatedAt) || 0,
          source: norm(item?.source) || "runtime",
        };
      })
      .filter((item) => item.key && item.model);
    state.routeRuntime = entries.reduce((acc, item) => {
      acc[item.key] = item;
      return acc;
    }, {});
    window.localStorage.setItem(
      ROUTE_RUNTIME_STORAGE_KEY,
      JSON.stringify({ version: 1, entries }),
    );
  } catch {
    // ignore
  }
}

function rememberRuntimeRoute(sessionKey, agentId, model, source = "runtime") {
  const normalizedModel = norm(model);
  if (!normalizedModel) {
    return null;
  }
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  const normalizedAgentId =
    norm(agentId) || resolveSessionAgentId(normalizedSessionKey) || state.selectedAgentId || "main";
  const key = normalizedSessionKey || `agent:${normalizedAgentId}`;
  const entry = {
    key,
    sessionKey: normalizedSessionKey,
    agentId: normalizedAgentId,
    model: normalizedModel,
    updatedAt: Date.now(),
    source: norm(source) || "runtime",
  };
  state.routeRuntime = {
    ...(state.routeRuntime || {}),
    [key]: entry,
  };
  persistRouteRuntimeStore();
  return entry;
}

function latestRuntimeRouteForSession(sessionKey) {
  const key = normalizeSessionKey(sessionKey);
  return key ? state.routeRuntime?.[key] || null : null;
}

function latestRuntimeRouteForAgent(agentId) {
  const target = norm(agentId);
  if (!target) {
    return null;
  }
  return Object.values(state.routeRuntime || {})
    .filter((entry) => norm(entry?.agentId) === target)
    .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))[0] || null;
}

function loadTheme() {
  try {
    const saved = window.localStorage.getItem(DASHBOARD_THEME_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    // ignore
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function loadComposeHeight() {
  try {
    return clampNumber(window.localStorage.getItem(COMPOSE_HEIGHT_STORAGE_KEY), 148, 420);
  } catch {
    return 148;
  }
}

function setComposeHeight(value) {
  const next = clampNumber(value, 148, 420);
  state.composeHeight = next;
  try {
    window.localStorage.setItem(COMPOSE_HEIGHT_STORAGE_KEY, String(next));
  } catch {
    // ignore
  }
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
}

function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  try {
    window.localStorage.setItem(DASHBOARD_THEME_KEY, state.theme);
  } catch {
    // ignore
  }
  saveStockSettings({ theme: state.theme });
  scheduleRender();
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
}

async function fingerprintPublicKey(publicKeyBytes) {
  const digest = await window.crypto.subtle.digest("SHA-256", publicKeyBytes.slice().buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadOrCreateDeviceIdentity() {
  try {
    const raw = window.localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version === 1 && parsed.publicKey && parsed.privateKey && parsed.deviceId) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  const keys = await window.crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyBytes = new Uint8Array(await window.crypto.subtle.exportKey("raw", keys.publicKey));
  const privateJwk = await window.crypto.subtle.exportKey("jwk", keys.privateKey);
  const identity = {
    version: 1,
    deviceId: await fingerprintPublicKey(publicKeyBytes),
    publicKey: base64UrlEncode(publicKeyBytes),
    privateKey: privateJwk.d,
    createdAtMs: Date.now(),
  };
  window.localStorage.setItem(DEVICE_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

async function signDevicePayload(privateKeyBase64Url, publicKeyBase64Url, payload) {
  const key = await window.crypto.subtle.importKey(
    "jwk",
    {
      kty: "OKP",
      crv: "Ed25519",
      d: privateKeyBase64Url,
      x: publicKeyBase64Url,
      ext: true,
      key_ops: ["sign"],
    },
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await window.crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(payload),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

function readDeviceAuthStore() {
  try {
    const raw = window.localStorage.getItem(DEVICE_AUTH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function loadDeviceAuthToken(deviceId, role) {
  const store = readDeviceAuthStore();
  if (!store || store.deviceId !== deviceId) {
    return null;
  }
  return store.tokens?.[role] || null;
}

function storeDeviceAuthToken(deviceId, role, token, scopes) {
  const current = readDeviceAuthStore();
  const next = {
    version: 1,
    deviceId,
    tokens:
      current && current.deviceId === deviceId && current.tokens ? { ...current.tokens } : {},
  };
  next.tokens[role] = {
    token,
    role,
    scopes: Array.isArray(scopes) ? [...new Set(scopes.map(norm).filter(Boolean))].sort() : [],
    updatedAtMs: Date.now(),
  };
  window.localStorage.setItem(DEVICE_AUTH_STORAGE_KEY, JSON.stringify(next));
}

function persistGatewayToken(token) {
  try {
    if (token) {
      window.sessionStorage.setItem(DASHBOARD_TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(DASHBOARD_TOKEN_KEY);
    }
  } catch {
    // ignore
  }
}

function loadGatewayToken() {
  try {
    const url = new URL(window.location.href);
    const queryToken = norm(url.searchParams.get("token")) || norm(url.searchParams.get("gatewayToken"));
    const hashToken = norm(new URLSearchParams(url.hash.replace(/^#/, "")).get("token"));
    const sessionToken = norm(window.sessionStorage.getItem(DASHBOARD_TOKEN_KEY));
    const token = queryToken || hashToken || sessionToken;
    if (queryToken || hashToken) {
      persistGatewayToken(token);
      url.searchParams.delete("token");
      url.searchParams.delete("gatewayToken");
      url.hash = "";
      window.history.replaceState({}, "", url);
    }
    return token;
  } catch {
    return "";
  }
}

function buildDeviceAuthPayload(identity, token, nonce, signedAtMs) {
  return [
    "v2",
    identity.deviceId,
    "openclaw-control-ui",
    "webchat",
    "operator",
    "operator.admin,operator.approvals,operator.pairing",
    String(signedAtMs),
    token || "",
    nonce || "",
  ].join("|");
}

class GatewayBrowserClient {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.ws = null;
    this.pending = new Map();
    this.closed = false;
    this.nonce = "";
    this.connectSent = false;
    this.backoffMs = 800;
    this.connectError = null;
  }

  start() {
    this.closed = false;
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("open", () => {
      this.nonce = "";
      this.connectSent = false;
      window.setTimeout(() => void this.sendConnect(), 750);
    });
    this.ws.addEventListener("message", (event) => this.onMessage(String(event.data || "")));
    this.ws.addEventListener("close", () => {
      state.connected = false;
      state.authRequired = AUTH_CODES.has(norm(this.connectError?.details?.code));
      state.connectError = this.connectError?.message || "";
      state.connecting = !state.authRequired;
      stopPollers();
      scheduleRender();
      if (!this.closed && !state.authRequired) {
        window.setTimeout(() => this.start(), this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 1.7, 15000);
      }
    });
  }

  stop() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  async sendConnect() {
    if (this.connectSent || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.connectSent = true;
    const identity = await loadOrCreateDeviceIdentity();
    const storedToken = !this.token ? loadDeviceAuthToken(identity.deviceId, "operator")?.token : "";
    const authToken = this.token || storedToken || "";
    const signedAt = Date.now();
    const payload = buildDeviceAuthPayload(identity, authToken, this.nonce, signedAt);
    const signature = await signDevicePayload(identity.privateKey, identity.publicKey, payload);
    try {
      const hello = await this.request("connect", {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openclaw-control-ui",
          version: "ai-team-dashboard",
          platform: navigator.platform || "web",
          mode: "webchat",
          instanceId: crypto.randomUUID?.() || String(Date.now()),
        },
        role: "operator",
        scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
        caps: ["tool-events"],
        auth: authToken ? { token: authToken } : undefined,
        device: {
          id: identity.deviceId,
          publicKey: identity.publicKey,
          signature,
          signedAt,
          nonce: this.nonce,
        },
        userAgent: navigator.userAgent,
        locale: navigator.language,
      });
      if (hello?.auth?.deviceToken) {
        storeDeviceAuthToken(identity.deviceId, hello.auth.role || "operator", hello.auth.deviceToken, hello.auth.scopes || []);
      }
      this.backoffMs = 800;
      state.connected = true;
      state.connecting = false;
      state.authRequired = false;
      state.connectError = "";
      state.serverVersion = norm(hello?.server?.version);
      scheduleRender();
      startPollers();
      void refreshAll();
    } catch (error) {
      this.connectError = error instanceof GatewayRequestError ? error : { message: String(error || "") };
      this.ws?.close(4008, "connect failed");
    }
  }

  onMessage(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (parsed?.type === "event" && parsed.event === "connect.challenge") {
      this.nonce = norm(parsed?.payload?.nonce);
      void this.sendConnect();
      return;
    }
    if (parsed?.type === "event") {
      handleEvent(parsed.event, parsed.payload);
      return;
    }
    if (parsed?.type === "res") {
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        return;
      }
      this.pending.delete(parsed.id);
      if (parsed.ok) {
        pending.resolve(parsed.payload);
      } else {
        pending.reject(new GatewayRequestError(parsed.error));
      }
    }
  }

  request(method, params) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
}

function scheduleRender() {
  if (state.renderQueued) {
    return;
  }
  state.renderQueued = true;
  window.requestAnimationFrame(() => {
    state.renderQueued = false;
    render();
  });
}

function init() {
  state.app = document.getElementById("app");
  state.basePath = inferBasePath(window.location.pathname);
  state.gatewayUrl = buildGatewayUrl(state.basePath);
  state.gatewayToken = loadGatewayToken() || DEFAULT_GATEWAY_TOKEN;
  state.gatewayTokenDraft = state.gatewayToken;
  let savedSession = "";
  try {
    const raw = window.localStorage.getItem(STOCK_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    savedSession = normalizeSessionKey(parsed?.lastActiveSessionKey || parsed?.sessionKey);
  } catch {
    // ignore
  }
  const urlSession = normalizeSessionKey(new URL(window.location.href).searchParams.get("session")) || savedSession;
  if (urlSession) {
    state.sessionKey = urlSession;
    state.selectedAgentId = resolveSessionAgentId(urlSession) || "main";
  }
  setTheme(state.theme);
  bindEvents();
  render();
  connectGateway();
}

function connectGateway() {
  stopPollers();
  state.client?.stop();
  state.client = new GatewayBrowserClient(state.gatewayUrl, state.gatewayToken);
  state.connected = false;
  state.connecting = true;
  state.authRequired = false;
  state.connectError = "";
  state.fallbackLabel = "";
  state.sessions = [];
  state.sessionsCount = 0;
  state.skillsReport = null;
  state.configSnapshot = null;
  state.chatMessagesRaw = [];
  state.forceChatBottom = true;
  scheduleRender();
  state.client.start();
}

function startPollers() {
  stopPollers();
  state.healthPollId = window.setInterval(() => void loadHealth(), 30000);
  state.sessionsPollId = window.setInterval(() => void loadSessions(), 15000);
  state.agentsPollId = window.setInterval(() => {
    void loadAgents();
    void loadConfigSnapshot();
    void loadSkillsStatus();
  }, 60000);
}

function stopPollers() {
  if (state.healthPollId) {
    window.clearInterval(state.healthPollId);
    state.healthPollId = null;
  }
  if (state.sessionsPollId) {
    window.clearInterval(state.sessionsPollId);
    state.sessionsPollId = null;
  }
  if (state.agentsPollId) {
    window.clearInterval(state.agentsPollId);
    state.agentsPollId = null;
  }
}

async function refreshAll() {
  await loadConfigSnapshot();
  await Promise.all([
    loadAgents(),
    loadHealth(),
    loadSessions(),
    loadSkillsStatus(),
    loadChatHistory(),
  ]);
}

async function loadAgents() {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const result = await state.client.request("agents.list", {});
    state.defaultAgentId = norm(result?.defaultId) || "main";
    state.agents = [...(Array.isArray(result?.agents) ? result.agents : [])].sort((a, b) => {
      const ia = AGENT_ORDER.indexOf(a.id);
      const ib = AGENT_ORDER.indexOf(b.id);
      if (ia !== -1 || ib !== -1) {
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      }
      return String(a.id || "").localeCompare(String(b.id || ""), "zh-CN");
    });
    if (!state.agents.some((agent) => agent.id === state.selectedAgentId)) {
      setSession(`agent:${state.defaultAgentId}:main`, false);
    }
  } catch (error) {
    state.lastError = error.message || String(error || "");
  }
  scheduleRender();
}

async function loadConfigSnapshot() {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    state.configSnapshot = await state.client.request("config.get", {});
  } catch (error) {
    state.lastError = error.message || String(error || "");
  }
  scheduleRender();
}

async function loadHealth() {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    state.health = await state.client.request("health");
  } catch (error) {
    state.lastError = error.message || String(error || "");
  }
  scheduleRender();
}

async function loadSessions() {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const result = await state.client.request("sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
      includeDerivedTitles: true,
      limit: 200,
    });
    const rows = Array.isArray(result?.sessions) ? result.sessions.map(normalizeSessionRow) : [];
    state.sessions = rows
      .filter((entry) => entry.key)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    state.sessionsCount = Number(result?.count) || state.sessions.length;
    const resolvedAgentId = resolveSessionAgentId(state.sessionKey);
    if (resolvedAgentId) {
      state.selectedAgentId = resolvedAgentId;
    }
    const preferredKey = preferredSessionKeyForAgent(state.selectedAgentId);
    if (
      preferredKey &&
      preferredKey !== state.sessionKey &&
      state.sessionKey === `agent:${state.selectedAgentId}:main` &&
      Number(recentSessions(state.selectedAgentId)[0]?.age) <= 30 * 60 * 1000
    ) {
      setSession(preferredKey);
      return;
    }
  } catch (error) {
    state.lastError = error.message || String(error || "");
  }
  scheduleRender();
}

async function loadSkillsStatus() {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    state.skillsReport = await state.client.request("skills.status", {});
  } catch (error) {
    state.lastError = error.message || String(error || "");
  }
  scheduleRender();
}

async function loadChatHistory() {
  if (!state.client || !state.connected) {
    return;
  }
  state.chatLoading = true;
  scheduleRender();
  try {
    const result = await state.client.request("chat.history", {
      sessionKey: state.sessionKey,
      limit: 200,
    });
    const messages = Array.isArray(result?.messages) ? result.messages : [];
    state.chatMessagesRaw = messages;
    state.chatMessages = messages.filter((message) => !isSilentAssistant(message) && isRenderableMessage(message));
    state.chatRunId = null;
    state.chatStream = "";
  } catch (error) {
    state.lastError = error.message || String(error || "");
  } finally {
    state.chatLoading = false;
    scheduleRender();
  }
}

async function sendChat() {
  if (!state.client || !state.connected || !state.chatDraft.trim()) {
    return;
  }
  const text = state.chatDraft.trim();
  const now = Date.now();
  const runId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  state.chatMessages = [
    ...state.chatMessages,
    { role: "user", content: [{ type: "text", text }], timestamp: now },
  ];
  state.chatMessagesRaw = [
    ...state.chatMessagesRaw,
    { role: "user", content: [{ type: "text", text }], timestamp: now },
  ];
  state.chatDraft = "";
  state.chatSending = true;
  state.chatRunId = runId;
  state.chatStream = "";
  rememberRuntimeRoute(
    state.sessionKey,
    state.selectedAgentId,
    primaryModel(getAgent(state.selectedAgentId)),
    "dispatch",
  );
  state.fallbackLabel = "";
  scheduleRender();
  try {
    await state.client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: text,
      deliver: false,
      idempotencyKey: runId,
    });
  } catch (error) {
    state.chatRunId = null;
    state.chatStream = "";
    state.lastError = error.message || String(error || "");
    const errorMessage = {
      role: "assistant",
      content: [{ type: "text", text: `Error: ${state.lastError}` }],
      timestamp: Date.now(),
    };
    state.chatMessages = [
      ...state.chatMessages,
      errorMessage,
    ];
    state.chatMessagesRaw = [...state.chatMessagesRaw, errorMessage];
  } finally {
    state.chatSending = false;
    scheduleRender();
  }
}

async function abortRun() {
  if (!state.client || !state.connected || !state.chatRunId) {
    return;
  }
  try {
    await state.client.request("chat.abort", {
      sessionKey: state.sessionKey,
      runId: state.chatRunId,
    });
  } catch (error) {
    state.lastError = error.message || String(error || "");
    scheduleRender();
  }
}

function handleEvent(eventName, payload) {
  if (eventName === "chat") {
    handleChatEvent(payload);
    return;
  }
  if (eventName === "agent") {
    handleAgentEvent(payload);
  }
}

function handleAgentEvent(payload) {
  if (payload?.stream !== "fallback" && payload?.stream !== "lifecycle") {
    return;
  }
  const sessionKey = normalizeSessionKey(payload?.sessionKey) || state.sessionKey;
  const data = payload?.data || {};
  const active =
    (norm(data.activeProvider) && norm(data.activeModel) && `${norm(data.activeProvider)}/${norm(data.activeModel)}`) ||
    (norm(data.toProvider) && norm(data.toModel) && `${norm(data.toProvider)}/${norm(data.toModel)}`) ||
    "";
  const agentId = resolveSessionAgentId(payload) || resolveSessionAgentId(sessionKey) || state.selectedAgentId;
  if (active) {
    rememberRuntimeRoute(sessionKey, agentId, active, payload?.stream);
  }
  if (sessionKey === state.sessionKey) {
    const activeRoute = currentRouteStatus(getAgent(agentId) || agentId, sessionKey);
    state.fallbackLabel = activeRoute.isFallback ? `已切换到 ${activeRoute.detailLabel}` : "";
  }
  scheduleRender();
}

function handleChatEvent(payload) {
  if (normalizeSessionKey(payload?.sessionKey) !== state.sessionKey) {
    return;
  }
  if (payload?.state === "delta") {
    const text = extractText(payload.message);
    if (text && !NO_REPLY_PATTERN.test(text)) {
      state.chatStream = text;
      scheduleRender();
    }
    return;
  }
  if (payload?.state === "final") {
    const message = payload.message;
    if (message) {
      state.chatMessagesRaw = [...state.chatMessagesRaw, message];
    }
    if (message && !isSilentAssistant(message) && isRenderableMessage(message)) {
      state.chatMessages = [...state.chatMessages, message];
    } else if (state.chatStream.trim()) {
      const streamedMessage = {
        role: "assistant",
        content: [{ type: "text", text: state.chatStream }],
        timestamp: Date.now(),
      };
      state.chatMessages = [
        ...state.chatMessages,
        streamedMessage,
      ];
      state.chatMessagesRaw = [...state.chatMessagesRaw, streamedMessage];
    }
    state.chatRunId = null;
    state.chatStream = "";
    void loadHealth();
    void loadSessions();
    scheduleRender();
    return;
  }
  if (payload?.state === "aborted" || payload?.state === "error") {
    state.chatRunId = null;
    state.chatStream = "";
    state.lastError = norm(payload?.errorMessage) || state.lastError;
    scheduleRender();
  }
}

function extractText(message) {
  if (!message || typeof message !== "object") {
    return "";
  }
  if (typeof message.text === "string") {
    return message.text;
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((item) => (item?.type === "text" && typeof item.text === "string" ? item.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function isSilentAssistant(message) {
  return norm(message?.role).toLowerCase() === "assistant" && NO_REPLY_PATTERN.test(extractText(message));
}

function isRenderableMessage(message) {
  const role = norm(message?.role).toLowerCase();
  if (role.includes("tool")) {
    return true;
  }
  if (norm(message?.errorMessage)) {
    return true;
  }
  return Boolean(extractText(message).trim());
}

function sourceMessagesForSession() {
  return Array.isArray(state.chatMessagesRaw) && state.chatMessagesRaw.length
    ? state.chatMessagesRaw
    : state.chatMessages;
}

function toolBlocksFromMessage(message) {
  if (!Array.isArray(message?.content)) {
    return [];
  }
  return message.content.filter((block) => {
    const type = norm(block?.type).toLowerCase();
    return type === "toolcall" || type === "tooluse" || type === "functioncall";
  });
}

function normalizeToolArgs(block) {
  const raw =
    block?.arguments ??
    block?.args ??
    block?.input ??
    block?.function?.arguments ??
    block?.functionArguments;
  if (!raw) {
    return {};
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : { value: raw };
    } catch {
      return { value: raw };
    }
  }
  return typeof raw === "object" ? raw : { value: raw };
}

function basename(value) {
  const text = norm(value).replace(/[\\/]+$/, "");
  if (!text) {
    return "";
  }
  const parts = text.split(/[\\/]/);
  return parts[parts.length - 1] || text;
}

function firstLine(value) {
  return norm(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function firstMeaningfulLine(value) {
  return (
    norm(value)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/^[\[\]{}(),:]+$/.test(line)) || ""
  );
}

function shortenText(value, limit = 180) {
  const text = norm(value);
  if (!text || text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(norm).filter(Boolean))];
}

function collectPaths(value, key = "", acc = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPaths(item, key, acc));
    return acc;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([entryKey, entryValue]) => collectPaths(entryValue, entryKey, acc));
    return acc;
  }
  if (typeof value !== "string") {
    return acc;
  }
  const text = value.trim();
  if (!text) {
    return acc;
  }
  const lowerKey = String(key || "").toLowerCase();
  const pathKey =
    lowerKey.includes("path") ||
    lowerKey.includes("file") ||
    lowerKey.includes("dir") ||
    lowerKey.includes("cwd") ||
    lowerKey.includes("workdir") ||
    lowerKey.includes("from") ||
    lowerKey.includes("to") ||
    lowerKey.includes("target") ||
    lowerKey.includes("source");
  const pathValue =
    /^[a-zA-Z]:\\/.test(text) ||
    text.startsWith("/") ||
    text.includes("\\") ||
    /\/[^/]/.test(text) ||
    /\.[a-zA-Z0-9]{1,8}$/.test(text);
  if (pathKey || pathValue) {
    acc.push(text);
  }
  return acc;
}

function extractPathsFromText(text) {
  return uniqueStrings(
    (norm(text).match(/[A-Za-z]:\\[^\s"'<>|]+/g) || []).map((item) => item.replace(/[.,;:!?]+$/, "")),
  );
}

function toolActionLabel(name) {
  const lower = norm(name).toLowerCase();
  if (!lower) {
    return "Process";
  }
  if (lower.includes("read")) {
    return "Read";
  }
  if (lower.includes("write")) {
    return "Write";
  }
  if (lower.includes("edit") || lower.includes("patch") || lower.includes("apply")) {
    return "Edit";
  }
  if (
    lower.includes("exec") ||
    lower.includes("run") ||
    lower.includes("shell") ||
    lower.includes("powershell") ||
    lower.includes("command")
  ) {
    return "Exec";
  }
  if (lower.includes("find") || lower.includes("grep") || lower.includes("search") || lower.includes("select-string")) {
    return "Search";
  }
  if (
    lower.includes("fetch") ||
    lower.includes("request") ||
    lower.includes("http") ||
    lower.includes("curl") ||
    lower.includes("download")
  ) {
    return "Fetch";
  }
  if (lower.includes("process")) {
    return "Process";
  }
  return lower
    .split(/[._:/-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toolActionIcon(label) {
  if (label === "Read") {
    return "📄";
  }
  if (label === "Write" || label === "Edit") {
    return "✏️";
  }
  if (label === "Exec") {
    return "⚙️";
  }
  if (label === "Search") {
    return "🔎";
  }
  if (label === "Fetch") {
    return "🌐";
  }
  return "🧠";
}

function shouldTrackToolCall(callName, args) {
  const lower = norm(callName).toLowerCase();
  if (!lower) {
    return false;
  }
  if (
    lower.includes("memory") ||
    (lower.includes("session") && lower.includes("list")) ||
    lower.includes("conversation info") ||
    lower.includes("chat history")
  ) {
    return false;
  }
  const label = toolActionLabel(callName);
  if (["Read", "Write", "Edit", "Exec", "Search", "Fetch"].includes(label)) {
    return true;
  }
  const hasCommand =
    norm(args?.command) ||
    norm(args?.cmd) ||
    norm(args?.run) ||
    norm(args?.shell) ||
    norm(args?.script) ||
    (Array.isArray(args?.commandArgv) ? args.commandArgv.join(" ") : "") ||
    (Array.isArray(args?.argv) ? args.argv.join(" ") : "");
  return Boolean(hasCommand || uniqueStrings(collectPaths(args)).length || norm(args?.pattern));
}

function toolResultStatus(resultMessage) {
  if (!resultMessage) {
    return "running";
  }
  if (norm(resultMessage?.errorMessage)) {
    return "failed";
  }
  const text = extractText(resultMessage).trim();
  if (/^(error|failed|traceback|exception)\b/i.test(text)) {
    return "failed";
  }
  return "completed";
}

function toolStatusLabel(status) {
  if (status === "completed") {
    return "Completed";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Running";
}

function summarizeToolCall(callName, args) {
  const label = toolActionLabel(callName);
  const command =
    norm(args?.command) ||
    norm(args?.cmd) ||
    norm(args?.run) ||
    norm(args?.shell) ||
    norm(args?.script) ||
    (Array.isArray(args?.commandArgv) ? args.commandArgv.join(" ") : "") ||
    (Array.isArray(args?.argv) ? args.argv.join(" ") : "") ||
    norm(args?.value);
  const paths = uniqueStrings(collectPaths(args)).slice(0, 5);
  let detail = "";
  if (command) {
    detail = `with run ${command}`;
  } else if (paths.length) {
    if (label === "Read") {
      detail = `with from ${paths[0]}`;
    } else if (label === "Write" || label === "Edit") {
      detail = `with file ${paths[0]}`;
    } else {
      detail = `with target ${paths[0]}`;
    }
  } else if (norm(args?.pattern)) {
    detail = `with pattern ${norm(args.pattern)}`;
  } else {
    detail = "with current context";
  }
  return {
    title: label,
    icon: toolActionIcon(label),
    detail: shortenText(detail, 220),
    files: paths,
  };
}

function summarizeToolResult(resultMessage, title) {
  const text = extractText(resultMessage).trim();
  if (!text) {
    return "";
  }
  if (title === "Read") {
    return "";
  }
  const line = firstMeaningfulLine(text) || firstLine(text);
  if (!line) {
    return /^[\[{]/.test(text) ? "Returned structured data" : "";
  }
  return shortenText(line, 180);
}

function parseTextOperations(message) {
  const role = norm(message?.role).toLowerCase();
  if (role !== "assistant" && role !== "toolresult" && !role.includes("tool")) {
    return [];
  }
  const timestamp = Number(message?.timestamp) || 0;
  const lines = norm(extractText(message))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items = [];
  for (const line of lines) {
    let title = "";
    let detail = "";
    if (/^已运行\s+/u.test(line)) {
      title = "Exec";
      detail = shortenText(`with run ${line.replace(/^已运行\s+/u, "")}`, 220);
    } else if (/^已读取\s+/u.test(line) || /^读取\s+/u.test(line)) {
      title = "Read";
      detail = shortenText(`with from ${line.replace(/^(已)?读取\s+/u, "")}`, 220);
    } else if (/^已修改\s+/u.test(line) || /^已更新\s+/u.test(line) || /^已编辑\s+/u.test(line)) {
      title = "Edit";
      detail = shortenText(`with file ${line.replace(/^已(修改|更新|编辑)\s+/u, "")}`, 220);
    } else {
      continue;
    }
    const files = extractPathsFromText(detail);
    items.push({
      key: `text:${timestamp}:${title}:${detail}`,
      title,
      icon: toolActionIcon(title),
      detail,
      files,
      preview: "",
      status: "completed",
      timestamp,
      source: "text",
    });
  }
  return items;
}

function commitItemsForCurrentSession() {
  const messages = sourceMessagesForSession();
  const resultsById = new Map();
  messages.forEach((message) => {
    if (norm(message?.role).toLowerCase() === "toolresult" && norm(message?.toolCallId)) {
      resultsById.set(norm(message.toolCallId), message);
    }
  });
  const items = [];
  messages.forEach((message) => {
    const timestamp = Number(message?.timestamp) || 0;
    toolBlocksFromMessage(message).forEach((block) => {
      const id = norm(block?.id || block?.toolCallId || block?.callId);
      const name = norm(block?.name || block?.toolName || block?.function?.name);
      const args = normalizeToolArgs(block);
      if (!shouldTrackToolCall(name, args)) {
        return;
      }
      const result = id ? resultsById.get(id) : null;
      const summary = summarizeToolCall(name, args);
      items.push({
        key: id || `tool:${timestamp}:${name}:${summary.detail}`,
        title: summary.title,
        icon: summary.icon,
        detail: summary.detail,
        files: summary.files,
        preview: summarizeToolResult(result, summary.title),
        status: toolResultStatus(result),
        timestamp: timestamp || Number(result?.timestamp) || 0,
        source: "tool",
      });
    });
    items.push(...parseTextOperations(message));
  });
  const seen = new Set();
  return items
    .filter((item) => {
      if (!item.key || seen.has(item.key)) {
        return false;
      }
      seen.add(item.key);
      return true;
    })
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(0, 10);
}

function formatCompactNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return new Intl.NumberFormat("zh-CN", {
    notation: numeric >= 1000 ? "compact" : "standard",
    maximumFractionDigits: numeric >= 1000 ? 1 : 0,
  }).format(numeric);
}

function formatCost(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "未上报";
  }
  return `$${numeric.toFixed(numeric >= 1 ? 2 : 4)}`;
}

function usageSessionsForAgent(agentId) {
  return state.sessions.filter((session) => norm(session?.agentId) === norm(agentId) && session?.usage);
}

function aggregateUsageForAgent(agentId) {
  const sessions = usageSessionsForAgent(agentId);
  const models = new Map();
  const providers = new Map();
  const tools = new Map();
  const usage = {
    sessions: sessions.length,
    messages: 0,
    toolCalls: 0,
    toolResults: 0,
    errors: 0,
    tokens: 0,
    cost: 0,
    requests: 0,
    hasUsage: false,
  };

  const mergeEntry = (bucket, key, patch) => {
    if (!key) {
      return;
    }
    const current = bucket.get(key) || { key, count: 0, tokens: 0, cost: 0 };
    current.count += Number(patch?.count || 0);
    current.tokens += Number(patch?.tokens || 0);
    current.cost += Number(patch?.cost || 0);
    bucket.set(key, current);
  };

  sessions.forEach((session) => {
    const current = session?.usage;
    if (!current || typeof current !== "object") {
      return;
    }
    usage.hasUsage = true;
    const messageCounts = current.messageCounts || {};
    const toolUsage = current.toolUsage || {};
    usage.messages += Number(messageCounts.total || 0);
    usage.requests += Number(messageCounts.user || 0);
    usage.toolCalls += Number(messageCounts.toolCalls || toolUsage.totalCalls || 0);
    usage.toolResults += Number(messageCounts.toolResults || 0);
    usage.errors += Number(messageCounts.errors || 0);
    usage.tokens += Number(current.totalTokens || 0);
    usage.cost += Number(current.totalCost || 0);

    if (Array.isArray(toolUsage.tools)) {
      toolUsage.tools.forEach((tool) => {
        mergeEntry(tools, norm(tool?.name), {
          count: Number(tool?.count || 0),
        });
      });
    }

    if (Array.isArray(current.modelUsage) && current.modelUsage.length) {
      current.modelUsage.forEach((entry) => {
        const provider = norm(entry?.provider) || norm(session?.modelProvider) || "unknown";
        const model = norm(entry?.model) || norm(session?.model) || "unknown";
        const totals = entry?.totals || {};
        mergeEntry(models, `${provider}/${model}`, {
          count: Number(entry?.count || 0),
          tokens: Number(totals.totalTokens || 0),
          cost: Number(totals.totalCost || 0),
        });
        mergeEntry(providers, provider, {
          count: Number(entry?.count || 0),
          tokens: Number(totals.totalTokens || 0),
          cost: Number(totals.totalCost || 0),
        });
      });
    } else {
      const model = norm(session?.model || session?.modelOverride);
      const provider = norm(session?.modelProvider || session?.providerOverride || (model.includes("/") ? model.split("/")[0] : ""));
      if (model) {
        mergeEntry(models, model, {
          count: Number(messageCounts.assistant || messageCounts.total || 0),
          tokens: Number(current.totalTokens || 0),
          cost: Number(current.totalCost || 0),
        });
      }
      if (provider) {
        mergeEntry(providers, provider, {
          count: Number(messageCounts.assistant || messageCounts.total || 0),
          tokens: Number(current.totalTokens || 0),
          cost: Number(current.totalCost || 0),
        });
      }
    }
  });

  const byWeight = (entries) =>
    [...entries.values()].sort((a, b) => {
      const byTokens = Number(b.tokens || 0) - Number(a.tokens || 0);
      if (byTokens !== 0) {
        return byTokens;
      }
      return Number(b.count || 0) - Number(a.count || 0);
    });

  return {
    ...usage,
    models: byWeight(models),
    providers: byWeight(providers),
    tools: byWeight(tools),
    errorRate: usage.messages ? usage.errors / usage.messages : 0,
  };
}

function humanizeOperation(item) {
  const target = item.files?.length ? basename(item.files[0]) : "";
  const detail = norm(item.detail).replace(/^with\s+(run|from|file|target|pattern)\s+/i, "");
  if (item.title === "Read") {
    return target ? `我刚刚读取了 ${target}，在确认当前内容和上下文。` : "我刚刚读取了一段文件或输出内容。";
  }
  if (item.title === "Edit") {
    return target ? `我正在调整 ${target} 里的配置或代码。` : "我刚刚修改了一处配置或脚本。";
  }
  if (item.title === "Write") {
    return target ? `我写入了 ${target}，把新的内容落到了本地。` : "我刚刚写入了一份新内容。";
  }
  if (item.title === "Exec") {
    return detail ? `我执行了一条命令：${shortenText(detail, 96)}` : "我运行了一条终端命令。";
  }
  if (item.title === "Search") {
    return detail ? `我检索了目标内容：${shortenText(detail, 96)}` : "我刚刚做了一次搜索。";
  }
  if (item.title === "Fetch") {
    return detail ? `我请求了一个外部资源：${shortenText(detail, 96)}` : "我拉取了一次外部数据。";
  }
  return detail ? `我刚刚完成了一步操作：${shortenText(detail, 96)}` : "我刚刚完成了一步操作。";
}

function operationTag(status) {
  if (status === "failed") {
    return "error";
  }
  if (status === "running") {
    return "processing";
  }
  return "complete";
}

function renderOpsLogCards(selectedAgent) {
  const selected = agentMeta(selectedAgent);
  const items = commitItemsForCurrentSession();
  if (!items.length) {
    return emptyState(`${selected.name} 当前会话还没有即时操作日志`, "等这个 agent 读文件、执行命令或修改脚本后，这里会自动转成更容易读懂的操作反馈。");
  }
  return `<div class="app-ops-list">${items.map((item) => {
    const files = item.files?.length
      ? `<div class="app-ops-files">${item.files.map((file) => `<span class="app-activity-chip" title="${esc(file)}">${esc(basename(file))}</span>`).join("")}</div>`
      : "";
    const preview = item.preview ? `<div class="app-ops-preview">${esc(item.preview)}</div>` : "";
    return `<div class="app-ops-row"><div class="app-log-entry"><span class="app-log-time">${esc(formatTime(item.timestamp || Date.now()))}</span><span class="app-log-tag ${esc(operationTag(item.status))}">${esc(item.title)}</span><span class="app-log-content">${esc(humanizeOperation(item))}</span></div>${files}${preview}</div>`;
  }).join("")}</div>`;
}

function usageMetricCard(label, value, sub = "", tone = "") {
  return `<div class="app-usage-stat ${esc(tone)}"><div class="app-usage-stat-label">${esc(label)}</div><div class="app-usage-stat-value">${esc(value)}</div><div class="app-usage-stat-sub">${esc(sub || " ")}</div></div>`;
}

function renderUsageListBlock(title, items, formatter) {
  if (!items.length) {
    return `<div class="app-usage-block"><div class="app-usage-block-title">${esc(title)}</div><div class="app-empty">当前没有可汇总的数据</div></div>`;
  }
  return `<div class="app-usage-block"><div class="app-usage-block-title">${esc(title)}</div><div class="app-usage-list">${items.map((item) => formatter(item)).join("")}</div></div>`;
}

function renderUsageCard(selectedAgent) {
  const summary = aggregateUsageForAgent(selectedAgent.id);
  const activeRoute = currentRouteStatus(selectedAgent, state.sessionKey);
  if (!summary.hasUsage) {
    return emptyState("当前还没有 Usage 数据", "先在这个 agent 下产生几次对话或工具调用，网关上报后这里就会出现 token、模型和工具消耗。");
  }
  return `
    <div class="app-usage-grid">
      <div class="app-usage-summary-grid">
        ${usageMetricCard("当前命中", shortModelName(activeRoute.model || primaryModel(selectedAgent) || "未配置"), activeRoute.levelLabel)}
        ${usageMetricCard("请求次数", formatCompactNumber(summary.requests), `${summary.sessions} 个会话`)}
        ${usageMetricCard("消息总量", formatCompactNumber(summary.messages), `${formatCompactNumber(summary.toolResults)} 条工具结果`)}
        ${usageMetricCard("工具调用", formatCompactNumber(summary.toolCalls), `${summary.tools.length} 种工具`)}
        ${usageMetricCard("总 Tokens", formatCompactNumber(summary.tokens), "最近已追踪会话")}
        ${usageMetricCard("错误率", `${(summary.errorRate * 100).toFixed(1)}%`, `${formatCompactNumber(summary.errors)} 条错误`, summary.errorRate > 0.1 ? "warn" : "")}
        ${usageMetricCard("总成本", formatCost(summary.cost), "供应商已上报部分")}
        ${usageMetricCard("剩余额度", "网关未上报", "如后续 API 暴露会自动接入")}
      </div>
      <div class="app-usage-lists">
        ${renderUsageListBlock("Top Models", summary.models.slice(0, 4), (item) => `<div class="app-usage-row"><span class="app-usage-key">${esc(shortModelName(item.key))}</span><span class="app-usage-value">${esc(formatCompactNumber(item.tokens || item.count))}</span></div>`)}
        ${renderUsageListBlock("Top Providers", summary.providers.slice(0, 4), (item) => `<div class="app-usage-row"><span class="app-usage-key">${esc(item.key)}</span><span class="app-usage-value">${esc(formatCompactNumber(item.tokens || item.count))}</span></div>`)}
        ${renderUsageListBlock("Top Tools", summary.tools.slice(0, 6), (item) => `<div class="app-usage-row"><span class="app-usage-key">${esc(item.key)}</span><span class="app-usage-value">${esc(formatCompactNumber(item.count))} 次</span></div>`)}
      </div>
    </div>`;
}

function renderCommitCards() {
  const items = commitItemsForCurrentSession();
  const selected = agentMeta(getAgent(state.selectedAgentId));
  if (!items.length) {
    return emptyState(`${selected.name} 当前会话还没有操作轨迹`, "让这个 agent 执行一次读写、命令或补丁任务后，这里会像 Codex 一样显示步骤。");
  }
  return `<div class="app-activity-list">${items.map((item) => {
    const files = item.files.length
      ? `<div class="app-activity-files">${item.files.map((file) => `<span class="app-activity-chip" title="${esc(file)}">${esc(basename(file))}</span>`).join("")}</div>`
      : "";
    const preview = item.preview ? `<div class="app-activity-preview">${esc(item.preview)}</div>` : "";
    return `<div class="app-activity-card ${esc(item.status)}"><div class="app-activity-top"><div class="app-activity-title">${esc(item.icon)} ${esc(item.title)}</div><div class="app-activity-status ${esc(item.status)}">${esc(toolStatusLabel(item.status))}</div></div><div class="app-activity-detail">${esc(item.detail)}</div>${files}${preview}<div class="app-activity-meta">${esc(formatTime(item.timestamp || Date.now()))}</div></div>`;
  }).join("")}</div>`;
}

function setSession(sessionKey, loadHistory = true) {
  state.sessionKey = normalizeSessionKey(sessionKey) || "agent:main:main";
  state.selectedAgentId = resolveSessionAgentId(state.sessionKey) || state.defaultAgentId || "main";
  state.chatRunId = null;
  state.chatStream = "";
  state.chatMessagesRaw = [];
  state.fallbackLabel = "";
  state.forceChatBottom = true;
  const url = new URL(window.location.href);
  url.searchParams.set("session", state.sessionKey);
  window.history.replaceState({}, "", url);
  saveStockSettings({
    sessionKey: state.sessionKey,
    lastActiveSessionKey: state.sessionKey,
  });
  if (loadHistory) {
    void loadChatHistory();
  } else {
    scheduleRender();
  }
}

function bindEvents() {
  state.app.addEventListener("scroll", (event) => {
    const target = event.target;
    if (target?.matches?.(".app-content")) {
      const contentKey = currentContentScrollKey(target.dataset.scrollTab);
      state.contentScroll[contentKey] = target.scrollTop;
      return;
    }
    if (target?.matches?.("[data-chat-scroll]")) {
      const chatKey = currentChatScrollKey(target.dataset.chatScroll);
      state.chatScroll[chatKey] = {
        top: target.scrollTop,
        pinnedBottom: target.scrollHeight - (target.scrollTop + target.clientHeight) <= 40,
      };
    }
  }, true);

  state.app.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }
    const action = target.dataset.action;
    rememberScrollPosition();
    if (action === "select-agent") {
      const agentId = norm(target.dataset.agentId) || state.defaultAgentId || "main";
      setSession(preferredSessionKeyForAgent(agentId));
    } else if (action === "switch-tab") {
      state.activeTab = norm(target.dataset.tab) || "overview";
      state.pendingScrollTarget = "";
      scheduleRender();
    } else if (action === "jump-section") {
      state.activeTab = "overview";
      state.overviewSection = norm(target.dataset.section) || "as-today";
      state.pendingScrollTarget = state.overviewSection;
      scheduleRender();
    } else if (action === "open-session") {
      setSession(target.dataset.sessionKey);
    } else if (action === "toggle-tools") {
      state.toolsExpanded = !state.toolsExpanded;
      scheduleRender();
    } else if (action === "refresh") {
      void refreshAll();
    } else if (action === "toggle-theme") {
      toggleTheme();
    } else if (action === "retry-connect") {
      connectGateway();
    } else if (action === "abort-run") {
      void abortRun();
    } else if (action === "open-native") {
      const url = new URL(window.location.href);
      url.pathname = `${state.basePath || ""}/stock/index.html`;
      url.searchParams.set("session", state.sessionKey);
      window.open(url.toString(), "_blank", "noopener,noreferrer");
    } else if (action === "clear-token") {
      state.gatewayToken = "";
      state.gatewayTokenDraft = "";
      persistGatewayToken("");
      connectGateway();
    }
  });

  state.app.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches("[data-field='compose']")) {
      state.chatDraft = target.value;
      setComposeHeight(target.offsetHeight);
    } else if (target.matches("[data-field='token']")) {
      state.gatewayTokenDraft = target.value;
    }
  });

  state.app.addEventListener("pointerup", (event) => {
    const target = event.target;
    if (target?.matches?.("[data-field='compose']")) {
      setComposeHeight(target.offsetHeight);
    }
  });

  state.app.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.matches("[data-form='compose']")) {
      void sendChat();
    } else if (form.matches("[data-form='auth']")) {
      state.gatewayToken = norm(state.gatewayTokenDraft);
      persistGatewayToken(state.gatewayToken);
      connectGateway();
    }
  });

  state.app.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target.matches("[data-field='compose']") && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void sendChat();
    }
  });
}

function getAgent(agentId) {
  return state.agents.find((agent) => agent.id === agentId) || null;
}

function getAgentHealth(agentId) {
  return Array.isArray(state.health?.agents)
    ? state.health.agents.find((agent) => agent.agentId === agentId) || null
    : null;
}

function healthRecentSessions(agentId = "") {
  const list = [];
  const seen = new Set();
  for (const agent of state.health?.agents || []) {
    if (agentId && agent.agentId !== agentId) {
      continue;
    }
    for (const entry of agent?.sessions?.recent || []) {
      const row = normalizeSessionRow({ ...entry, agentId: agent.agentId });
      if (row.key && !seen.has(row.key)) {
        seen.add(row.key);
        list.push(row);
      }
    }
  }
  return list.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function recentSessions(agentId = "") {
  const rows = state.sessions.length ? state.sessions : healthRecentSessions();
  return rows
    .filter((entry) => (agentId ? resolveSessionAgentId(entry) === agentId : true))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function sessionStatsForAgent(agentId) {
  const rows = recentSessions(agentId);
  const health = getAgentHealth(agentId);
  const age = rows[0]?.age;
  return {
    count: rows.length || Number(health?.sessions?.count) || 0,
    age:
      Number.isFinite(age) && age >= 0
        ? age
        : Number(health?.sessions?.recent?.[0]?.age),
  };
}

function preferredSessionKeyForAgent(agentId) {
  return recentSessions(agentId)[0]?.key || `agent:${agentId}:main`;
}

function getStatus(agentId) {
  const stats = sessionStatsForAgent(agentId);
  const count = Number(stats.count) || 0;
  const age = Number(stats.age);
  if (count === 0) {
    return ["待命", "is-idle"];
  }
  if (Number.isFinite(age) && age <= 15 * 60 * 1000) {
    return ["在线", "is-online"];
  }
  return ["忙碌", "is-warm"];
}

const AGENT_UI_PRESETS = {
  main: {
    color: "#FF6B35",
    caps: ["OpenClaw 配置排错", "本地 AI 管理", "工作流设计", "资料整理"],
  },
  work: {
    color: "#4ECDC4",
    caps: ["Shell 命令执行", "文件读写操作", "代码脚本整理", "系统运维"],
  },
  translation: {
    color: "#A78BFA",
    caps: ["中英越翻译", "专业文档润色", "口语化表达", "翻译适配"],
  },
  lifestyle: {
    color: "#12d8a4",
    caps: ["家庭财务整理", "日程安排", "生活提醒", "消费记录"],
  },
};

const COLOR_POOL = ["#FF6B35", "#4ECDC4", "#A78BFA", "#3B82F6", "#22C55E", "#EAB308"];

function colorFromId(value) {
  const text = norm(value) || "agent";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return COLOR_POOL[hash % COLOR_POOL.length];
}

function configuredAgentEntry(agentOrId) {
  const agentId =
    typeof agentOrId === "string" ? norm(agentOrId) : norm(agentOrId?.id) || norm(agentOrId?.agentId);
  if (!agentId) {
    return null;
  }
  const list = configObject()?.agents?.list;
  if (!Array.isArray(list)) {
    return null;
  }
  return list.find((item) => norm(item?.id) === agentId) || null;
}

function defaultAgentModelConfig() {
  return configObject()?.agents?.defaults?.model || null;
}

function effectiveModelConfig(agent) {
  return configuredAgentEntry(agent)?.model || agent?.model || defaultAgentModelConfig();
}

function primaryModel(agent) {
  const model = effectiveModelConfig(agent);
  if (typeof model === "string") {
    return norm(model);
  }
  return norm(model?.primary || model?.model || model?.id || model?.value);
}

function fallbackModels(agent) {
  const model = effectiveModelConfig(agent);
  return Array.isArray(model?.fallbacks) ? model.fallbacks.map(norm).filter(Boolean) : [];
}

function configuredRoute(agent) {
  return [primaryModel(agent), ...fallbackModels(agent)].filter(Boolean);
}

function routeIndexForModel(route, model) {
  const normalizedModel = norm(model);
  if (!normalizedModel) {
    return -1;
  }
  const exactMatch = route.findIndex((item) => norm(item) === normalizedModel);
  if (exactMatch >= 0) {
    return exactMatch;
  }
  const normalizedTail = normalizedModel.split("/").filter(Boolean);
  const tailMatch = route.findIndex((item) => {
    const itemParts = norm(item).split("/").filter(Boolean);
    if (!itemParts.length || itemParts.length < normalizedTail.length) {
      return false;
    }
    return itemParts.slice(-normalizedTail.length).join("/") === normalizedTail.join("/");
  });
  if (tailMatch >= 0) {
    return tailMatch;
  }
  const finalSegment = normalizedTail[normalizedTail.length - 1];
  return route.findIndex((item) => {
    const text = norm(item);
    return text === finalSegment || text.endsWith(`/${finalSegment}`);
  });
}

function routeLevelLabel(index) {
  if (!Number.isFinite(index) || index < 0) {
    return "动态命中";
  }
  return index === 0 ? "主链" : `回退 #${index}`;
}

function currentRouteStatus(agent, sessionKey = "") {
  const route = configuredRoute(agent);
  const agentId =
    typeof agent === "string" ? norm(agent) : norm(agent?.id) || norm(agent?.agentId);
  const entry =
    latestRuntimeRouteForSession(sessionKey) ||
    latestRuntimeRouteForAgent(agentId);
  const model = norm(entry?.model) || route[0] || "";
  if (!model) {
    return {
      model: "",
      index: -1,
      isFallback: false,
      levelLabel: "未配置",
      badgeLabel: "未配置",
      detailLabel: "当前命中 未配置",
      updatedAt: 0,
      source: "config",
    };
  }
  const routeIndex = routeIndexForModel(route, model);
  const levelLabel = routeLevelLabel(routeIndex >= 0 ? routeIndex : -1);
  return {
    model,
    index: routeIndex,
    isFallback: routeIndex > 0,
    levelLabel,
    badgeLabel: `${levelLabel} · ${shortModelName(model)}`,
    detailLabel: `当前命中 ${levelLabel} · ${model}`,
    updatedAt: Number(entry?.updatedAt) || 0,
    source: norm(entry?.source) || (entry ? "runtime" : "config"),
  };
}

function routeSummary(agent) {
  const primary = primaryModel(agent);
  const fallbacks = fallbackModels(agent);
  if (!primary) {
    return "未配置主模型";
  }
  if (!fallbacks.length) {
    return `主链 ${primary}`;
  }
  return `主链 ${[primary, ...fallbacks].join(" -> ")}`;
}

function shortModelName(value) {
  const text = norm(value);
  if (!text) {
    return "未配置";
  }
  if (text.length <= 32) {
    return text;
  }
  const parts = text.split("/");
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[parts.length - 1]}`;
  }
  return `${text.slice(0, 29)}...`;
}

function compactSessionKey(value) {
  const text = norm(value);
  if (!text || text.length <= 34) {
    return text || "main";
  }
  return `${text.slice(0, 16)}...${text.slice(-12)}`;
}

function configuredAgentSkills(agentId) {
  const list = configObject()?.agents?.list;
  if (!Array.isArray(list)) {
    return [];
  }
  const entry = list.find((item) => norm(item?.id) === agentId);
  return Array.isArray(entry?.skills) ? entry.skills.map(norm).filter(Boolean) : [];
}

function globalSkills() {
  if (Array.isArray(state.skillsReport?.skills) && state.skillsReport.skills.length) {
    return state.skillsReport.skills;
  }
  const entries = configObject()?.skills?.entries;
  if (!entries || typeof entries !== "object") {
    return [];
  }
  return Object.entries(entries).map(([name, info]) => ({
    name,
    description: "Configured in openclaw.json",
    source: "openclaw-config",
    emoji: "🧩",
    eligible: true,
    disabled: info?.enabled === false,
    missing: { bins: [], env: [], config: [], os: [] },
  }));
}

function agentMeta(agent) {
  const record =
    agent ||
    ({
      id: state.selectedAgentId,
      identity: { name: state.selectedAgentId, theme: "等待配置", emoji: "🤖" },
    });
  const identity = record.identity || {};
  const preset = AGENT_UI_PRESETS[record.id] || {};
  const role = norm(identity.theme) || "OpenClaw Agent";
  const configuredSkills = configuredAgentSkills(record.id);
  const caps =
    configuredSkills.length
      ? configuredSkills
      : preset.caps?.length
      ? preset.caps
      : [role, primaryModel(record) ? shortModelName(primaryModel(record)) : "动态接入", "自动扩展"];
  return {
    id: norm(record.id) || norm(identity.name) || "agent",
    name: norm(identity.name) || norm(record.id) || "Agent",
    avatar: norm(identity.emoji) || "🤖",
    role,
    color: preset.color || colorFromId(record.id || identity.name || "agent"),
    caps: caps.filter(Boolean).slice(0, 4),
  };
}

function statusDotClass(statusClass) {
  if (statusClass === "is-online") {
    return "on";
  }
  if (statusClass === "is-warm") {
    return "warm";
  }
  return "off";
}

function statusButtonClass(statusClass) {
  if (statusClass === "is-online") {
    return "online";
  }
  if (statusClass === "is-warm") {
    return "busy";
  }
  return "offline";
}

function emptyState(title, detail = "") {
  return `<div class="app-empty">${esc(title)}${detail ? `<div class="app-empty-sub">${esc(detail)}</div>` : ""}</div>`;
}

function renderHeader(selected) {
  const onlineAgents = state.agents.filter((agent) => getStatus(agent.id)[0] === "在线").length;
  const defaultName = agentMeta(getAgent(state.defaultAgentId)).name;
  const headerStatus = state.connected
    ? `Gateway Online · ${state.serverVersion || "OpenClaw"}`
    : state.authRequired
      ? "等待令牌认证"
      : state.connectError || "网关连接中";
  const activeRoute = currentRouteStatus(getAgent(state.selectedAgentId), state.sessionKey);
  const modelBadge = activeRoute.badgeLabel || shortModelName(primaryModel(getAgent(state.selectedAgentId)));
  return `
    <div class="header">
      <h1><span>🦞</span> AI Team 调度中心</h1>
      <div class="header-tabs" id="tabBar">
        <button type="button" class="tab-btn${state.activeTab === "overview" ? " active" : ""}" data-action="switch-tab" data-tab="overview">📊 总览面板</button>
        <button type="button" class="tab-btn${state.activeTab === "monitor" ? " active" : ""}" data-action="switch-tab" data-tab="monitor">📡 实时监控</button>
        <button type="button" class="tab-btn${state.activeTab === "stats" ? " active" : ""}" data-action="switch-tab" data-tab="stats">📈 数据统计</button>
        <button type="button" class="tab-btn${state.activeTab === "memory" ? " active" : ""}" data-action="switch-tab" data-tab="memory">🧠 每日记忆</button>
      </div>
      <div class="header-right">
        <div class="stats-bar">
          <span class="stat-badge green">${esc(`${onlineAgents}/${state.agents.length || 0} 在线`)}</span>
          <span class="stat-badge blue">${esc(`默认 ${defaultName}`)}</span>
          <span class="stat-badge yellow" title="${esc(modelBadge)}">${esc(modelBadge)}</span>
        </div>
        <span class="live-dot${state.connected ? "" : " is-off"}"></span>
        <button type="button" class="layout-btn" data-action="open-native" title="打开原生控制台">⌘</button>
        <button type="button" class="theme-btn" data-action="refresh" title="刷新数据">↻</button>
        <button type="button" class="theme-btn" data-action="toggle-theme" title="切换主题">${state.theme === "light" ? "🌙" : "☀️"}</button>
        <div class="refresh-info">${esc(headerStatus)}</div>
      </div>
    </div>`;
}

function renderSidebar() {
  const navItems = [
    ["as-today", "📊", "总览"],
    ["as-tasks", "📋", "任务"],
    ["as-commits", "📦", "提交"],
    ["as-cron", "⏰", "定时任务"],
    ["as-tools", "🔌", "工具"],
    ["as-skills", "🧠", "技能"],
  ];
  return `
    <div class="app-sidebar">
      <div class="app-sidebar-section">
        <div class="app-sidebar-label">Bots</div>
        ${state.agents.map((agent) => {
          const meta = agentMeta(agent);
          const [, statusClass] = getStatus(agent.id);
          return `<button type="button" class="app-sidebar-item${agent.id === state.selectedAgentId ? " active" : ""}" data-action="select-agent" data-agent-id="${esc(agent.id)}"><span class="si-icon">${esc(meta.avatar)}</span><span class="si-name">${esc(meta.name)}</span><span class="si-dot ${statusDotClass(statusClass)}"></span></button>`;
        }).join("") || '<div class="app-sidebar-empty">暂无 agent</div>'}
      </div>
      <div class="app-sidebar-divider"></div>
      <div class="app-sidebar-section">
        ${navItems.map(([section, icon, label]) => `<button type="button" class="app-sidebar-item${state.activeTab === "overview" && state.overviewSection === section ? " active" : ""}" data-action="jump-section" data-section="${section}"><span class="si-icon">${icon}</span><span class="si-name">${label}</span></button>`).join("")}
      </div>
    </div>`;
}

function renderAuthBanner() {
  if (state.connected && !state.authRequired && !state.connectError) {
    return "";
  }
  const note = state.authRequired
    ? state.connectError || "当前网关启用了 token auth，请输入一次 token 完成连接。"
    : state.connectError || "首次打开这个 Dashboard 时，输入一次 gateway token 即可复用设备凭证。";
  return `
    <div class="auth-banner">
      <div class="auth-copy">
        <strong>网关授权</strong>
        <span>${esc(note)}</span>
      </div>
      <form data-form="auth" class="auth-form">
        <input data-field="token" type="password" placeholder="输入 OpenClaw gateway token" value="${esc(state.gatewayTokenDraft)}" />
        <div class="auth-form-actions">
          ${state.gatewayToken ? '<button type="button" class="ghost-btn" data-action="clear-token">清空</button>' : ""}
          <button type="submit" class="primary-btn">保存并连接</button>
        </div>
      </form>
    </div>`;
}

function renderAgentRow(agent) {
  const meta = agentMeta(agent);
  const [statusLabel, statusClass] = getStatus(agent.id);
  const stats = sessionStatsForAgent(agent.id);
  const recentAge = formatAge(stats.age);
  const fallbackCount = fallbackModels(agent).length;
  const activeRoute = currentRouteStatus(agent, preferredSessionKeyForAgent(agent.id));
  return `
    <button type="button" class="app-listing-row${agent.id === state.selectedAgentId ? " is-selected" : ""}" data-action="select-agent" data-agent-id="${esc(agent.id)}">
      <div class="app-listing-icon" style="background:${meta.color}18;border:2px solid ${meta.color}">${esc(meta.avatar)}</div>
      <div class="app-listing-info">
        <div class="app-listing-name">${esc(meta.name)}</div>
        <div class="app-listing-role">${esc(meta.role)}</div>
        <div class="app-listing-model">主模型 · ${esc(shortModelName(primaryModel(agent)))}</div>
        <div class="app-listing-caps">${meta.caps.map((cap) => `<span class="cap">${esc(cap)}</span>`).join("")}</div>
      </div>
      <div class="app-listing-right">
        <span class="app-listing-btn ${statusButtonClass(statusClass)}">${esc(statusLabel)}</span>
        ${agent.id === state.defaultAgentId ? '<span class="listing-flag">DEFAULT</span>' : ""}
        <div class="app-listing-stats">
          <span>💬 ${esc(stats.count)}</span>
          <span>🛟 ${esc(fallbackCount)}</span>
          <span title="${esc(activeRoute.detailLabel)}">🎯 ${esc(activeRoute.levelLabel)}</span>
          <span>🕒 ${esc(recentAge)}</span>
        </div>
      </div>
    </button>`;
}

function renderSessionRows(entries) {
  if (!entries.length) {
    return emptyState("暂无任务", "当前网关还没有可展示的近期会话。");
  }
  return entries
    .map((entry, index) => {
      const meta = agentMeta(getAgent(resolveSessionAgentId(entry)));
      const isFresh = Number(entry.age) <= 15 * 60 * 1000;
      return `<button type="button" class="app-task-row${entry.key === state.sessionKey ? " is-current" : ""}" data-action="open-session" data-session-key="${esc(entry.key)}"><span class="app-task-num">#${index + 1}</span><span class="app-task-title">${esc(meta.name)} · ${esc(sessionDisplayLabel(entry))}</span><span class="app-task-badge ${isFresh ? "in-progress" : "done"}">${isFresh ? "活跃" : "最近"}</span><span class="app-task-target">${esc(meta.avatar)}</span><span class="app-task-time">${esc(formatAge(entry.age))}</span></button>`;
    })
    .join("");
}

function renderHeartbeatRows() {
  if (!state.agents.length) {
    return emptyState("暂无定时任务");
  }
  return state.agents
    .map((agent) => {
      const meta = agentMeta(agent);
      const health = getAgentHealth(agent.id);
      const stats = sessionStatsForAgent(agent.id);
      const enabled = Boolean(health?.heartbeat?.enabled);
      const every = norm(health?.heartbeat?.every) || "开启";
      return `<div class="app-cron-row"><span class="app-cron-dot ${enabled ? "on" : "off"}"></span><div class="app-cron-info"><div class="app-cron-name">${esc(meta.avatar)} ${esc(meta.name)}</div><div class="app-cron-desc">${enabled ? `Heartbeat ${every}` : "未启用 heartbeat"}</div></div><div class="app-cron-right"><span class="app-cron-countdown${enabled ? "" : " paused"}">${enabled ? esc(every) : "已暂停"}</span><div class="app-cron-last">最近: ${esc(formatAge(stats.age))}</div></div></div>`;
    })
    .join("");
}

function renderToolCards() {
  const skills = globalSkills().filter((skill) => skill.eligible !== false && !skill.disabled);
  if (!skills.length) {
    return emptyState("暂无工具", "当前还没有可用的 OpenClaw skills。");
  }
  const collapsedCount = 12;
  const expandable = skills.length > collapsedCount;
  const expanded = state.toolsExpanded && expandable;
  const visible = expanded ? skills : skills.slice(0, collapsedCount);
  const more = Math.max(0, skills.length - collapsedCount);
  const cards = visible.map((skill) => {
    const badge = norm(skill?.source) || "openclaw";
    return `<div class="app-tool-card"><div class="app-tool-icon">${esc(norm(skill?.emoji) || "🧩")}</div><div class="app-tool-name">${esc(skill?.name || "skill")}</div><div class="app-tool-ver">${esc(badge)}</div></div>`;
  });
  if (expandable) {
    cards.push(
      `<button type="button" class="app-tool-card app-tool-card-toggle" data-action="toggle-tools" title="${esc(expanded ? "收起 Skills" : "展开全部 Skills")}"><div class="app-tool-icon">${expanded ? "➖" : "➕"}</div><div class="app-tool-name">${expanded ? "收起 Skills" : "更多 Skills"}</div><div class="app-tool-ver">${expanded ? `当前显示 ${esc(skills.length)} 项` : `还有 ${esc(more)} 项`}</div></button>`,
    );
  }
  return `<div class="app-tools-grid">${cards.join("")}</div>`;
}

function renderSkillCards() {
  const skills = state.agents.flatMap((agent) => {
    const meta = agentMeta(agent);
    return meta.caps.map((cap) => ({ cap, meta }));
  });
  if (!skills.length) {
    return emptyState("暂无技能");
  }
  return `<div class="app-skills-grid">${skills.map(({ cap, meta }) => `<div class="app-skill-card"><div class="app-skill-icon">${esc(meta.avatar)}</div><div class="app-skill-info"><div class="app-skill-name">${esc(cap)}</div><div class="app-skill-desc">归属 ${esc(meta.name)}</div></div></div>`).join("")}</div>`;
}

function renderStatusCards() {
  const recents = recentSessions();
  const totalSessions =
    state.sessionsCount ||
    state.sessions.length ||
    (state.health?.agents || []).reduce((sum, agent) => sum + (Number(agent?.sessions?.count) || 0), 0);
  const onlineAgents = state.agents.filter((agent) => getStatus(agent.id)[0] === "在线").length;
  const channels = Object.keys(state.health?.channels || {});
  return `
    <div class="app-status-grid" id="am-status">
      <div class="app-status-card ok"><div class="as-label">BOTS</div><div class="as-value">${esc(state.agents.length)}</div><div class="as-sub">${esc(`${onlineAgents} 在线`)}</div></div>
      <div class="app-status-card info"><div class="as-label">SESSIONS</div><div class="as-value">${esc(totalSessions)}</div><div class="as-sub">${esc(`${recents.length} 条近期记录`)}</div></div>
      <div class="app-status-card warn"><div class="as-label">CHANNELS</div><div class="as-value">${esc(channels.length)}</div><div class="as-sub">${esc(channels.join(" / ") || "未配置")}</div></div>
      <div class="app-status-card ${state.connected ? "ok" : "err"}"><div class="as-label">STATUS</div><div class="as-value">${esc(state.connected ? "Live" : "Auth")}</div><div class="as-sub">${esc(state.lastError || state.connectError || "同步中")}</div></div>
    </div>`;
}

function renderChatMessage(message, selectedMeta) {
  const role = norm(message?.role).toLowerCase() || "assistant";
  const text =
    extractText(message) ||
    norm(message?.errorMessage) ||
    JSON.stringify(message?.content || message || {}, null, 2);
  const time = formatTime(message?.timestamp);
  if (role === "user") {
    return `<div class="app-chat-bubble user"><div class="app-chat-sender">👤 你 <span class="app-chat-time">${esc(time)}</span></div><div>${esc(text)}</div></div>`;
  }
  if (role.includes("tool")) {
    return `<div class="app-chat-bubble tool"><div class="app-chat-sender">🔧 工具结果 <span class="app-chat-time">${esc(time)}</span></div><div>${esc(text)}</div></div>`;
  }
  return `<div class="app-chat-bubble assistant"><div class="app-chat-sender">${esc(selectedMeta.avatar)} ${esc(selectedMeta.name)} <span class="app-chat-time">${esc(time)}</span></div><div>${esc(text)}</div></div>`;
}

function renderMonitorLogs(selectedAgent) {
  const activeRoute = currentRouteStatus(selectedAgent, state.sessionKey);
  const entries = [
    {
      time: Date.now(),
      type: state.connected ? "complete" : state.authRequired ? "warn" : "incoming",
      content: state.connected ? `Gateway 已连接 ${state.serverVersion || ""}` : state.connectError || "等待连接",
    },
    {
      time: Date.now(),
      type: "processing",
      content: `当前会话 ${state.sessionKey}`,
    },
    {
      time: Date.now(),
      type: activeRoute.isFallback ? "warn" : "stream_done",
      content: activeRoute.detailLabel,
    },
  ];
  if (state.fallbackLabel) {
    entries.push({ time: Date.now(), type: "warn", content: state.fallbackLabel });
  }
  if (state.lastError) {
    entries.push({ time: Date.now(), type: "error", content: state.lastError });
  }
  return `<div class="app-log-list">${entries.map((entry) => `<div class="app-log-entry"><span class="app-log-time">${esc(formatTime(entry.time))}</span><span class="app-log-tag ${entry.type}">${esc(entry.type)}</span><span class="app-log-content">${esc(entry.content)}</span></div>`).join("")}</div>`;
}

function renderFleetCards() {
  if (!state.agents.length) {
    return emptyState("暂无 bot");
  }
  return `<div class="app-fleet-grid">${state.agents.map((agent) => {
    const meta = agentMeta(agent);
    const [statusLabel, statusClass] = getStatus(agent.id);
    const stats = sessionStatsForAgent(agent.id);
    return `<button type="button" class="app-fleet-card${agent.id === state.selectedAgentId ? " is-selected" : ""}" data-action="select-agent" data-agent-id="${esc(agent.id)}"><div class="app-fleet-top"><div class="app-fleet-avatar" style="background:${meta.color}18;border:2px solid ${meta.color}">${esc(meta.avatar)}</div><div class="app-fleet-copy"><div class="app-fleet-name">${esc(meta.name)}</div><div class="app-fleet-role">${esc(meta.role)}</div></div><span class="app-fleet-state ${statusButtonClass(statusClass)}">${esc(statusLabel)}</span></div><div class="app-fleet-stats"><div><strong>${esc(stats.count)}</strong><span>总会话</span></div><div><strong>${esc(fallbackModels(agent).length)}</strong><span>回退</span></div><div><strong>${esc(formatAge(stats.age))}</strong><span>最近活跃</span></div></div></button>`;
  }).join("")}</div>`;
}

function renderStatsTable() {
  if (!state.agents.length) {
    return emptyState("暂无统计数据");
  }
  return `
    <div class="stats-table">
      <div class="stats-row stats-head">
        <div class="stats-cell">Agent</div>
        <div class="stats-cell">状态</div>
        <div class="stats-cell">会话</div>
        <div class="stats-cell">Heartbeat</div>
        <div class="stats-cell">主模型</div>
      <div class="stats-cell">回退数</div>
      </div>
      ${state.agents.map((agent) => {
        const meta = agentMeta(agent);
        const health = getAgentHealth(agent.id);
        const stats = sessionStatsForAgent(agent.id);
        const [statusLabel] = getStatus(agent.id);
        return `<div class="stats-row"><div class="stats-cell stats-agent">${esc(meta.avatar)} ${esc(meta.name)}</div><div class="stats-cell">${esc(statusLabel)}</div><div class="stats-cell">${esc(stats.count)}</div><div class="stats-cell">${esc(health?.heartbeat?.enabled ? norm(health?.heartbeat?.every) || "开启" : "关闭")}</div><div class="stats-cell" title="${esc(primaryModel(agent))}">${esc(shortModelName(primaryModel(agent)))}</div><div class="stats-cell">${esc(fallbackModels(agent).length)}</div></div>`;
      }).join("")}
    </div>`;
}

function renderRouteRows() {
  if (!state.agents.length) {
    return emptyState("暂无模型路由");
  }
  return state.agents.map((agent) => {
    const meta = agentMeta(agent);
    const primary = primaryModel(agent);
    const fallbacks = fallbackModels(agent);
    const activeRoute = currentRouteStatus(agent, preferredSessionKeyForAgent(agent.id));
    const activeAge = activeRoute.updatedAt ? ` · ${formatAge(Date.now() - activeRoute.updatedAt)}` : "";
    return `<div class="app-commit-row"><span class="app-commit-sha">${esc(meta.id)}</span><div class="app-commit-msg"><div>${esc(meta.name)} · ${esc(primary || "未配置主模型")}</div><div class="app-commit-sub">${esc(routeSummary(agent))}</div><div class="app-commit-sub${activeRoute.isFallback ? " warn" : ""}">${esc(`${activeRoute.detailLabel}${activeAge}`)}</div></div><span class="app-commit-time">回退 ${esc(fallbacks.length)}</span></div>`;
  }).join("");
}

function renderFooter() {
  return `
    <footer class="app-footer">
      <div class="app-footer-line">
        原项目：
        <a href="https://github.com/fangxingyu123/ai-team-dashboard" target="_blank" rel="noreferrer">fangxingyu123/ai-team-dashboard</a>
      </div>
      <div class="app-footer-line">
        声明：本页面为 OpenClaw 定制整合版，界面风格参考原作者项目，当前实现与交互适配由本地二次改造完成，非原作者官方发行版本。
      </div>
    </footer>`;
}

function renderOverviewTab() {
  const recents = recentSessions().slice(0, 10);
  const onlineAgents = state.agents.filter((agent) => getStatus(agent.id)[0] === "在线").length;
  const defaultName = agentMeta(getAgent(state.defaultAgentId)).name;
  const toolCount = globalSkills().filter((skill) => skill.eligible !== false && !skill.disabled).length;
  const commitItems = commitItemsForCurrentSession();
  return `
    <div class="app-container">
      ${renderSidebar()}
      <div class="app-content" data-scroll-tab="overview">
        ${renderAuthBanner()}
        <div class="app-section-title" id="as-today">Today</div>
        <div class="app-section-sub">${esc(`${onlineAgents}/${state.agents.length || 0} 在线 · ${recents.length} 条近期会话 · 默认 ${defaultName}`)}</div>
        ${state.agents.map(renderAgentRow).join("") || emptyState("暂无 agent", "确认 agents.list 已正常返回。")}
        <div class="app-section-title">详情</div>
        <div class="app-feature-grid">
          <div class="app-feature-card" id="as-tasks">
            <div class="app-feature-head"><h3>📋 全部任务</h3><span class="af-cnt">${esc(recents.length)}</span></div>
            <div class="app-feature-body">${renderSessionRows(recents)}</div>
          </div>
          <div class="app-feature-card" id="as-commits">
            <div class="app-feature-head"><h3>📦 代码提交</h3><span class="af-cnt">${esc(commitItems.length)}</span></div>
            <div class="app-feature-body">${renderCommitCards()}</div>
          </div>
          <div class="app-feature-card" id="as-cron">
            <div class="app-feature-head"><h3>⏰ 定时任务</h3><span class="af-cnt">${esc(state.agents.length)}</span></div>
            <div class="app-feature-body">${renderHeartbeatRows()}</div>
          </div>
          <div class="app-feature-card" id="as-tools">
            <div class="app-feature-head"><h3>🔌 工具</h3><span class="af-cnt">${esc(toolCount)}</span></div>
            <div class="app-feature-body">${renderToolCards()}</div>
          </div>
          <div class="app-feature-card full" id="as-skills">
            <div class="app-feature-head"><h3>🧠 技能</h3><span class="af-cnt">${esc(state.agents.reduce((sum, agent) => sum + agentMeta(agent).caps.length, 0))}</span></div>
            <div class="app-feature-body">${renderSkillCards()}</div>
          </div>
        </div>
        ${renderFooter()}
      </div>
    </div>`;
}

function renderMonitorTab(selectedAgent) {
  const selected = agentMeta(selectedAgent);
  const activeRoute = currentRouteStatus(selectedAgent, state.sessionKey);
  const monitorEventCount = state.lastError || state.fallbackLabel ? 4 : 3;
  const chatBody =
    state.chatLoading && !state.chatMessages.length
      ? '<div class="app-empty loading">正在拉取聊天记录</div>'
      : state.chatMessages.map((message) => renderChatMessage(message, selected)).join("") ||
        emptyState("这个 session 还没有消息", "直接开始提问即可。");
  const streamBlock = state.chatStream
    ? `<div class="app-chat-bubble assistant streaming"><div class="app-chat-sender">${esc(selected.avatar)} ${esc(selected.name)} <span class="app-chat-time">Streaming</span></div><div>${esc(state.chatStream)}</div></div>`
    : "";
  return `
    <div class="app-container">
      ${renderSidebar()}
      <div class="app-content" data-scroll-tab="monitor">
        ${renderAuthBanner()}
        <div class="app-section-title">实时监控</div>
        <div class="app-section-sub">${esc(`当前会话 ${state.sessionKey}`)}</div>
        ${renderStatusCards()}
        <div class="app-listing-row is-static">
          <div class="app-listing-icon" style="background:${selected.color}18;border:2px solid ${selected.color}">${esc(selected.avatar)}</div>
          <div class="app-listing-info">
            <div class="app-listing-name">${esc(selected.name)}</div>
            <div class="app-listing-role">${esc(selected.role)}</div>
            <div class="app-listing-model">主模型 · ${esc(shortModelName(primaryModel(selectedAgent)))}</div>
            <div class="app-listing-caps"><span class="cap">Session ${esc(compactSessionKey(state.sessionKey))}</span><span class="cap">Fallback ${esc(fallbackModels(selectedAgent).length)}</span><span class="cap${activeRoute.isFallback ? " warn" : ""}" title="${esc(activeRoute.detailLabel)}">当前 ${esc(`${activeRoute.levelLabel} · ${shortModelName(activeRoute.model || "未配置")}`)}</span>${state.fallbackLabel ? `<span class="cap warn">${esc(state.fallbackLabel)}</span>` : ""}</div>
          </div>
        </div>
        <div class="app-feature-grid">
          <div class="app-feature-card full app-chat-panel" id="am-chat">
            <div class="app-feature-head"><h3>🧠 思考 & 对话</h3><span class="af-cnt">${esc(state.chatMessages.length + (state.chatStream ? 1 : 0))} 条</span></div>
            <div class="app-feature-body">
              <div class="app-chat-body" data-chat-scroll="monitor">${chatBody}${streamBlock}</div>
              <form data-form="compose" class="app-chat-compose">
                <textarea data-field="compose" style="height:${esc(state.composeHeight)}px" placeholder="在这里继续和当前 agent 对话，Ctrl+Enter 发送。">${esc(state.chatDraft)}</textarea>
                <div class="app-chat-actions">
                  <span class="compose-tip">Ctrl+Enter 发送，左侧 bots 切换后会共享当前会话逻辑。</span>
                  <div class="compose-buttons">
                    ${state.chatRunId ? '<button type="button" class="ghost-btn" data-action="abort-run">中止本轮</button>' : ""}
                    <button type="submit" class="primary-btn"${!state.connected || state.chatSending ? " disabled" : ""}>发送</button>
                  </div>
                </div>
              </form>
            </div>
          </div>
          <div class="app-feature-card" id="am-timeline">
            <div class="app-feature-head"><h3>📋 最近会话</h3><span class="af-cnt">${esc(recentSessions().length)}</span></div>
            <div class="app-feature-body">${renderSessionRows(recentSessions().slice(0, 8))}</div>
          </div>
          <div class="app-feature-card" id="am-logs">
            <div class="app-feature-head"><h3>📡 网关事件</h3><span class="af-cnt">${esc(monitorEventCount)}</span></div>
            <div class="app-feature-body">${renderMonitorLogs(selectedAgent)}</div>
          </div>
          <div class="app-feature-card full">
            <div class="app-feature-head"><h3>🤖 Bots Fleet</h3><span class="af-cnt">${esc(state.agents.length)}</span></div>
            <div class="app-feature-body">${renderFleetCards()}</div>
          </div>
        </div>
        ${renderFooter()}
      </div>
    </div>`;
}

function renderStatsTab() {
  const totalSessions =
    state.sessionsCount ||
    state.sessions.length ||
    (state.health?.agents || []).reduce((sum, agent) => sum + (Number(agent?.sessions?.count) || 0), 0);
  const onlineAgents = state.agents.filter((agent) => getStatus(agent.id)[0] === "在线").length;
  const channels = Object.keys(state.health?.channels || {});
  return `
    <div class="app-container">
      ${renderSidebar()}
      <div class="app-content" data-scroll-tab="stats">
        ${renderAuthBanner()}
        <div class="app-section-title">数据统计</div>
        <div class="app-section-sub">按照当前 OpenClaw 网关返回的 agents.list / health 数据，并结合 config.get 中的模型配置实时汇总。</div>
        <div class="app-status-grid">
          <div class="app-status-card info"><div class="as-label">ONLINE</div><div class="as-value">${esc(onlineAgents)}</div><div class="as-sub">在线 agent</div></div>
          <div class="app-status-card ok"><div class="as-label">TOTAL</div><div class="as-value">${esc(state.agents.length)}</div><div class="as-sub">已注册 bot</div></div>
          <div class="app-status-card warn"><div class="as-label">SESSIONS</div><div class="as-value">${esc(totalSessions)}</div><div class="as-sub">累计会话</div></div>
          <div class="app-status-card info"><div class="as-label">CHANNELS</div><div class="as-value">${esc(channels.length)}</div><div class="as-sub">${esc(channels.join(" / ") || "未配置")}</div></div>
        </div>
        <div class="app-feature-grid">
          <div class="app-feature-card full">
            <div class="app-feature-head"><h3>📈 Agent 指标</h3><span class="af-cnt">${esc(state.agents.length)}</span></div>
            <div class="app-feature-body">${renderStatsTable()}</div>
          </div>
          <div class="app-feature-card full">
            <div class="app-feature-head"><h3>🛟 模型路由</h3><span class="af-cnt">${esc(state.agents.length)}</span></div>
            <div class="app-feature-body">${renderRouteRows()}</div>
          </div>
        </div>
        ${renderFooter()}
      </div>
    </div>`;
}

function renderMemoryTab(selectedAgent) {
  const selected = agentMeta(selectedAgent);
  const activeRoute = currentRouteStatus(selectedAgent, state.sessionKey);
  return `
    <div class="app-container">
      ${renderSidebar()}
      <div class="app-content" data-scroll-tab="memory">
        ${renderAuthBanner()}
        <div class="app-section-title">每日记忆</div>
        <div class="app-section-sub">这里保留当前 agent 的即时操作轨迹、使用情况和近期接力线索，避免和“思考＆对话”重复。</div>
        <div class="app-feature-grid">
          <div class="app-feature-card" id="memory-logs">
            <div class="app-feature-head"><h3>🪵 日志</h3><span class="af-cnt">${esc(commitItemsForCurrentSession().length)}</span></div>
            <div class="app-feature-body">${renderOpsLogCards(selectedAgent)}</div>
          </div>
          <div class="app-feature-card" id="memory-usage">
            <div class="app-feature-head"><h3>📊 使用情况</h3><span class="af-cnt">${esc(usageSessionsForAgent(selectedAgent.id).length)}</span></div>
            <div class="app-feature-body">${renderUsageCard(selectedAgent)}</div>
          </div>
          <div class="app-feature-card">
            <div class="app-feature-head"><h3>📋 近期会话</h3><span class="af-cnt">${esc(recentSessions().length)}</span></div>
            <div class="app-feature-body">${renderSessionRows(recentSessions().slice(0, 10))}</div>
          </div>
          <div class="app-feature-card">
            <div class="app-feature-head"><h3>🗂 系统记忆</h3><span class="af-cnt">5</span></div>
            <div class="app-feature-body">
              <div class="app-log-list">
                <div class="app-log-entry"><span class="app-log-time">默认</span><span class="app-log-tag stream_done">agent</span><span class="app-log-content">${esc(agentMeta(getAgent(state.defaultAgentId)).name)}</span></div>
                <div class="app-log-entry"><span class="app-log-time">当前</span><span class="app-log-tag incoming">agent</span><span class="app-log-content">${esc(selected.name)}</span></div>
                <div class="app-log-entry"><span class="app-log-time">session</span><span class="app-log-tag processing">key</span><span class="app-log-content">${esc(state.sessionKey)}</span></div>
                <div class="app-log-entry"><span class="app-log-time">model</span><span class="app-log-tag ${activeRoute.isFallback ? "warn" : "complete"}">${esc(activeRoute.levelLabel)}</span><span class="app-log-content">${esc(activeRoute.model || primaryModel(selectedAgent) || "未配置")}</span></div>
                <div class="app-log-entry"><span class="app-log-time">note</span><span class="app-log-tag ${state.lastError ? "error" : activeRoute.isFallback ? "warn" : "stream_done"}">${state.lastError ? "异常" : activeRoute.isFallback ? "回退中" : "稳定"}</span><span class="app-log-content">${esc(state.lastError || state.fallbackLabel || activeRoute.detailLabel || "当前会话稳定运行")}</span></div>
              </div>
            </div>
          </div>
        </div>
        ${renderFooter()}
      </div>
    </div>`;
}

function rememberScrollPosition() {
  const content = state.app?.querySelector(".app-content");
  if (content) {
    const contentKey = currentContentScrollKey(content.dataset.scrollTab);
    state.contentScroll[contentKey] = content.scrollTop;
  }
  const scroller = state.app?.querySelector("[data-chat-scroll]");
  if (scroller) {
    const chatKey = currentChatScrollKey(scroller.dataset.chatScroll);
    state.chatScroll[chatKey] = {
      top: scroller.scrollTop,
      pinnedBottom: scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight) <= 40,
    };
  }
}

function restoreScrollPosition() {
  const content = state.app?.querySelector(".app-content");
  if (!content) {
    return;
  }
  if (state.pendingScrollTarget) {
    const target = state.app.querySelector(`#${state.pendingScrollTarget}`);
    state.pendingScrollTarget = "";
    if (target) {
      window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      return;
    }
  }
  content.scrollTop = state.contentScroll[currentContentScrollKey()] || 0;
}

function restoreChatScrollPosition() {
  const scroller = state.app?.querySelector("[data-chat-scroll]");
  if (!scroller) {
    return;
  }
  const entry = state.chatScroll[currentChatScrollKey(scroller.dataset.chatScroll)];
  const applyScroll = () => {
    if (state.forceChatBottom || !entry || entry.pinnedBottom) {
      scroller.scrollTop = scroller.scrollHeight;
    } else {
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = Math.min(entry.top, maxTop);
    }
  };
  applyScroll();
  state.forceChatBottom = false;
  window.requestAnimationFrame(applyScroll);
}

function renderActiveTab(selectedAgent) {
  if (state.activeTab === "monitor") {
    return renderMonitorTab(selectedAgent);
  }
  if (state.activeTab === "stats") {
    return renderStatsTab();
  }
  if (state.activeTab === "memory") {
    return renderMemoryTab(selectedAgent);
  }
  return renderOverviewTab();
}

function render() {
  rememberScrollPosition();
  setTheme(state.theme);
  document.body.classList.add("app-mode");
  const selected =
    getAgent(state.selectedAgentId) ||
    state.agents[0] ||
    { id: state.selectedAgentId, identity: { name: state.selectedAgentId, theme: "等待配置", emoji: "🤖" } };
  const selectedMeta = agentMeta(selected);
  state.app.innerHTML = `${renderHeader(selectedMeta)}<div class="tab-frame">${renderActiveTab(selected)}</div>`;
  document.title = `${selectedMeta.name} · AI Team 调度中心`;
  restoreScrollPosition();
  restoreChatScrollPosition();
}

if (isStockRoute()) {
  void bootStockControlUi();
} else {
  init();
}
