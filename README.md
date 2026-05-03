# SAMESAMEBUTDIFFERENT

Infinite canvas that can do it all.

![Screenshot](screenshot.png)

## Features

### Canvas
- **Infinite Canvas** — Pan, zoom, dot grid, minimap
- **Night Mode** — Full dark theme toggle, persisted per browser
- **Undo/Redo** — Ctrl+Z / Ctrl+Shift+Z, 50-step history
- **Auto-save** — Every 30s + on navigation, JSON-based persistence
- **Export** — PNG snapshot of the canvas

### Elements
- **Text & Headings** — Inline editing, font size, color, alignment, bold/italic/underline
- **Notes** — Sticky notes with color accents (default, blue, green, pink, purple, orange)
- **Images** — Drag & drop upload, resize, zoom, crop (top/right/bottom/left), rotation
- **Files** — Upload & attach files (PDF, video with thumbnail, docs)
- **Shapes** — Rectangles and circles with border + fill color
- **Freehand Draw** — Brush tool with color, size, solid/dashed/dotted stroke
- **Icons & Emoji** — Picker with search, scalable via drag
- **Todo Lists** — Checklist elements with item assignment, inline editing
- **Pins** — Anchor markers on the canvas
- **LLM Chat** — AI chat window connected to Anthropic, OpenAI, Google, or OpenRouter

### Connections
- **Arrows** — Connect any two elements; straight, curved, or threaded style
- **Wide hit areas** — Easy to click and grab lines

### Boards
- **Multiple Boards** — Create, rename, switch, delete
- **Board Sharing** — Generate a shareable link; optional password protection; read-only public view
- **Collaboration** — Real-time multi-user editing via WebSocket
- **Import/Export** — Download and upload board JSON

### Users & Settings
- **User Accounts** — Login, registration (toggleable by admin)
- **Profile Settings** — Display name, email, password change
- **LLM Settings** — Provider (Anthropic / OpenAI / Google / OpenRouter), API key, default model, system prompt
- **Statistics** — Per-board element counts and type breakdown
- **Admin Panel** — User management, board overview, feature request inbox

### Keyboard Shortcuts

| Key | Tool |
|-----|------|
| V | Select |
| H | Pan |
| T | Text |
| E | Heading |
| N | Note |
| R | Rectangle |
| C | Circle |
| A | Arrow |
| D | Todo |
| P | Draw |
| K | Pin |
| G | Icon |
| L | LLM Chat |
| Space | Pan (hold) |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+S | Save |
| Ctrl+0 | Fit all |

## UX & Design Philosophy

The core of **SAMESAMEBUTDIFFERENT** is built around an uncompromising focus on flow, immediacy, and spatial freedom:

- **Unobtrusive Interface:** The UI gets out of the way. Tools and properties only appear contextually when needed, maximising the space for ideas on the infinite canvas.
- **Immediate Feedback:** Every action feels instantaneous because we rely on fast Vanilla JS and native DOM/SVG manipulations instead of heavy frameworks.
- **Keyboard-First Workflow:** Single-key shortcuts for every tool and robust undo/redo let you think and map ideas at the speed of thought.
- **Visual Comfort:** Night Mode and a subtle dot grid provide structure without causing eye strain during long sessions.

## Setup

```bash
npm install
SESSION_SECRET=your-secret-here node server.js
```

Open [http://localhost:3000](http://localhost:3000)

On first run a default admin account is created (`admin` / `admin`) — change the password immediately after setup.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_SECRET` | Yes | Random string used to sign session cookies and derive the at-rest encryption key. Server exits on startup if not set. |
| `NODE_ENV` | No | Set to `production` to enable secure cookie flag (requires HTTPS). |
| `PORT` | No | Port to listen on. Defaults to `3000`. |

Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

> **Note:** `SESSION_SECRET` also derives the encryption key for sensitive data stored at rest (LLM API keys, Google OAuth tokens). Rotating it will invalidate stored keys — users will need to re-enter them.

### Docker / Self-hosted

```bash
docker build -t wollmilchsau .
docker run -p 3000:3000 \
  -e SESSION_SECRET=your-secret-here \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/uploads:/app/uploads \
  wollmilchsau
```

Mount `data` and `uploads` as volumes to persist boards, users, and uploaded files across restarts.

## Stack

Node.js + Express · Vanilla JS · SVG · WebSocket · bcrypt · No build tools
