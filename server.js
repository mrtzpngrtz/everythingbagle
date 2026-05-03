const express = require('express');
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { rateLimit } = require('express-rate-limit');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts, try again later' } });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many registration attempts, try again later' } });
const twoFaLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many 2FA attempts, try again later' } });
const llmLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, slow down' } });
const mcpLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'MCP rate limit exceeded' } });

// ── Minimal TOTP (RFC 6238) — no external dependency ──────────────────────
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function _b32decode(str) {
  str = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const ch of str) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function _b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) { val = (val << 8) | byte; bits += 8; while (bits >= 5) { out += BASE32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += BASE32[(val << (5 - bits)) & 31];
  return out;
}
function _hotp(secret, counter) {
  const key = _b32decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}
function totpGenerateSecret() { return _b32encode(crypto.randomBytes(20)); }
function totpVerifySync({ token, secret }) {
  const t = Math.floor(Date.now() / 1000 / 30);
  for (let d = -1; d <= 1; d++) { if (_hotp(secret, t + d) === String(token).replace(/\s/g, '')) return true; }
  return false;
}
function totpGenerateURI({ issuer, label, secret }) {
  return `otpauth://totp/${encodeURIComponent(issuer + ':' + label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
// ──────────────────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', '*'],
      connectSrc: ["'self'", 'ws:', 'wss:', '*'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", 'blob:'],
      workerSrc: ["'self'", 'blob:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ═══════════════════════════════════════════════════════
//  DIRECTORIES
// ═══════════════════════════════════════════════════════
['uploads', 'data', 'data/boards'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// ═══════════════════════════════════════════════════════
//  USER DATABASE (JSON file-based)
// ═══════════════════════════════════════════════════════
const USERS_FILE = path.join(__dirname, 'data', '_users.json');
const SETTINGS_FILE = path.join(__dirname, 'data', '_settings.json');
const BOARD_KEYS_FILE = path.join(__dirname, 'data', '_board_keys.json');

function loadBoardKeys() {
  if (!fs.existsSync(BOARD_KEYS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(BOARD_KEYS_FILE, 'utf8')); } catch { return []; }
}
function saveBoardKeys(keys) {
  fs.writeFileSync(BOARD_KEYS_FILE, JSON.stringify(keys, null, 2));
}
function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Ensure board has a stable boardId in meta; generate one if missing
function ensureBoardId(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.meta && data.meta.boardId) return data.meta.boardId;
    const boardId = crypto.randomUUID();
    if (!data.meta) data.meta = {};
    data.meta.boardId = boardId;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return boardId;
  } catch { return null; }
}

// Migrate old keys (board name only) to include boardId
function migrateBoardKeys() {
  const keys = loadBoardKeys();
  let changed = false;
  for (const key of keys) {
    if (!key.boardId && key.board && key.owner) {
      const fp = path.join(__dirname, 'data', 'boards', key.owner, key.board + '.json');
      if (fs.existsSync(fp)) {
        const bid = ensureBoardId(fp);
        if (bid) { key.boardId = bid; changed = true; }
      }
    }
  }
  if (changed) saveBoardKeys(keys);
}

// Auth middleware for name-based MCP routes (legacy)
function requireBoardKey(req, res, next) {
  const raw = req.headers['x-board-key'];
  if (!raw) return res.status(401).json({ error: 'Missing X-Board-Key header' });
  const hash = hashKey(raw);
  const keys = loadBoardKeys();
  const entry = keys.find(k => k.keyHash === hash);
  if (!entry) return res.status(401).json({ error: 'Invalid key' });
  const boardParam = (req.params.board || req.params.name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const ownerParam = (req.params.owner || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (entry.board !== boardParam || (ownerParam && entry.owner !== ownerParam)) {
    return res.status(403).json({ error: 'Key not valid for this board' });
  }
  req.boardKeyEntry = entry;
  entry.lastUsed = new Date().toISOString();
  saveBoardKeys(keys);
  next();
}

// Auth middleware for boardId-based MCP routes (stable across renames)
function requireBoardKeyById(req, res, next) {
  const raw = req.headers['x-board-key'];
  if (!raw) return res.status(401).json({ error: 'Missing X-Board-Key header' });
  const hash = hashKey(raw);
  const keys = loadBoardKeys();
  const entry = keys.find(k => k.keyHash === hash);
  if (!entry) return res.status(401).json({ error: 'Invalid key' });
  const boardIdParam = req.params.boardId;
  const ownerParam = req.params.owner;
  if (entry.boardId !== boardIdParam || entry.owner !== ownerParam) {
    return res.status(403).json({ error: 'Key not valid for this board' });
  }
  // Resolve current filename by scanning for matching boardId
  const boardDir = path.join(__dirname, 'data', 'boards', entry.owner);
  if (!fs.existsSync(boardDir)) return res.status(404).json({ error: 'Board not found' });
  let boardFile = null;
  for (const f of fs.readdirSync(boardDir).filter(f => f.endsWith('.json'))) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(boardDir, f), 'utf8'));
      if (d.meta && d.meta.boardId === boardIdParam) { boardFile = f; break; }
    } catch {}
  }
  if (!boardFile) return res.status(404).json({ error: 'Board not found' });
  req.boardKeyEntry = entry;
  req.boardFilePath = path.join(boardDir, boardFile);
  req.boardName = boardFile.replace('.json', '');
  entry.lastUsed = new Date().toISOString();
  saveBoardKeys(keys);
  next();
}

function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return { registrationEnabled: true };
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return { registrationEnabled: true }; }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function findUser(username) {
  return loadUsers().find(u => u.username === username.toLowerCase());
}

function findUserById(id) {
  return loadUsers().find(u => u.id === id);
}

// Create default admin if no users exist
function ensureDefaultAdmin() {
  const users = loadUsers();
  if (users.length === 0) {
    const hash = bcrypt.hashSync('admin', 10);
    users.push({
      id: 'user_admin',
      username: 'admin',
      displayName: 'Admin',
      passwordHash: hash,
      role: 'admin',
      created: new Date().toISOString(),
      lastLogin: null,
    });
    saveUsers(users);
    console.log('Default admin created — admin / admin');
  }
}

// Migrate old boards (from data/*.json to data/boards/admin/)
function migrateOldBoards() {
  const dataDir = path.join(__dirname, 'data');
  const files = fs.readdirSync(dataDir).filter(f =>
    f.endsWith('.json') && !f.startsWith('_') && f !== '_users.json' && f !== '_suggestions.json'
  );
  if (files.length === 0) return;

  const adminBoardDir = path.join(__dirname, 'data', 'boards', 'admin');
  if (!fs.existsSync(adminBoardDir)) fs.mkdirSync(adminBoardDir, { recursive: true });

  files.forEach(f => {
    const src = path.join(dataDir, f);
    const dest = path.join(adminBoardDir, f);
    if (!fs.existsSync(dest)) {
      fs.renameSync(src, dest);
      console.log(`Migrated board: ${f} → admin/${f}`);
    } else {
      // Already exists in target, just remove old file
      fs.unlinkSync(src);
    }
  });
}

ensureDefaultAdmin();
migrateOldBoards();

// ═══════════════════════════════════════════════════════
//  MIDDLEWARE
// ═══════════════════════════════════════════════════════
app.use(express.json({ limit: '50mb' }));
app.set('trust proxy', 1); // trust first proxy (Coolify/nginx)

if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is not set. Set it before starting the server.');
  process.exit(1);
}
const sessionMiddleware = session({
  store: new FileStore({ path: './data/sessions', ttl: 7 * 24 * 60 * 60, retries: 0, logFn: () => {} }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
});
app.use(sessionMiddleware);

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.pendingTwoFactor) {
    // Password verified but 2FA not yet confirmed
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: 'Two-factor authentication required' });
    }
    return res.redirect('/login');
  }
  if (req.session && req.session.user) return next();
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return res.redirect('/login');
}

// Static assets (publicly accessible)
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.get('/favicon.svg', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.svg')));
app.use('/uploads', (req, res, next) => {
  if (!req.session?.user) return res.status(401).send('Unauthorized');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// ═══════════════════════════════════════════════════════
//  PAGE ROUTES
// ═══════════════════════════════════════════════════════
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.get('/canvas', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'canvas.html'));
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/settings', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// ═══════════════════════════════════════════════════════
//  AUTH API
// ═══════════════════════════════════════════════════════
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = findUser(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid credentials' });

  // Update lastLogin
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx >= 0) {
    users[idx].lastLogin = new Date().toISOString();
    saveUsers(users);
  }

  // If 2FA is enabled, require a second step
  if (user.twoFactorEnabled && user.twoFactorSecret) {
    req.session.pendingTwoFactor = { userId: user.id };
    return res.json({ requiresTwoFactor: true });
  }

  const userData = { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.user = userData;
    res.json({ success: true, user: userData });
  });
});

// Public config endpoint (no auth required)
app.get('/api/config/public', (req, res) => {
  const { registrationEnabled } = loadSettings();
  res.json({ registrationEnabled });
});

app.post('/api/auth/register', registerLimiter, (req, res) => {
  const { registrationEnabled } = loadSettings();
  if (!registrationEnabled) return res.status(403).json({ error: 'Registration is currently disabled' });

  const { username, password, displayName } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const cleanUsername = username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (cleanUsername.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (password.length < 3) return res.status(400).json({ error: 'Password must be at least 3 characters' });

  if (findUser(cleanUsername)) return res.status(409).json({ error: 'Username already taken' });

  const users = loadUsers();
  const hash = bcrypt.hashSync(password, 10);
  const newUser = {
    id: 'user_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4),
    username: cleanUsername,
    displayName: displayName || cleanUsername,
    passwordHash: hash,
    role: 'user',
    created: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
  };
  users.push(newUser);
  saveUsers(users);

  // Create boards directory
  const userBoardDir = path.join(__dirname, 'data', 'boards', cleanUsername);
  if (!fs.existsSync(userBoardDir)) fs.mkdirSync(userBoardDir, { recursive: true });

  // Auto-login
  req.session.user = {
    id: newUser.id,
    username: newUser.username,
    displayName: newUser.displayName,
    role: newUser.role,
  };

  res.json({
    success: true,
    user: {
      id: newUser.id,
      username: newUser.username,
      displayName: newUser.displayName,
      role: newUser.role,
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ─── TWO-FACTOR AUTHENTICATION ───────────────────────────

// Step 1: Generate a TOTP secret + QR code (setup)
app.post('/api/auth/2fa/setup', requireAuth, async (req, res) => {
  const users = loadUsers();
  const user = users.find(u => u.id === req.session.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.twoFactorEnabled) return res.status(400).json({ error: '2FA is already enabled' });

  const secret = totpGenerateSecret();
  // Store temporarily in session until confirmed
  req.session.pendingTwoFactorSetup = secret;

  const otpauthUrl = totpGenerateURI({ issuer: 'SAMESAMEBUTDIFFERENT', label: user.username, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  res.json({ secret, qrDataUrl });
});

// Step 2: Verify code and activate 2FA
app.post('/api/auth/2fa/verify-setup', requireAuth, (req, res) => {
  const { code } = req.body;
  const secret = req.session.pendingTwoFactorSetup;
  if (!secret) return res.status(400).json({ error: 'No pending 2FA setup. Start setup first.' });
  if (!code) return res.status(400).json({ error: 'Code is required' });

  const isValid = totpVerifySync({ token: String(code).replace(/\s/g, ''), secret });
  if (!isValid) return res.status(400).json({ error: 'Invalid code. Try again.' });

  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.session.user.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });

  users[idx].twoFactorSecret = secret;
  users[idx].twoFactorEnabled = true;
  saveUsers(users);
  delete req.session.pendingTwoFactorSetup;

  res.json({ success: true });
});

// Login step 2: Verify TOTP code after password
app.post('/api/auth/2fa/verify-login', twoFaLimiter, (req, res) => {
  const { code } = req.body;
  if (!req.session.pendingTwoFactor) return res.status(400).json({ error: 'No pending 2FA login' });

  const { userId } = req.session.pendingTwoFactor;
  const users = loadUsers();
  const user = users.find(u => u.id === userId);
  if (!user || !user.twoFactorSecret) return res.status(400).json({ error: 'Invalid session' });

  const isValid = totpVerifySync({ token: String(code).replace(/\s/g, ''), secret: user.twoFactorSecret });
  if (!isValid) return res.status(401).json({ error: 'Invalid code' });

  const userData2fa = { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.user = userData2fa;
    res.json({ success: true, user: userData2fa });
  });
});

// Disable 2FA (requires current password)
app.post('/api/auth/2fa/disable', requireAuth, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Current password is required' });

  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.session.user.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });

  if (!bcrypt.compareSync(password, users[idx].passwordHash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  users[idx].twoFactorEnabled = false;
  delete users[idx].twoFactorSecret;
  saveUsers(users);

  res.json({ success: true });
});

// 2FA status for current user
app.get('/api/auth/2fa/status', requireAuth, (req, res) => {
  const users = loadUsers();
  const user = users.find(u => u.id === req.session.user.id);
  res.json({ enabled: !!(user && user.twoFactorEnabled) });
});

app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user) {
    const users = loadUsers();
    const user = users.find(u => u.id === req.session.user.id);
    return res.json({ user: {
      ...req.session.user,
      email: user ? (user.email || '') : '',
      llmProvider: user ? (user.llmProvider || '') : '',
      llmModel: user ? (user.llmModel || '') : '',
      llmSystemPrompt: user ? (user.llmSystemPrompt || '') : '',
      llmConfigured: user ? !!(user.llmApiKey) : false,
    }});
  }
  res.status(401).json({ error: 'Not authenticated' });
});

app.put('/api/auth/profile', requireAuth, async (req, res) => {
  const { displayName, email, currentPassword, newPassword, llmProvider, llmApiKey, llmModel, llmSystemPrompt } = req.body;
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.session.user.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });

  if (displayName !== undefined) {
    const trimmed = displayName.trim();
    if (trimmed) users[idx].displayName = trimmed;
  }
  if (email !== undefined) {
    users[idx].email = email.trim();
  }
  if (newPassword) {
    if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
    const valid = await bcrypt.compare(currentPassword, users[idx].passwordHash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    if (newPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    users[idx].passwordHash = await bcrypt.hash(newPassword, 10);
  }

  if (llmProvider !== undefined) users[idx].llmProvider = llmProvider;
  if (llmModel !== undefined) users[idx].llmModel = llmModel;
  if (llmSystemPrompt !== undefined) users[idx].llmSystemPrompt = llmSystemPrompt;
  if (llmApiKey !== undefined) users[idx].llmApiKey = llmApiKey;

  saveUsers(users);
  req.session.user.displayName = users[idx].displayName;
  res.json({ ok: true, displayName: users[idx].displayName, email: users[idx].email || '' });
});

// ═══════════════════════════════════════════════════════
//  USERS LIST (authenticated — for todo assignment)
// ═══════════════════════════════════════════════════════
app.get('/api/users', requireAuth, (req, res) => {
  const users = loadUsers().map(u => ({
    username: u.username,
    displayName: u.displayName,
  }));
  res.json(users);
});

// ═══════════════════════════════════════════════════════
//  FILE UPLOAD (authenticated)
// ═══════════════════════════════════════════════════════
const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/avif': '.avif', 'application/pdf': '.pdf',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv',
  'text/plain': '.txt', 'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + (MIME_EXT[file.mimetype] || '.bin'));
  },
});
const ALLOWED_UPLOAD_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'application/pdf',
  'video/mp4', 'video/webm', 'video/ogg',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const uploadFileFilter = (req, file, cb) => {
  if (ALLOWED_UPLOAD_MIME.has(file.mimetype)) cb(null, true);
  else cb(Object.assign(new Error('File type not allowed'), { status: 415 }));
};
const upload = multer({ storage, fileFilter: uploadFileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

app.post('/api/upload', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(err.status || 400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({
      url: '/uploads/' + req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  });
});

// ═══════════════════════════════════════════════════════
//  BOARD API (user-scoped)
// ═══════════════════════════════════════════════════════
function getUserBoardDir(username) {
  const dir = path.join(__dirname, 'data', 'boards', username);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Save board
app.post('/api/boards/:name', requireAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const boardDir = getUserBoardDir(req.session.user.username);
  const filePath = path.join(boardDir, name + '.json');

  let created = new Date().toISOString();
  let collaborators = [];
  let shareToken = undefined;
  let sharePasswordHash = undefined;
  let boardId = crypto.randomUUID();
  if (fs.existsSync(filePath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (prev.meta && prev.meta.created) created = prev.meta.created;
      if (prev.meta && prev.meta.collaborators) collaborators = prev.meta.collaborators;
      if (prev.meta && prev.meta.shareToken) shareToken = prev.meta.shareToken;
      if (prev.meta && prev.meta.sharePasswordHash) sharePasswordHash = prev.meta.sharePasswordHash;
      if (prev.meta && prev.meta.boardId) boardId = prev.meta.boardId;
    } catch (e) {}
  }

  const meta = {
    boardId,
    created,
    lastEdit: new Date().toISOString(),
    elementCount: (req.body.elements || []).length,
    owner: req.session.user.username,
    collaborators,
  };
  if (shareToken) meta.shareToken = shareToken;
  if (sharePasswordHash) meta.sharePasswordHash = sharePasswordHash;

  const data = {
    ...req.body,
    meta,
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.json({ success: true });
});

// Rename board
app.post('/api/boards/:name/rename', requireAuth, (req, res) => {
  const oldName = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const newName = (req.body.newName || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!newName) return res.status(400).json({ error: 'Invalid name' });

  const boardDir = getUserBoardDir(req.session.user.username);
  const oldPath = path.join(boardDir, oldName + '.json');
  const newPath = path.join(boardDir, newName + '.json');

  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Board not found' });
  if (fs.existsSync(newPath)) return res.status(409).json({ error: 'Name already exists' });

  fs.renameSync(oldPath, newPath);
  res.json({ success: true, newName });
});

// Load board
app.get('/api/boards/:name', requireAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const boardDir = getUserBoardDir(req.session.user.username);
  const filePath = path.join(boardDir, name + '.json');

  if (!fs.existsSync(filePath)) return res.json({ elements: [], connections: [] });
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  res.json(data);
});

// Delete board
app.delete('/api/boards/:name', requireAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const boardDir = getUserBoardDir(req.session.user.username);
  const filePath = path.join(boardDir, name + '.json');

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Board not found' });
  }
});

// List boards (own + shared)
app.get('/api/boards', requireAuth, (req, res) => {
  const username = req.session.user.username;
  const boardDir = getUserBoardDir(username);
  const files = fs.readdirSync(boardDir).filter(f => f.endsWith('.json'));
  const boards = files.map(f => {
    const name = f.replace('.json', '');
    try {
      const data = JSON.parse(fs.readFileSync(path.join(boardDir, f), 'utf8'));
      return {
        name,
        boardId: data.meta?.boardId || null,
        owner: username,
        shared: false,
        created: data.meta?.created || null,
        lastEdit: data.meta?.lastEdit || null,
        elementCount: data.meta?.elementCount || (data.elements || []).length,
      };
    } catch (e) {
      return { name, boardId: null, owner: username, shared: false, created: null, lastEdit: null, elementCount: 0 };
    }
  });

  // Find shared boards from other users
  const boardsBase = path.join(__dirname, 'data', 'boards');
  if (fs.existsSync(boardsBase)) {
    fs.readdirSync(boardsBase).filter(d => d !== username && fs.statSync(path.join(boardsBase, d)).isDirectory()).forEach(owner => {
      const ownerDir = path.join(boardsBase, owner);
      fs.readdirSync(ownerDir).filter(f => f.endsWith('.json')).forEach(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(ownerDir, f), 'utf8'));
          const collabs = data.meta?.collaborators || [];
          if (collabs.includes(username)) {
            boards.push({
              name: f.replace('.json', ''),
              boardId: data.meta?.boardId || null,
              owner,
              shared: true,
              created: data.meta?.created || null,
              lastEdit: data.meta?.lastEdit || null,
              elementCount: data.meta?.elementCount || (data.elements || []).length,
            });
          }
        } catch (e) {}
      });
    });
  }

  boards.sort((a, b) => (b.lastEdit || '').localeCompare(a.lastEdit || ''));
  res.json(boards);
});

// Board thumbnail (own)
app.get('/api/boards/:name/thumb', requireAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(getUserBoardDir(req.session.user.username), name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).end();
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.thumbnail) return res.status(404).end();
    const base64 = data.thumbnail.replace(/^data:image\/\w+;base64,/, '');
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=60');
    res.send(Buffer.from(base64, 'base64'));
  } catch (e) { res.status(500).end(); }
});

// ═══════════════════════════════════════════════════════
//  BOARD SHARING — must be before /:owner/:name routes
// ═══════════════════════════════════════════════════════

// Get share status for own board
app.get('/api/boards/:name/share', requireAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(getUserBoardDir(req.session.user.username), name + '.json');
  if (!fs.existsSync(filePath)) return res.json({ enabled: false, shareToken: null, hasPassword: false });
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  res.json({
    enabled: !!data.meta?.shareToken,
    shareToken: data.meta?.shareToken || null,
    hasPassword: !!data.meta?.sharePasswordHash,
  });
});

// Enable/update sharing
app.post('/api/boards/:name/share', requireAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(getUserBoardDir(req.session.user.username), name + '.json');
  const { password } = req.body;
  const data = fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
    : { elements: [], connections: [], meta: { created: new Date().toISOString(), owner: req.session.user.username, collaborators: [] } };
  if (!data.meta) data.meta = {};
  if (!data.meta.shareToken) data.meta.shareToken = crypto.randomBytes(24).toString('hex');
  if (password === null || password === '') {
    delete data.meta.sharePasswordHash;
  } else if (typeof password === 'string') {
    data.meta.sharePasswordHash = bcrypt.hashSync(password, 10);
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.json({ success: true, shareToken: data.meta.shareToken, hasPassword: !!data.meta.sharePasswordHash });
});

// Disable sharing
app.delete('/api/boards/:name/share', requireAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(getUserBoardDir(req.session.user.username), name + '.json');
  if (!fs.existsSync(filePath)) return res.json({ success: true });
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (data.meta) { delete data.meta.shareToken; delete data.meta.sharePasswordHash; }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
//  BOARD API KEYS  (must be before /:owner/:name routes)
// ═══════════════════════════════════════════════════════

// List keys for a board
app.get('/api/boards/:name/keys', requireAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const username = req.session.user.username;
  const boardPath = path.join(getUserBoardDir(username), name + '.json');
  const boardId = fs.existsSync(boardPath) ? ensureBoardId(boardPath) : null;
  const keys = loadBoardKeys().filter(k => k.owner === username && k.board === name);
  res.json({ boardId, owner: username, keys: keys.map(({ keyHash, ...safe }) => safe) });
});

// Generate key for a board
app.post('/api/boards/:name/keys', requireAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const username = req.session.user.username;
  const boardPath = path.join(getUserBoardDir(username), name + '.json');
  if (!fs.existsSync(boardPath)) return res.status(404).json({ error: 'Board not found' });
  const { label = 'API Key', readOnly = false } = req.body;
  const boardId = ensureBoardId(boardPath);
  const raw = 'ssbd_' + crypto.randomBytes(32).toString('hex');
  const entry = {
    id: 'key_' + crypto.randomBytes(6).toString('hex'),
    keyHash: hashKey(raw),
    owner: username,
    board: name,
    boardId,
    label: String(label).slice(0, 64),
    readOnly: Boolean(readOnly),
    createdAt: new Date().toISOString(),
    lastUsed: null,
  };
  const keys = loadBoardKeys();
  keys.push(entry);
  saveBoardKeys(keys);
  res.json({ ...entry, keyHash: undefined, key: raw });
});

// Revoke key
app.delete('/api/boards/:name/keys/:keyId', requireAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const username = req.session.user.username;
  const keys = loadBoardKeys();
  const idx = keys.findIndex(k => k.id === req.params.keyId && k.owner === username && k.board === name);
  if (idx < 0) return res.status(404).json({ error: 'Key not found' });
  keys.splice(idx, 1);
  saveBoardKeys(keys);
  res.json({ success: true });
});

// Board thumbnail (shared)
app.get('/api/boards/:owner/:name/thumb', requireAuth, (req, res) => {
  const owner = req.params.owner.replace(/[^a-zA-Z0-9_-]/g, '');
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const username = req.session.user.username;

  const boardPath = owner === username
    ? path.join(getUserBoardDir(username), name + '.json')
    : path.join(__dirname, 'data', 'boards', owner, name + '.json');

  if (!fs.existsSync(boardPath)) return res.status(404).end();
  try {
    const data = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
    if (owner !== username) {
      const collabs = data.meta?.collaborators || [];
      if (!collabs.includes(username) && req.session.user.role !== 'admin') return res.status(403).end();
    }
    if (!data.thumbnail) return res.status(404).end();
    const base64 = data.thumbnail.replace(/^data:image\/\w+;base64,/, '');
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=60');
    res.send(Buffer.from(base64, 'base64'));
  } catch (e) { res.status(500).end(); }
});

// Load shared board
app.get('/api/boards/:owner/:name', requireAuth, (req, res) => {
  const owner = req.params.owner.replace(/[^a-zA-Z0-9_-]/g, '');
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const username = req.session.user.username;

  // If loading own board, redirect to standard route logic
  if (owner === username) {
    const boardDir = getUserBoardDir(username);
    const filePath = path.join(boardDir, name + '.json');
    if (!fs.existsSync(filePath)) return res.json({ elements: [], connections: [] });
    return res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  }

  const filePath = path.join(__dirname, 'data', 'boards', owner, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(403).json({ error: 'Access denied' });

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const collabs = data.meta?.collaborators || [];
  const isAdmin = req.session.user.role === 'admin';
  if (!collabs.includes(username) && !isAdmin) return res.status(403).json({ error: 'Access denied' });

  res.json(data);
});

// Save shared board
app.post('/api/boards/:owner/:name', requireAuth, (req, res) => {
  const owner = req.params.owner.replace(/[^a-zA-Z0-9_-]/g, '');
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const username = req.session.user.username;

  // If saving own board, use standard logic
  if (owner === username) {
    const boardDir = getUserBoardDir(username);
    const filePath = path.join(boardDir, name + '.json');
    let created = new Date().toISOString();
    let collaborators = [];
    if (fs.existsSync(filePath)) {
      try {
        const prev = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (prev.meta?.created) created = prev.meta.created;
        if (prev.meta?.collaborators) collaborators = prev.meta.collaborators;
      } catch (e) {}
    }
    const data = { ...req.body, meta: { created, lastEdit: new Date().toISOString(), elementCount: (req.body.elements || []).length, owner: username, collaborators } };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return res.json({ success: true });
  }

  const filePath = path.join(__dirname, 'data', 'boards', owner, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Board not found' });

  const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const collabs = existing.meta?.collaborators || [];
  const isAdmin = req.session.user.role === 'admin';
  if (!collabs.includes(username) && !isAdmin) return res.status(403).json({ error: 'Access denied' });

  const data = { ...req.body, meta: { created: existing.meta?.created || new Date().toISOString(), lastEdit: new Date().toISOString(), elementCount: (req.body.elements || []).length, owner, collaborators: collabs } };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
//  BOARD API KEYS
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
//  MCP BOARD API  (authenticated via X-Board-Key header)
//  Stable routes: /mcp/:owner/:boardId/... (UUID, survives renames)
//  Legacy routes: /mcp/:owner/:board/...   (board name, backwards compat)
// ═══════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stable: read board by boardId (or serve MCP server-info for claude.ai discovery when no X-Board-Key)
app.get('/mcp/:owner/:boardId', mcpLimiter, mcpCors, (req, res, next) => {
  if (!UUID_RE.test(req.params.boardId)) return next('route');
  if (!req.headers['x-board-key']) {
    // No API key header → return MCP server info so claude.ai can confirm endpoint is live
    return res.json({ name: 'ssbd', version: '1.0.0', protocolVersion: '2024-11-05' });
  }
  next();
}, requireBoardKeyById, (req, res) => {
  if (!fs.existsSync(req.boardFilePath)) return res.json({ elements: [], connections: [] });
  const data = JSON.parse(fs.readFileSync(req.boardFilePath, 'utf8'));
  const { meta, ...safe } = data;
  res.json({ ...safe, boardName: req.boardName, owner: req.params.owner });
});

// Stable: upload image by boardId
app.post('/mcp/:owner/:boardId/upload', mcpLimiter, (req, res, next) => {
  if (!UUID_RE.test(req.params.boardId)) return next('route');
  next();
}, requireBoardKeyById, async (req, res) => {
  if (req.boardKeyEntry.readOnly) return res.status(403).json({ error: 'Key is read-only' });
  const { base64, mimeType, filename, url, path: localPath } = req.body;
  const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
  const MAX = 20 * 1024 * 1024;
  const EXT_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };
  try {
    let buf, mime, ext;
    if (url) {
      const fetch = (await import('node-fetch')).default;
      const r = await fetch(url, { redirect: 'follow', size: MAX });
      mime = (r.headers.get('content-type') || '').split(';')[0].trim();
      if (!ALLOWED.has(mime)) return res.status(415).json({ error: 'Image type not allowed: ' + mime });
      buf = Buffer.from(await r.arrayBuffer());
    } else if (localPath) {
      const uploadBase = path.resolve(process.env.SSBD_UPLOAD_BASE || '/mnt/user-data/uploads');
      const resolved = path.resolve(uploadBase, localPath);
      if (!resolved.startsWith(uploadBase + path.sep) && resolved !== uploadBase) return res.status(400).json({ error: 'Path traversal not allowed' });
      if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found: ' + localPath });
      buf = fs.readFileSync(resolved);
      if (buf.length > MAX) return res.status(413).json({ error: 'Image too large (max 20 MB)' });
      mime = EXT_MIME[path.extname(localPath).toLowerCase()] || 'image/jpeg';
      if (!ALLOWED.has(mime)) return res.status(415).json({ error: 'Image type not allowed' });
    } else if (base64) {
      mime = mimeType || 'image/jpeg';
      if (!ALLOWED.has(mime)) return res.status(415).json({ error: 'Image type not allowed' });
      buf = Buffer.from(base64, 'base64');
      if (buf.length > MAX) return res.status(413).json({ error: 'Image too large (max 20 MB)' });
    } else {
      return res.status(400).json({ error: 'Provide path, base64, or url' });
    }
    ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif' }[mime] || '.jpg';
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    fs.writeFileSync(path.join(__dirname, 'uploads', unique), buf);
    res.json({ src: '/uploads/' + unique, filename: unique, size: buf.length, mimeType: mime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stable: write board by boardId
app.put('/mcp/:owner/:boardId', mcpLimiter, (req, res, next) => {
  if (!UUID_RE.test(req.params.boardId)) return next('route');
  next();
}, requireBoardKeyById, (req, res) => {
  if (req.boardKeyEntry.readOnly) return res.status(403).json({ error: 'Key is read-only' });
  let meta = { created: new Date().toISOString(), owner: req.params.owner };
  if (fs.existsSync(req.boardFilePath)) {
    try { const prev = JSON.parse(fs.readFileSync(req.boardFilePath, 'utf8')); if (prev.meta) meta = prev.meta; } catch {}
  }
  meta.lastEdit = new Date().toISOString();
  meta.elementCount = (req.body.elements || []).length;
  const board = { ...req.body, meta };
  fs.writeFileSync(req.boardFilePath, JSON.stringify(board, null, 2));
  const room = `${req.params.owner}/${req.boardName}`;
  broadcastToRoom(room, null, { type: 'state', elements: board.elements || [], connections: board.connections || [] });
  res.json({ success: true });
});

// Stable: MCP JSON-RPC endpoint by boardId — accepts Bearer token (OAuth/claude.ai) or X-Board-Key
app.options('/mcp/:owner/:boardId', (req, res, next) => {
  if (!UUID_RE.test(req.params.boardId)) return next('route');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Board-Key, Mcp-Session-Id');
  res.sendStatus(204);
});

app.post('/mcp/:owner/:boardId', mcpLimiter, (req, res, next) => {
  if (!UUID_RE.test(req.params.boardId)) return next('route');
  next();
}, mcpCors, async (req, res) => {
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const rawKey = bearer || req.headers['x-board-key'] || '';
  const idVal = req.body?.id ?? null;
  if (!rawKey) return res.status(401).json({ jsonrpc: '2.0', id: idVal, error: { code: -32001, message: 'Missing auth' } });
  const hash = hashKey(rawKey);
  const keys = loadBoardKeys();
  const entry = keys.find(k => k.keyHash === hash);
  if (!entry) return res.status(401).json({ jsonrpc: '2.0', id: idVal, error: { code: -32001, message: 'Invalid key' } });

  const boardDir = path.join(__dirname, 'data', 'boards', req.params.owner);
  let boardFilePath = null, boardName = null;
  if (fs.existsSync(boardDir)) {
    for (const f of fs.readdirSync(boardDir).filter(f => f.endsWith('.json'))) {
      try { const d = JSON.parse(fs.readFileSync(path.join(boardDir, f), 'utf8')); if (d.meta?.boardId === req.params.boardId) { boardFilePath = path.join(boardDir, f); boardName = f.replace('.json', ''); break; } } catch {}
    }
  }
  if (!boardFilePath) return res.status(404).json({ jsonrpc: '2.0', id: idVal, error: { code: -32002, message: 'Board not found' } });
  if (entry.boardId && entry.boardId !== req.params.boardId) return res.status(403).json({ jsonrpc: '2.0', id: idVal, error: { code: -32003, message: 'Key not authorized for this board' } });

  entry.lastUsed = new Date().toISOString(); saveBoardKeys(keys);
  const { method, params, id } = req.body || {};
  const ok  = (result) => res.json({ jsonrpc: '2.0', id: id ?? null, result });
  const err = (code, message) => res.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  try {
    if (method === 'initialize') return ok({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ssbd', version: '1.0.0' } });
    if (method === 'notifications/initialized') return res.status(202).end();
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: REMOTE_MCP_TOOLS });
    if (method === 'tools/call') {
      if (entry.readOnly && ['add_element','update_element','delete_element','push_todo_items','set_todo_item_done'].includes(params?.name)) return err(-32003, 'Key is read-only');
      const result = await remoteMcpCallTool(params.name, params.arguments || {}, boardFilePath, entry.owner, boardName);
      return ok({ content: result.content, isError: false });
    }
    return err(-32601, `Method not found: ${method}`);
  } catch (e) {
    return err(-32603, e.message);
  }
});

// Legacy: read full board by name
app.get('/mcp/:owner/:board', mcpLimiter, (req, res, next) => {
  req.params.name = req.params.board; req.params.owner = req.params.owner; next();
}, requireBoardKey, (req, res) => {
  const filePath = path.join(__dirname, 'data', 'boards', req.params.owner, req.params.board + '.json');
  if (!fs.existsSync(filePath)) return res.json({ elements: [], connections: [] });
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const { meta, ...safe } = data;
  res.json({ ...safe, boardName: req.params.board, owner: req.params.owner });
});

// Upload image via base64 or remote URL
app.post('/mcp/:owner/:board/upload', mcpLimiter, (req, res, next) => {
  req.params.name = req.params.board; next();
}, requireBoardKey, async (req, res) => {
  if (req.boardKeyEntry.readOnly) return res.status(403).json({ error: 'Key is read-only' });

  const { base64, mimeType, filename, url, path: localPath } = req.body;
  const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
  const MAX = 20 * 1024 * 1024; // 20 MB
  const EXT_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };

  try {
    let buf, mime, ext;

    if (url) {
      // Fetch remote image
      const fetch = (await import('node-fetch')).default;
      const r = await fetch(url, { redirect: 'follow', size: MAX });
      mime = (r.headers.get('content-type') || '').split(';')[0].trim();
      if (!ALLOWED.has(mime)) return res.status(415).json({ error: 'Image type not allowed: ' + mime });
      buf = Buffer.from(await r.arrayBuffer());
    } else if (localPath) {
      // Read from local filesystem path (sandboxed to SSBD_UPLOAD_BASE)
      const uploadBase = path.resolve(process.env.SSBD_UPLOAD_BASE || '/mnt/user-data/uploads');
      const resolved = path.resolve(uploadBase, localPath);
      if (!resolved.startsWith(uploadBase + path.sep) && resolved !== uploadBase) {
        return res.status(400).json({ error: 'Path traversal not allowed' });
      }
      if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found: ' + localPath });
      buf = fs.readFileSync(resolved);
      if (buf.length > MAX) return res.status(413).json({ error: 'Image too large (max 20 MB)' });
      mime = EXT_MIME[path.extname(localPath).toLowerCase()] || 'image/jpeg';
      if (!ALLOWED.has(mime)) return res.status(415).json({ error: 'Image type not allowed' });
    } else if (base64) {
      mime = mimeType || 'image/jpeg';
      if (!ALLOWED.has(mime)) return res.status(415).json({ error: 'Image type not allowed' });
      buf = Buffer.from(base64, 'base64');
      if (buf.length > MAX) return res.status(413).json({ error: 'Image too large (max 20 MB)' });
    } else {
      return res.status(400).json({ error: 'Provide path, base64, or url' });
    }

    ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif' }[mime] || '.jpg';
    const fname = (filename ? filename.replace(/[^a-zA-Z0-9._-]/g, '') : '') || (Date.now() + ext);
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    const dest = path.join(__dirname, 'uploads', unique);
    fs.writeFileSync(dest, buf);
    res.json({ src: '/uploads/' + unique, filename: unique, size: buf.length, mimeType: mime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Write full board (read-only keys rejected)
app.put('/mcp/:owner/:board', mcpLimiter, (req, res, next) => {
  req.params.name = req.params.board; next();
}, requireBoardKey, (req, res) => {
  if (req.boardKeyEntry.readOnly) return res.status(403).json({ error: 'Key is read-only' });
  const filePath = path.join(__dirname, 'data', 'boards', req.params.owner, req.params.board + '.json');
  let meta = { created: new Date().toISOString(), owner: req.params.owner };
  if (fs.existsSync(filePath)) {
    try { const prev = JSON.parse(fs.readFileSync(filePath, 'utf8')); if (prev.meta) meta = prev.meta; } catch {}
  }
  meta.lastEdit = new Date().toISOString();
  meta.elementCount = (req.body.elements || []).length;
  const board = { ...req.body, meta };
  fs.writeFileSync(filePath, JSON.stringify(board, null, 2));
  const room = `${req.params.owner}/${req.params.board}`;
  broadcastToRoom(room, null, { type: 'state', elements: board.elements || [], connections: board.connections || [] });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
//  OAUTH 2.0 + REMOTE MCP HTTP ENDPOINT (claude.ai connector)
//  Connect URL: /mcp-remote
//  Auth: user enters board API key in OAuth form → Bearer token
// ═══════════════════════════════════════════════════════

// Temporary auth codes: code → { key, expires }
const _mcpAuthCodes = new Map();

// CORS middleware for MCP + OAuth endpoints (claude.ai is cross-origin)
function mcpCors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
app.options('/mcp-remote', mcpCors);
app.options('/.well-known/oauth-authorization-server', mcpCors);
app.options('/oauth/authorize', mcpCors);
app.options('/oauth/token', mcpCors);

// OAuth discovery
app.get('/.well-known/oauth-authorization-server', mcpCors, (req, res) => {
  const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain'],
  });
});

// OAuth authorize — show key entry form
app.get('/oauth/authorize', mcpCors, (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.query;
  const escaped = (s) => String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SSBD — Connect Board</title>
<style>
  body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .box{background:#1a1a1a;border:1px solid #333;padding:40px;width:100%;max-width:400px}
  h2{margin:0 0 8px;font-size:16px;font-weight:700;letter-spacing:2px}
  p{margin:0 0 24px;font-size:12px;color:#888}
  input{width:100%;background:#111;border:1px solid #444;color:#eee;font-family:monospace;font-size:11px;padding:10px 12px;box-sizing:border-box;outline:none;margin-bottom:16px}
  input:focus{border-color:#fff}
  button{width:100%;background:#fff;color:#111;border:none;font-family:inherit;font-size:11px;font-weight:700;letter-spacing:2px;padding:12px;cursor:pointer}
  button:hover{background:#FF4500;color:#fff}
  .err{color:#FF4500;font-size:11px;margin-top:12px}
</style></head>
<body><div class="box">
  <h2>● SAMESAMEBUTDIFFERENT</h2>
  <p>Enter your board API key to connect Claude.</p>
  <form method="POST" action="/oauth/authorize">
    <input type="hidden" name="redirect_uri" value="${escaped(redirect_uri)}">
    <input type="hidden" name="state" value="${escaped(state)}">
    <input type="hidden" name="code_challenge" value="${escaped(code_challenge)}">
    <input type="hidden" name="code_challenge_method" value="${escaped(code_challenge_method)}">
    <input type="password" name="key" placeholder="ssbd_..." autocomplete="off" required>
    <button type="submit">CONNECT →</button>
  </form>
</div></body></html>`);
});

app.post('/oauth/authorize', mcpCors, express.urlencoded({ extended: false }), (req, res) => {
  const { key, redirect_uri, state } = req.body;
  if (!key || !key.startsWith('ssbd_')) return res.status(400).send('Invalid key format');
  const hash = hashKey(key);
  const keys = loadBoardKeys();
  if (!keys.find(k => k.keyHash === hash)) return res.status(401).send('Key not found');
  // Generate short-lived code
  const code = crypto.randomBytes(24).toString('hex');
  const { code_challenge, code_challenge_method } = req.body;
  _mcpAuthCodes.set(code, { key, expires: Date.now() + 5 * 60 * 1000, code_challenge: code_challenge || '', code_challenge_method: code_challenge_method || 'S256' });
  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.redirect(url.toString());
});

// OAuth token exchange
app.post('/oauth/token', mcpCors, express.json(), express.urlencoded({ extended: false }), (req, res) => {
  const { grant_type, code, code_verifier } = req.body;
  if (grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });
  const entry = _mcpAuthCodes.get(code);
  if (!entry || entry.expires < Date.now()) { _mcpAuthCodes.delete(code); return res.status(400).json({ error: 'invalid_grant' }); }
  if (entry.code_challenge) {
    if (!code_verifier) { _mcpAuthCodes.delete(code); return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier required' }); }
    const computed = entry.code_challenge_method === 'S256'
      ? crypto.createHash('sha256').update(code_verifier).digest('base64url')
      : code_verifier;
    if (computed !== entry.code_challenge) { _mcpAuthCodes.delete(code); return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier mismatch' }); }
  }
  _mcpAuthCodes.delete(code);
  res.json({ access_token: entry.key, token_type: 'bearer', expires_in: 7776000 });
});

// Cleanup expired codes periodically
setInterval(() => { const now = Date.now(); _mcpAuthCodes.forEach((v, k) => { if (v.expires < now) _mcpAuthCodes.delete(k); }); }, 60 * 1000);

const REMOTE_MCP_TOOLS = [
  { name: 'read_board',      description: 'Read the full board — returns all elements and connections.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_elements',   description: 'List elements, optionally filtered by type (text,note,image,rect,circle,arrow,todo,llmchat,heading,file,pin,draw,icon,calendar).', inputSchema: { type: 'object', properties: { type: { type: 'string' } } } },
  { name: 'search_elements', description: 'Search elements whose text content contains the query string.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'add_element',     description: 'Add a new element. For images call upload_image first.', inputSchema: { type: 'object', properties: { type: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, content: { type: 'string' }, src: { type: 'string' }, color: { type: 'string' } }, required: ['type', 'x', 'y'] } },
  { name: 'update_element',  description: 'Merge updates into an existing element by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, updates: { type: 'object' } }, required: ['id', 'updates'] } },
  { name: 'delete_element',  description: 'Delete an element by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'push_todo_items', description: 'Append items to an existing todo list without replacing existing ones.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, done: { type: 'boolean' }, important: { type: 'boolean' } }, required: ['text'] } } }, required: ['id', 'items'] } },
  { name: 'set_todo_item_done', description: 'Mark a todo item done/undone by zero-based index.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, index: { type: 'number' }, done: { type: 'boolean' } }, required: ['id', 'index', 'done'] } },
];

async function remoteMcpCallTool(name, args, boardFilePath, owner, boardName) {
  const readBoard = () => {
    if (!fs.existsSync(boardFilePath)) return { elements: [], connections: [] };
    const d = JSON.parse(fs.readFileSync(boardFilePath, 'utf8'));
    const { meta, ...safe } = d; return { ...safe, boardName, owner };
  };
  const writeBoard = (data) => {
    let meta = { created: new Date().toISOString(), owner };
    if (fs.existsSync(boardFilePath)) { try { const p = JSON.parse(fs.readFileSync(boardFilePath, 'utf8')); if (p.meta) meta = p.meta; } catch {} }
    meta.lastEdit = new Date().toISOString();
    meta.elementCount = (data.elements || []).length;
    const board = { ...data, meta };
    fs.writeFileSync(boardFilePath, JSON.stringify(board, null, 2));
    broadcastToRoom(`${owner}/${boardName}`, null, { type: 'state', elements: board.elements || [], connections: board.connections || [] });
  };
  const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });

  switch (name) {
    case 'read_board':      return text(readBoard());
    case 'list_elements': { const b = readBoard(); let els = b.elements || []; if (args.type) els = els.filter(e => e.type === args.type); return text(els); }
    case 'search_elements': { const b = readBoard(); const q = (args.query || '').toLowerCase(); return text((b.elements || []).filter(e => [e.content, e.text, e.title].filter(Boolean).join(' ').toLowerCase().includes(q))); }
    case 'add_element': {
      const b = readBoard();
      const el = { id: 'el_mcp_' + Math.random().toString(36).slice(2, 10), type: args.type, x: args.x ?? 100, y: args.y ?? 100, width: args.width ?? (args.type === 'image' ? 300 : 200), height: args.height ?? (args.type === 'image' ? 200 : 120), content: args.content ?? '', zIndex: ((b.elements || []).length + 1), ...(args.src ? { src: args.src } : {}), ...(args.color ? { color: args.color } : {}) };
      writeBoard({ ...b, elements: [...(b.elements || []), el] });
      return text(el);
    }
    case 'update_element': {
      const b = readBoard(); const idx = (b.elements || []).findIndex(e => e.id === args.id);
      if (idx < 0) throw new Error(`Element ${args.id} not found`);
      const elements = [...b.elements]; elements[idx] = { ...elements[idx], ...args.updates, id: args.id };
      writeBoard({ ...b, elements }); return text(elements[idx]);
    }
    case 'delete_element': {
      const b = readBoard(); const before = (b.elements || []).length;
      const elements = (b.elements || []).filter(e => e.id !== args.id);
      if (elements.length === before) throw new Error(`Element ${args.id} not found`);
      writeBoard({ ...b, elements }); return text(`Deleted ${args.id}`);
    }
    case 'push_todo_items': {
      const b = readBoard(); const idx = (b.elements || []).findIndex(e => e.id === args.id);
      if (idx < 0) throw new Error(`Element ${args.id} not found`);
      if (b.elements[idx].type !== 'todo') throw new Error(`Element ${args.id} is not a todo list`);
      const newItems = (args.items || []).map(i => ({ text: i.text, done: i.done ?? false, important: i.important ?? false, assignee: '' }));
      const elements = [...b.elements]; elements[idx] = { ...elements[idx], items: [...(elements[idx].items || []), ...newItems] };
      writeBoard({ ...b, elements }); return text(`Added ${newItems.length} item(s)`);
    }
    case 'set_todo_item_done': {
      const b = readBoard(); const idx = (b.elements || []).findIndex(e => e.id === args.id);
      if (idx < 0) throw new Error(`Element ${args.id} not found`);
      const items = [...(b.elements[idx].items || [])];
      if (args.index < 0 || args.index >= items.length) throw new Error(`Index ${args.index} out of range`);
      items[args.index] = { ...items[args.index], done: args.done };
      const elements = [...b.elements]; elements[idx] = { ...elements[idx], items };
      writeBoard({ ...b, elements }); return text(`Item ${args.index} marked ${args.done ? 'done' : 'undone'}`);
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

app.get('/mcp-remote', mcpCors, (req, res) => {
  res.status(200).json({ name: 'ssbd', version: '1.0.0', protocol: 'MCP/2024-11-05' });
});

app.post('/mcp-remote', mcpCors, mcpLimiter, async (req, res) => {
  // Accept Bearer token (OAuth flow) or key-in-URL (?key=) for backwards compat
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const rawKey = bearer || req.query.key || '';
  if (!rawKey) return res.status(401).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32001, message: 'Missing auth' } });
  const hash = hashKey(rawKey);
  const keys = loadBoardKeys();
  const entry = keys.find(k => k.keyHash === hash);
  if (!entry) return res.status(401).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32001, message: 'Invalid key' } });

  const boardDir = path.join(__dirname, 'data', 'boards', entry.owner);
  let boardFilePath = null, boardName = null;
  if (entry.boardId && fs.existsSync(boardDir)) {
    for (const f of fs.readdirSync(boardDir).filter(f => f.endsWith('.json'))) {
      try { const d = JSON.parse(fs.readFileSync(path.join(boardDir, f), 'utf8')); if (d.meta?.boardId === entry.boardId) { boardFilePath = path.join(boardDir, f); boardName = f.replace('.json', ''); break; } } catch {}
    }
  } else if (entry.board) {
    boardFilePath = path.join(boardDir, entry.board + '.json');
    boardName = entry.board;
  }
  if (!boardFilePath) return res.status(404).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32002, message: 'Board not found' } });

  entry.lastUsed = new Date().toISOString(); saveBoardKeys(keys);

  const { method, params, id } = req.body || {};
  const ok  = (result) => res.json({ jsonrpc: '2.0', id: id ?? null, result });
  const err = (code, message) => res.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  try {
    if (method === 'initialize') return ok({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ssbd', version: '1.0.0' } });
    if (method === 'notifications/initialized') return res.status(202).end();
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: REMOTE_MCP_TOOLS });
    if (method === 'tools/call') {
      if (entry.readOnly && ['add_element','update_element','delete_element','push_todo_items','set_todo_item_done'].includes(params?.name)) return err(-32003, 'Key is read-only');
      const result = await remoteMcpCallTool(params.name, params.arguments || {}, boardFilePath, entry.owner, boardName);
      return ok({ content: result.content, isError: false });
    }
    return err(-32601, `Method not found: ${method}`);
  } catch (e) {
    return err(-32603, e.message);
  }
});

// ═══════════════════════════════════════════════════════
//  SUGGESTIONS API (shared, authenticated)
// ═══════════════════════════════════════════════════════
const suggestionsFile = path.join(__dirname, 'data', '_suggestions.json');

app.get('/api/suggestions', requireAuth, (req, res) => {
  if (!fs.existsSync(suggestionsFile)) return res.json([]);
  res.json(JSON.parse(fs.readFileSync(suggestionsFile, 'utf8')));
});

app.post('/api/suggestions', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Empty' });
  let suggestions = [];
  if (fs.existsSync(suggestionsFile)) {
    suggestions = JSON.parse(fs.readFileSync(suggestionsFile, 'utf8'));
  }
  suggestions.unshift({
    text: text.trim(),
    time: new Date().toISOString(),
    user: req.session.user.username,
  });
  fs.writeFileSync(suggestionsFile, JSON.stringify(suggestions, null, 2));
  res.json({ success: true });
});

// Edit suggestion (owner or admin)
app.put('/api/suggestions/:index', requireAuth, (req, res) => {
  const idx = parseInt(req.params.index);
  const { text } = req.body;
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid index' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'Empty' });

  let suggestions = [];
  if (fs.existsSync(suggestionsFile)) {
    suggestions = JSON.parse(fs.readFileSync(suggestionsFile, 'utf8'));
  }
  if (idx < 0 || idx >= suggestions.length) return res.status(404).json({ error: 'Not found' });

  // Only the owner or an admin can edit
  const isOwner = suggestions[idx].user === req.session.user.username;
  const isAdmin = req.session.user.role === 'admin';
  if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not allowed' });

  suggestions[idx].text = text.trim();
  suggestions[idx].edited = new Date().toISOString();
  fs.writeFileSync(suggestionsFile, JSON.stringify(suggestions, null, 2));
  res.json({ success: true });
});

// Delete suggestion (owner or admin)
app.delete('/api/suggestions/:index', requireAuth, (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid index' });

  let suggestions = [];
  if (fs.existsSync(suggestionsFile)) {
    suggestions = JSON.parse(fs.readFileSync(suggestionsFile, 'utf8'));
  }
  if (idx < 0 || idx >= suggestions.length) return res.status(404).json({ error: 'Not found' });

  const isOwner = suggestions[idx].user === req.session.user.username;
  const isAdmin = req.session.user.role === 'admin';
  if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not allowed' });

  suggestions.splice(idx, 1);
  fs.writeFileSync(suggestionsFile, JSON.stringify(suggestions, null, 2));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
//  EXPORT API
// ═══════════════════════════════════════════════════════
app.post('/api/export', requireAuth, (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'No data' });
  const base64 = data.replace(/^data:image\/png;base64,/, '');
  const filename = 'export-' + Date.now() + '.png';
  fs.writeFileSync(path.join(__dirname, 'uploads', filename), base64, 'base64');
  res.json({ url: '/uploads/' + filename });
});

// ═══════════════════════════════════════════════════════
//  ADMIN API
// ═══════════════════════════════════════════════════════

// Stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const users = loadUsers();
  let totalBoards = 0;
  let totalElements = 0;

  const boardsBaseDir = path.join(__dirname, 'data', 'boards');
  if (fs.existsSync(boardsBaseDir)) {
    const userDirs = fs.readdirSync(boardsBaseDir).filter(d =>
      fs.statSync(path.join(boardsBaseDir, d)).isDirectory()
    );
    userDirs.forEach(userDir => {
      const boardFiles = fs.readdirSync(path.join(boardsBaseDir, userDir)).filter(f => f.endsWith('.json'));
      totalBoards += boardFiles.length;
      boardFiles.forEach(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(boardsBaseDir, userDir, f), 'utf8'));
          totalElements += (data.elements || []).length;
        } catch (e) {}
      });
    });
  }

  let totalSuggestions = 0;
  if (fs.existsSync(suggestionsFile)) {
    try {
      totalSuggestions = JSON.parse(fs.readFileSync(suggestionsFile, 'utf8')).length;
    } catch (e) {}
  }

  // Uploads size
  let uploadsSize = 0;
  const uploadsDir = path.join(__dirname, 'uploads');
  if (fs.existsSync(uploadsDir)) {
    fs.readdirSync(uploadsDir).forEach(f => {
      try {
        uploadsSize += fs.statSync(path.join(uploadsDir, f)).size;
      } catch (e) {}
    });
  }

  res.json({
    totalUsers: users.length,
    totalBoards,
    totalElements,
    totalSuggestions,
    uploadsSize,
  });
});

// List all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = loadUsers().map(u => {
    const boardDir = path.join(__dirname, 'data', 'boards', u.username);
    let boardCount = 0;
    if (fs.existsSync(boardDir)) {
      boardCount = fs.readdirSync(boardDir).filter(f => f.endsWith('.json')).length;
    }
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      created: u.created,
      lastLogin: u.lastLogin,
      boardCount,
    };
  });
  res.json(users);
});

// Create user (admin)
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, displayName, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const cleanUsername = username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (cleanUsername.length < 2) return res.status(400).json({ error: 'Username too short' });
  if (findUser(cleanUsername)) return res.status(409).json({ error: 'Username already taken' });

  const users = loadUsers();
  const hash = bcrypt.hashSync(password, 10);
  const newUser = {
    id: 'user_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4),
    username: cleanUsername,
    displayName: displayName || cleanUsername,
    passwordHash: hash,
    role: role || 'user',
    created: new Date().toISOString(),
    lastLogin: null,
  };
  users.push(newUser);
  saveUsers(users);

  const userBoardDir = path.join(__dirname, 'data', 'boards', cleanUsername);
  if (!fs.existsSync(userBoardDir)) fs.mkdirSync(userBoardDir, { recursive: true });

  res.json({ success: true, user: { id: newUser.id, username: newUser.username, displayName: newUser.displayName, role: newUser.role } });
});

// Update user (admin)
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });

  const { displayName, role } = req.body;
  if (displayName !== undefined) users[idx].displayName = displayName;
  if (role !== undefined) users[idx].role = role;

  saveUsers(users);
  res.json({ success: true });
});

// Reset password (admin)
app.post('/api/admin/users/:id/reset-password', requireAdmin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 3) return res.status(400).json({ error: 'Password must be at least 3 characters' });

  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });

  users[idx].passwordHash = bcrypt.hashSync(newPassword, 10);
  saveUsers(users);
  res.json({ success: true });
});

// Delete user (admin)
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });

  // Prevent deleting yourself
  if (req.session.user.id === req.params.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  const username = users[idx].username;
  users.splice(idx, 1);
  saveUsers(users);

  // Optionally remove user's boards directory
  const boardDir = path.join(__dirname, 'data', 'boards', username);
  if (fs.existsSync(boardDir)) {
    fs.rmSync(boardDir, { recursive: true, force: true });
  }

  res.json({ success: true });
});

// List all boards (admin)
app.get('/api/admin/boards', requireAdmin, (req, res) => {
  const boardsBaseDir = path.join(__dirname, 'data', 'boards');
  const allBoards = [];

  if (fs.existsSync(boardsBaseDir)) {
    const userDirs = fs.readdirSync(boardsBaseDir).filter(d =>
      fs.statSync(path.join(boardsBaseDir, d)).isDirectory()
    );
    userDirs.forEach(username => {
      const boardFiles = fs.readdirSync(path.join(boardsBaseDir, username)).filter(f => f.endsWith('.json'));
      boardFiles.forEach(f => {
        const name = f.replace('.json', '');
        try {
          const data = JSON.parse(fs.readFileSync(path.join(boardsBaseDir, username, f), 'utf8'));
          allBoards.push({
            name,
            owner: username,
            created: data.meta?.created || null,
            lastEdit: data.meta?.lastEdit || null,
            elementCount: data.meta?.elementCount || (data.elements || []).length,
          });
        } catch (e) {
          allBoards.push({ name, owner: username, created: null, lastEdit: null, elementCount: 0 });
        }
      });
    });
  }

  allBoards.sort((a, b) => (b.lastEdit || '').localeCompare(a.lastEdit || ''));
  res.json(allBoards);
});

// Delete board (admin)
app.delete('/api/admin/boards/:username/:name', requireAdmin, (req, res) => {
  const username = req.params.username.replace(/[^a-zA-Z0-9_-]/g, '');
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(__dirname, 'data', 'boards', username, name + '.json');

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Board not found' });
  }
});

// Board collaborators (admin)
app.get('/api/admin/boards/:username/:name/collaborators', requireAdmin, (req, res) => {
  const username = req.params.username.replace(/[^a-zA-Z0-9_-]/g, '');
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(__dirname, 'data', 'boards', username, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Board not found' });
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  res.json(data.meta?.collaborators || []);
});

app.post('/api/admin/boards/:username/:name/collaborators', requireAdmin, (req, res) => {
  const username = req.params.username.replace(/[^a-zA-Z0-9_-]/g, '');
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const { user: collab } = req.body;
  if (!collab) return res.status(400).json({ error: 'User required' });

  const filePath = path.join(__dirname, 'data', 'boards', username, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Board not found' });

  // Verify the user exists
  if (!findUser(collab)) return res.status(404).json({ error: 'User not found' });
  if (collab === username) return res.status(400).json({ error: 'Cannot add owner as collaborator' });

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!data.meta) data.meta = {};
  if (!data.meta.collaborators) data.meta.collaborators = [];
  if (data.meta.collaborators.includes(collab)) return res.status(409).json({ error: 'Already a collaborator' });

  data.meta.collaborators.push(collab);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.json({ success: true, collaborators: data.meta.collaborators });
});

app.delete('/api/admin/boards/:username/:name/collaborators/:user', requireAdmin, (req, res) => {
  const username = req.params.username.replace(/[^a-zA-Z0-9_-]/g, '');
  const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const collab = req.params.user;

  const filePath = path.join(__dirname, 'data', 'boards', username, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Board not found' });

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!data.meta?.collaborators) return res.status(404).json({ error: 'Not a collaborator' });

  const idx = data.meta.collaborators.indexOf(collab);
  if (idx < 0) return res.status(404).json({ error: 'Not a collaborator' });

  data.meta.collaborators.splice(idx, 1);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.json({ success: true, collaborators: data.meta.collaborators });
});

// Admin suggestions
app.get('/api/admin/suggestions', requireAdmin, (req, res) => {
  if (!fs.existsSync(suggestionsFile)) return res.json([]);
  res.json(JSON.parse(fs.readFileSync(suggestionsFile, 'utf8')));
});

// Toggle suggestion done status (admin)
app.patch('/api/admin/suggestions/:index/toggle-done', requireAdmin, (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid index' });

  let suggestions = [];
  if (fs.existsSync(suggestionsFile)) {
    suggestions = JSON.parse(fs.readFileSync(suggestionsFile, 'utf8'));
  }
  if (idx < 0 || idx >= suggestions.length) return res.status(404).json({ error: 'Not found' });

  suggestions[idx].done = !suggestions[idx].done;
  if (suggestions[idx].done) {
    suggestions[idx].doneBy = req.session.user.username;
    suggestions[idx].doneAt = new Date().toISOString();
  } else {
    delete suggestions[idx].doneBy;
    delete suggestions[idx].doneAt;
  }

  fs.writeFileSync(suggestionsFile, JSON.stringify(suggestions, null, 2));
  res.json({ success: true, done: suggestions[idx].done });
});

// ═══════════════════════════════════════════════════════
// Admin Settings
// ═══════════════════════════════════════════════════════
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json(loadSettings());
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const settings = loadSettings();
  if (typeof req.body.registrationEnabled === 'boolean') {
    settings.registrationEnabled = req.body.registrationEnabled;
  }
  saveSettings(settings);
  res.json(settings);
});

app.delete('/api/admin/suggestions/:index', requireAdmin, (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid index' });

  let suggestions = [];
  if (fs.existsSync(suggestionsFile)) {
    suggestions = JSON.parse(fs.readFileSync(suggestionsFile, 'utf8'));
  }
  if (idx < 0 || idx >= suggestions.length) return res.status(404).json({ error: 'Not found' });

  suggestions.splice(idx, 1);
  fs.writeFileSync(suggestionsFile, JSON.stringify(suggestions, null, 2));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
//  STATISTICS
// ═══════════════════════════════════════════════════════
app.get('/api/stats', requireAuth, (req, res) => {
  const boardDir = path.join(__dirname, 'data', 'boards', req.session.user.username);
  let boards = [];
  if (fs.existsSync(boardDir)) {
    boards = fs.readdirSync(boardDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(boardDir, f), 'utf8'));
          const elements = data.elements || [];
          const typeCounts = {};
          elements.forEach(el => { typeCounts[el.type] = (typeCounts[el.type] || 0) + 1; });
          return {
            name: f.replace('.json', ''),
            elementCount: elements.length,
            connectionCount: (data.connections || []).length,
            lastEdit: data.meta?.lastEdit || null,
            created: data.meta?.created || null,
            typeCounts,
          };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (b.lastEdit || '').localeCompare(a.lastEdit || ''));
  }
  const totalElements = boards.reduce((s, b) => s + b.elementCount, 0);
  const totalConnections = boards.reduce((s, b) => s + b.connectionCount, 0);
  const allTypes = {};
  boards.forEach(b => Object.entries(b.typeCounts).forEach(([t, n]) => { allTypes[t] = (allTypes[t] || 0) + n; }));
  res.json({ boards, totalBoards: boards.length, totalElements, totalConnections, allTypes });
});

// ═══════════════════════════════════════════════════════
//  PUBLIC SHARE API (no auth required)
// ═══════════════════════════════════════════════════════

// Public: fetch shared board data (no auth required)
app.post('/api/share/:token', (req, res) => {
  const token = req.params.token.replace(/[^a-zA-Z0-9]/g, '');
  const { password } = req.body;

  const boardsBase = path.join(__dirname, 'data', 'boards');
  let found = null, foundName = null, foundOwner = null;

  if (fs.existsSync(boardsBase)) {
    outer: for (const userDir of fs.readdirSync(boardsBase)) {
      const userPath = path.join(boardsBase, userDir);
      if (!fs.statSync(userPath).isDirectory()) continue;
      for (const file of fs.readdirSync(userPath).filter(f => f.endsWith('.json'))) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(userPath, file), 'utf8'));
          if (data.meta?.shareToken === token) {
            found = data; foundOwner = userDir; foundName = file.replace('.json', '');
            break outer;
          }
        } catch {}
      }
    }
  }

  if (!found) return res.status(404).json({ error: 'Board not found or sharing disabled' });

  if (found.meta?.sharePasswordHash) {
    if (!password || !bcrypt.compareSync(password, found.meta.sharePasswordHash)) {
      return res.status(401).json({ error: 'Wrong password', needsPassword: true });
    }
  }

  // Strip sensitive fields from meta
  const { sharePasswordHash, shareToken, ...safeMeta } = found.meta || {};
  res.json({
    elements: found.elements || [],
    connections: found.connections || [],
    meta: { ...safeMeta, boardName: foundName, owner: foundOwner },
  });
});

// ═══════════════════════════════════════════════════════
//  GOOGLE OAUTH 2.0 + CALENDAR
// ═══════════════════════════════════════════════════════

const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';

function getRedirectUri(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host  = req.get('x-forwarded-host')  || req.get('host');
  return `${proto}://${host}/api/oauth/google/callback`;
}

function _getGoogleCreds(user) {
  const clientId     = user.googleClientId     || '';
  const clientSecret = user.googleClientSecret || '';
  if (!clientId || !clientSecret) throw new Error('Google credentials not configured');
  return { clientId, clientSecret };
}

async function _refreshGoogleToken(user) {
  const { clientId, clientSecret } = _getGoogleCreds(user);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: user.googleTokens.refreshToken,
      grant_type:    'refresh_token',
    }).toString(),
  });
  if (!r.ok) throw new Error('Google token refresh failed');
  const d = await r.json();
  return { accessToken: d.access_token, expiresAt: Date.now() + (d.expires_in - 60) * 1000 };
}

async function getValidGoogleToken(user) {
  const tokens = user.googleTokens;
  if (!tokens || !tokens.refreshToken) throw new Error('Google Calendar not connected');
  if (tokens.expiresAt && Date.now() < tokens.expiresAt) return tokens.accessToken;

  const { accessToken, expiresAt } = await _refreshGoogleToken(user);
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx >= 0) {
    users[idx].googleTokens.accessToken = accessToken;
    users[idx].googleTokens.expiresAt   = expiresAt;
    saveUsers(users);
  }
  return accessToken;
}

// Save Google credentials (Client ID + Secret) to user profile
app.put('/api/oauth/google/credentials', requireAuth, (req, res) => {
  const { googleClientId, googleClientSecret } = req.body;
  if (!googleClientId || !googleClientSecret) return res.status(400).json({ error: 'Both Client ID and Client Secret are required' });
  const users = loadUsers();
  const idx   = users.findIndex(u => u.id === req.session.user.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });
  users[idx].googleClientId     = googleClientId.trim();
  users[idx].googleClientSecret = googleClientSecret.trim();
  saveUsers(users);
  res.json({ ok: true });
});

// Initiate OAuth flow
app.get('/api/oauth/google', requireAuth, (req, res) => {
  const users = loadUsers();
  const user  = users.find(u => u.id === req.session.user.id);
  let clientId;
  try { ({ clientId } = _getGoogleCreds(user)); } catch {
    return res.status(400).send('Google Client ID not configured. Go to Settings → Calendar and enter your credentials first.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = getRedirectUri(req);
  req.session.oauthState = state;
  req.session.oauthRedirectUri = redirectUri;
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         GOOGLE_SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state,
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

// OAuth callback
app.get('/api/oauth/google/callback', requireAuth, async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code || state !== req.session.oauthState) return res.redirect('/settings?gcal=error');
  delete req.session.oauthState;
  const redirectUri = req.session.oauthRedirectUri || getRedirectUri(req);
  delete req.session.oauthRedirectUri;

  try {
    const users = loadUsers();
    const idx   = users.findIndex(u => u.id === req.session.user.id);
    if (idx < 0) throw new Error('User not found');
    const { clientId, clientSecret } = _getGoogleCreds(users[idx]);

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        code,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }).toString(),
    });
    if (!r.ok) throw new Error('Token exchange failed');
    const d = await r.json();
    users[idx].googleTokens = {
      accessToken:  d.access_token,
      refreshToken: d.refresh_token,
      expiresAt:    Date.now() + (d.expires_in - 60) * 1000,
    };
    saveUsers(users);
    res.redirect('/settings?gcal=connected');
  } catch (e) {
    console.error('Google OAuth callback error:', e.message);
    res.redirect('/settings?gcal=error');
  }
});

// Connection status
app.get('/api/oauth/google/status', requireAuth, (req, res) => {
  const users = loadUsers();
  const user  = users.find(u => u.id === req.session.user.id);
  res.json({
    connected:  !!(user?.googleTokens?.refreshToken),
    configured: !!(user?.googleClientId && user?.googleClientSecret),
  });
});

// Disconnect
app.post('/api/oauth/google/disconnect', requireAuth, (req, res) => {
  const users = loadUsers();
  const idx   = users.findIndex(u => u.id === req.session.user.id);
  if (idx < 0) return res.status(404).json({ error: 'User not found' });
  const token = users[idx].googleTokens?.accessToken;
  delete users[idx].googleTokens;
  saveUsers(users);
  if (token) fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' }).catch(() => {});
  res.json({ ok: true });
});

// List all calendars
app.get('/api/calendar/list', requireAuth, async (req, res) => {
  const users = loadUsers();
  const user  = users.find(u => u.id === req.session.user.id);
  if (!user?.googleTokens?.refreshToken) return res.status(401).json({ error: 'Not connected' });
  try {
    const accessToken = await getValidGoogleToken(user);
    const r = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,summary,backgroundColor)',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!r.ok) throw new Error('Calendar list fetch failed');
    const d = await r.json();
    res.json({ calendars: (d.items || []).map(c => ({ id: c.id, name: c.summary, color: c.backgroundColor })) });
  } catch (e) {
    console.error('Calendar list error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Fetch calendar events for a month
app.get('/api/calendar/events', requireAuth, async (req, res) => {
  const { year, month, calendarId = 'primary' } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year and month required' });

  const users = loadUsers();
  const user  = users.find(u => u.id === req.session.user.id);
  if (!user?.googleTokens?.refreshToken) return res.status(401).json({ error: 'Google Calendar not connected' });

  try {
    const accessToken = await getValidGoogleToken(user);
    const y = parseInt(year), m = parseInt(month) - 1;
    const timeMin = new Date(y, m, 1).toISOString();
    const timeMax = new Date(y, m + 1, 0, 23, 59, 59).toISOString();

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy:      'startTime',
      maxResults:   '250',
      fields:       'items(id,summary,start,end,colorId)',
    });

    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!r.ok) {
      const err = await r.json();
      console.error('Google Calendar API error:', JSON.stringify(err));
      return res.status(502).json({ error: err.error?.message || 'Google Calendar API error', details: err.error });
    }
    const data = await r.json();
    const events = (data.items || []).map(item => ({
      id:      item.id,
      title:   item.summary || '(No title)',
      start:   item.start?.dateTime || item.start?.date || '',
      end:     item.end?.dateTime   || item.end?.date   || '',
      allDay:  !!(item.start?.date),
      colorId: item.colorId,
    }));
    res.json({ events });
  } catch (e) {
    console.error('Calendar events error:', e.message);
    res.status(500).json({ error: e.message || 'Calendar fetch failed' });
  }
});

// ═══════════════════════════════════════════════════════
//  LLM PROXY (server-side, uses stored user API key)
// ═══════════════════════════════════════════════════════
app.post('/api/llm/chat', requireAuth, llmLimiter, async (req, res) => {
  const { messages, model } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const users = loadUsers();
  const user = users.find(u => u.id === req.session.user.id);
  if (!user || !user.llmProvider || !user.llmApiKey) {
    return res.status(400).json({ error: 'No LLM provider configured. Set provider and API key in your profile.' });
  }

  const provider = user.llmProvider;
  const apiKey = user.llmApiKey;
  const resolvedModel = model || user.llmModel || undefined;
  const systemPrompt = user.llmSystemPrompt || '';

  try {
    let responseText = '';

    if (provider === 'anthropic') {
      const effectiveModel = resolvedModel || 'claude-haiku-4-5-20251001';
      const body = { model: effectiveModel, max_tokens: 4096, messages: messages.map(m => ({ role: m.role, content: m.content })) };
      if (systemPrompt) body.system = systemPrompt;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: d.error?.message || 'Anthropic API error' });
      responseText = d.content?.[0]?.text || '';

    } else if (provider === 'openai') {
      const effectiveModel = resolvedModel || 'gpt-4o-mini';
      const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: effectiveModel, messages: msgs }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: d.error?.message || 'OpenAI API error' });
      responseText = d.choices?.[0]?.message?.content || '';

    } else if (provider === 'google') {
      const effectiveModel = resolvedModel || 'gemini-2.0-flash';
      const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const body = { contents };
      if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      );
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: d.error?.message || 'Google API error' });
      responseText = d.candidates?.[0]?.content?.parts?.[0]?.text || '';

    } else if (provider === 'openrouter') {
      const effectiveModel = resolvedModel || 'openai/gpt-4o-mini';
      const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: effectiveModel, messages: msgs }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: d.error?.message || 'OpenRouter API error' });
      responseText = d.choices?.[0]?.message?.content || '';

    } else {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    res.json({ message: responseText });
  } catch (err) {
    console.error('LLM proxy error:', err);
    res.status(500).json({ error: 'LLM request failed: ' + err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  WEBSOCKET — Real-Time Collaboration
// ═══════════════════════════════════════════════════════
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Authenticate WebSocket upgrades using session OR share token
server.on('upgrade', (req, socket, head) => {
  const urlParams = new URLSearchParams((req.url || '').split('?')[1] || '');
  const shareToken = urlParams.get('token');

  if (shareToken) {
    // Anonymous guest connecting via share token
    const cleanToken = shareToken.replace(/[^a-zA-Z0-9]/g, '');
    const boardsBase = path.join(__dirname, 'data', 'boards');
    let foundOwner = null, foundName = null;
    if (fs.existsSync(boardsBase)) {
      outer: for (const userDir of fs.readdirSync(boardsBase)) {
        const userPath = path.join(boardsBase, userDir);
        try { if (!fs.statSync(userPath).isDirectory()) continue; } catch { continue; }
        for (const file of fs.readdirSync(userPath).filter(f => f.endsWith('.json'))) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(userPath, file), 'utf8'));
            if (data.meta?.shareToken === cleanToken) {
              foundOwner = userDir; foundName = file.replace('.json', '');
              break outer;
            }
          } catch {}
        }
      }
    }
    if (!foundOwner) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = { username: `guest`, displayName: 'Guest', role: 'guest' };
      ws.readOnly = true;
      ws.authorizedRoom = `${foundOwner}/${foundName}`;
      wss.emit('connection', ws, req);
    });
    return;
  }

  sessionMiddleware(req, {}, () => {
    if (!req.session?.user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = req.session.user;
      wss.emit('connection', ws, req);
    });
  });
});

const rooms = new Map(); // roomKey ("owner/board") → Set<ws>

function getUserColor(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360},65%,50%)`;
}

function broadcastPresence(room) {
  const clients = rooms.get(room);
  if (!clients) return;
  const users = [...clients]
    .filter(c => !c.readOnly)
    .map(c => ({
      username: c.user.username,
      displayName: c.user.displayName,
      color: getUserColor(c.user.username),
    }));
  const msg = JSON.stringify({ type: 'presence', users });
  // Only send presence to authenticated users (not read-only guests)
  clients.forEach(c => { if (!c.readOnly && c.readyState === 1) c.send(msg); });
}

function broadcastToRoom(room, senderWs, payload) {
  const clients = rooms.get(room);
  if (!clients) return;
  const str = JSON.stringify(payload);
  clients.forEach(c => { if (c !== senderWs && c.readyState === 1) c.send(str); });
}

function leaveRoom(ws) {
  if (!ws.currentRoom) return;
  const room = ws.currentRoom;
  const clients = rooms.get(room);
  if (clients) { clients.delete(ws); if (clients.size === 0) rooms.delete(room); }
  ws.currentRoom = null;
  broadcastPresence(room);
}

wss.on('connection', (ws) => {
  ws.currentRoom = null;

  // Read-only guest: auto-join authorized room and send current state snapshot
  if (ws.readOnly && ws.authorizedRoom) {
    const room = ws.authorizedRoom;
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(ws);
    ws.currentRoom = room;
    // Send current board state as initial snapshot
    const [ownerDir, boardFile] = room.split('/');
    const boardPath = path.join(__dirname, 'data', 'boards', ownerDir, boardFile + '.json');
    if (fs.existsSync(boardPath)) {
      try {
        const bd = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
        ws.send(JSON.stringify({ type: 'state', elements: bd.elements || [], connections: bd.connections || [] }));
      } catch {}
    }
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Guests are read-only — ignore everything they send
    if (ws.readOnly) return;

    if (msg.type === 'join') {
      const parts = (msg.room || '').split('/');
      const cleanOwner = (parts[0] || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const cleanBoard = (parts[1] || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!cleanOwner || !cleanBoard) return;

      const username = ws.user.username;
      const isOwner = cleanOwner === username;
      const isAdmin = ws.user.role === 'admin';

      if (!isOwner && !isAdmin) {
        const boardPath = path.join(__dirname, 'data', 'boards', cleanOwner, cleanBoard + '.json');
        if (!fs.existsSync(boardPath)) return;
        try {
          const data = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
          if (!(data.meta?.collaborators || []).includes(username)) return;
        } catch { return; }
      }

      const room = `${cleanOwner}/${cleanBoard}`;
      if (ws.currentRoom && ws.currentRoom !== room) {
        const prev = rooms.get(ws.currentRoom);
        if (prev) { prev.delete(ws); if (prev.size === 0) rooms.delete(ws.currentRoom); }
        broadcastPresence(ws.currentRoom);
      }
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room).add(ws);
      ws.currentRoom = room;
      broadcastPresence(room);
    }

    if (msg.type === 'state' && ws.currentRoom) {
      broadcastToRoom(ws.currentRoom, ws, {
        type: 'state',
        from: ws.user.username,
        displayName: ws.user.displayName,
        elements: msg.elements,
        connections: msg.connections,
        seq: msg.seq,
      });
    }

    if (msg.type === 'cursor' && ws.currentRoom) {
      broadcastToRoom(ws.currentRoom, ws, {
        type: 'cursor',
        from: ws.user.username,
        displayName: ws.user.displayName,
        x: msg.x,
        y: msg.y,
      });
    }

    if (msg.type === 'leave') leaveRoom(ws);
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

// ═══════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════
migrateBoardKeys();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SAMESAMEBUTDIFFERENT running on port ${PORT}`);
});
