// github-sync.js — Đồng bộ 2 chiều với GitHub Contents API.
// PAT chỉ lưu trong localStorage của trình duyệt, KHÔNG bao giờ ghi vào file/repo/log.

export const TOKEN_KEY = 'hsk-hub-pat';
export const DATA_KEY = 'hsk-hub-data';
export const BACKUP_KEY = 'hsk-hub-backup';
const API_BASE = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 15000;

/** Mã hoá Base64 an toàn Unicode (tiếng Việt + chữ Hán) — KHÔNG dùng btoa trực tiếp. */
export function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Giải mã Base64 -> chuỗi UTF-8. */
export function decodeBase64Utf8(b64) {
  const binary = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function describeStatus(status) {
  switch (status) {
    case 401: return 'Token không hợp lệ hoặc đã hết hạn (401). Hãy tạo PAT mới.';
    case 403: return 'Token thiếu quyền Contents: Read and write hoặc bị giới hạn (403).';
    case 404: return 'Không tìm thấy repo/file (404). Kiểm tra owner/repo/branch.';
    case 409: return 'Xung đột dữ liệu (409). Đã thử lấy sha mới nhất — hãy đồng bộ lại.';
    case 422: return 'Dữ liệu gửi lên không hợp lệ (422).';
    case 429: return 'GitHub giới hạn tần suất (429). Chờ một lát rồi thử lại.';
    default:
      return status >= 500
        ? `GitHub đang lỗi máy chủ (${status}). Thử lại sau.`
        : `Lỗi GitHub (${status}).`;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS, fetchFn = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new GitHubError(0, 'Hết thời gian chờ GitHub (timeout). Kiểm tra mạng rồi thử lại.');
    throw new GitHubError(0, 'Không kết nối được GitHub. Kiểm tra mạng rồi thử lại.');
  } finally {
    clearTimeout(timer);
  }
}

/** Chỉ retry với lỗi mạng/timeout và 5xx, tối đa maxRetries lần, backoff tăng dần. */
async function requestWithRetry(fn, { maxRetries = 2, baseDelayMs = 600 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof GitHubError && (err.status === 0 || err.status >= 500);
      if (!retryable || attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

export function getStoredToken(storage = localStorage) {
  try { return storage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function storeToken(token, storage = localStorage) {
  try {
    if (token) storage.setItem(TOKEN_KEY, token);
    else storage.removeItem(TOKEN_KEY);
  } catch { /* bỏ qua nếu storage bị chặn */ }
}

export class GitHubSync {
  constructor({ owner = 'bohoa96tb', repo = 'hsk-hub', branch = 'main', token = '', fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.token = token;
    this.fetchFn = fetchFn;
    this.timeoutMs = timeoutMs;
    this.sleepFn = sleepFn;
    this.path = 'data/progress.json';
    this.lastKnownSha = undefined; // cập nhật sau mỗi GET/PUT thành công để lần PUT sau khỏi lệch sha
  }

  headers() {
    const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  contentsUrl() {
    return `${API_BASE}/repos/${this.owner}/${this.repo}/contents/${this.path}`;
  }

  /**
   * GET file hiện tại -> { data (object đã parse), sha } hoặc null nếu file chưa có (404 không token).
   * Chống cache tuyệt đối bằng query `&_=<timestamp>` + cache:'no-store'.
   * TUYỆT ĐỐI không thêm header Cache-Control/Pragma (gây lỗi CORS preflight trên trình duyệt).
   */
  async fetchRemote() {
    return requestWithRetry(async () => {
      const res = await fetchWithTimeout(
        `${this.contentsUrl()}?ref=${encodeURIComponent(this.branch)}&_=${Date.now()}`,
        { headers: this.headers(), cache: 'no-store' },
        this.timeoutMs,
        this.fetchFn,
      );
      if (res.status === 404) {
        if (!this.token) return null;
        throw new GitHubError(404, describeStatus(404));
      }
      if (!res.ok) throw new GitHubError(res.status, describeStatus(res.status));
      const json = await res.json();
      this.lastKnownSha = json.sha;
      const text = decodeBase64Utf8(json.content || '');
      return { data: JSON.parse(text), sha: json.sha };
    });
  }

  /** Kiểm tra kết nối: đọc thông tin repo. */
  async testConnection() {
    const res = await fetchWithTimeout(
      `${API_BASE}/repos/${this.owner}/${this.repo}`,
      { headers: this.headers() },
      this.timeoutMs,
      this.fetchFn,
    );
    if (!res.ok) throw new GitHubError(res.status, describeStatus(res.status));
    const info = await res.json();
    return { fullName: info.full_name, private: info.private, defaultBranch: info.default_branch };
  }

  /**
   * Lưu dữ liệu lên GitHub.
   * - Lần PUT đầu dùng lastKnownSha (từ GET/PUT trước) nếu có, chưa có thì GET (không cache) lấy sha.
   * - Gặp 409: chờ 400ms, GET lại sha mới nhất (không cache) và PUT lại, tối đa 2 lần retry.
   * - Sau mỗi PUT thành công: lastKnownSha = content.sha mới trả về.
   */
  async save(data, message = 'chore: sync progress from HSK Hub') {
    const MAX_409_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_409_RETRIES; attempt++) {
      let sha = attempt === 0 ? this.lastKnownSha : undefined;
      if (sha === undefined) {
        try {
          const remote = await this.fetchRemote();
          sha = remote ? remote.sha : undefined;
        } catch (err) {
          if (err instanceof GitHubError && err.status === 404) sha = undefined;
          else throw err;
        }
      }
      const body = {
        message,
        content: encodeBase64Utf8(JSON.stringify(data, null, 2) + '\n'),
        branch: this.branch,
      };
      if (sha) body.sha = sha;
      const res = await fetchWithTimeout(
        this.contentsUrl(),
        { method: 'PUT', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' },
        this.timeoutMs,
        this.fetchFn,
      );
      if (res.status === 409) {
        if (attempt === MAX_409_RETRIES) throw new GitHubError(409, describeStatus(409));
        this.lastKnownSha = undefined; // sha đã cũ — vòng sau bắt buộc GET lại
        await this.sleepFn(400);
        continue;
      }
      if (!res.ok) throw new GitHubError(res.status, describeStatus(res.status));
      const out = await res.json();
      if (out.content?.sha) this.lastKnownSha = out.content.sha;
      return { sha: out.content?.sha, commit: out.commit?.sha };
    }
    throw new GitHubError(409, describeStatus(409));
  }
}

/**
 * Hàng đợi đồng bộ tuần tự + debounce (thuần, không phụ thuộc DOM — dùng được cho test).
 * - schedule(arg): gom các lần gọi liên tiếp trong debounceMs thành 1 lần chạy với arg mới nhất.
 * - Đang chạy (in-flight) mà có schedule mới: đánh dấu pending; chạy xong chỉ chạy thêm đúng 1 lần với arg mới nhất.
 * - flush(): bỏ qua debounce, chạy ngay (hoặc đánh dấu pending nếu đang chạy).
 * - whenIdle(): promise hoàn tất khi không còn timer/in-flight/pending.
 */
export function createSyncQueue(run, { debounceMs = 700 } = {}) {
  let timer = null;
  let inFlight = false;
  let pending = false;
  let latestArg;
  let waiters = [];

  function notifyIdle() {
    if (!inFlight && !pending && !timer && waiters.length) {
      const ws = waiters;
      waiters = [];
      ws.forEach((resolve) => resolve());
    }
  }

  async function runOnce() {
    if (inFlight) { pending = true; return; }
    inFlight = true;
    try {
      do {
        pending = false;
        await run(latestArg);
      } while (pending);
    } finally {
      inFlight = false;
      notifyIdle();
    }
  }

  return {
    schedule(arg) {
      latestArg = arg;
      if (inFlight) { pending = true; return; }
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; runOnce(); }, debounceMs);
    },
    flush(arg) {
      if (arg !== undefined) latestArg = arg;
      clearTimeout(timer);
      timer = null;
      if (inFlight) { pending = true; return; }
      runOnce();
    },
    whenIdle() {
      if (!inFlight && !pending && !timer) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    getState() {
      return { inFlight, pending, scheduled: Boolean(timer) };
    },
  };
}

/** Tải dữ liệu tĩnh từ Pages (không cache cứng) — dùng khi chưa có token. */
export async function fetchStaticData(fetchFn = fetch) {
  const res = await fetchFn(`./data/progress.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Không tải được data/progress.json (${res.status})`);
  return res.json();
}

export function loadLocalData(storage = localStorage) {
  try {
    const raw = storage.getItem(DATA_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveLocalData(data, storage = localStorage) {
  try { storage.setItem(DATA_KEY, JSON.stringify(data)); } catch { /* storage đầy/bị chặn */ }
}

/** Lưu bản sao lưu trước thao tác nguy hiểm (import/ghi đè). */
export function backupLocalData(storage = localStorage) {
  try {
    const raw = storage.getItem(DATA_KEY);
    if (raw) storage.setItem(BACKUP_KEY, raw);
  } catch { /* bỏ qua */ }
}
