#!/usr/bin/env node
/**
 * SSBD MCP Server
 * Gives AI tools read/write access to a single SSBD board via a board API key.
 *
 * Config (env vars):
 *   SSBD_URL       — base URL of the SSBD server, e.g. https://boards.example.com
 *   SSBD_OWNER     — board owner username
 *   SSBD_BOARD     — board name
 *   SSBD_KEY       — board API key (ssbd_...)
 *
 * Claude Desktop config example:
 * {
 *   "mcpServers": {
 *     "ssbd": {
 *       "command": "node",
 *       "args": ["/path/to/mcp-server.js"],
 *       "env": {
 *         "SSBD_URL": "https://boards.example.com",
 *         "SSBD_OWNER": "mrtz",
 *         "SSBD_BOARD": "research",
 *         "SSBD_KEY": "ssbd_..."
 *       }
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = (process.env.SSBD_URL || '').replace(/\/$/, '');
const OWNER    = process.env.SSBD_OWNER || '';
const BOARD    = process.env.SSBD_BOARD || '';
const KEY      = process.env.SSBD_KEY   || '';

if (!BASE_URL || !OWNER || !BOARD || !KEY) {
  console.error('Missing required env vars: SSBD_URL, SSBD_OWNER, SSBD_BOARD, SSBD_KEY');
  process.exit(1);
}

const MCP_BASE = `${BASE_URL}/mcp/${OWNER}/${BOARD}`;
const HEADERS  = { 'X-Board-Key': KEY, 'Content-Type': 'application/json' };

async function apiFetch(path, options = {}) {
  const url = path ? `${MCP_BASE}${path}` : MCP_BASE;
  const res = await fetch(url, { ...options, headers: { ...HEADERS, ...(options.headers || {}) } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SSBD API ${res.status}: ${text}`);
  }
  return res.json();
}

async function readBoard() {
  return apiFetch('');
}

async function writeBoard(data) {
  return apiFetch('', { method: 'PUT', body: JSON.stringify(data) });
}

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'read_board',
    description: 'Read the full board — returns all elements and connections.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_elements',
    description: 'List elements on the board, optionally filtered by type.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by element type: text, note, image, rect, circle, arrow, todo, llmchat, heading, file, pin, draw, icon, calendar' },
      },
    },
  },
  {
    name: 'search_elements',
    description: 'Search elements whose text content contains the query string.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for (case-insensitive)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_element',
    description: 'Add a new element to the board. Returns the updated element with its generated id.',
    inputSchema: {
      type: 'object',
      properties: {
        type:    { type: 'string', description: 'Element type: text | note | heading | rect | circle | todo | pin' },
        x:       { type: 'number', description: 'Canvas X position' },
        y:       { type: 'number', description: 'Canvas Y position' },
        width:   { type: 'number', description: 'Width in canvas units' },
        height:  { type: 'number', description: 'Height in canvas units' },
        content: { type: 'string', description: 'Text content of the element' },
        color:   { type: 'string', description: 'Optional color (note accent: blue|green|pink|purple|orange)' },
      },
      required: ['type', 'x', 'y'],
    },
  },
  {
    name: 'update_element',
    description: 'Update properties of an existing element by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id:      { type: 'string', description: 'Element id' },
        updates: { type: 'object', description: 'Key/value pairs to merge into the element' },
      },
      required: ['id', 'updates'],
    },
  },
  {
    name: 'delete_element',
    description: 'Delete an element by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Element id to delete' },
      },
      required: ['id'],
    },
  },
];

// ── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'ssbd', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {

      case 'read_board': {
        const board = await readBoard();
        return { content: [{ type: 'text', text: JSON.stringify(board, null, 2) }] };
      }

      case 'list_elements': {
        const board = await readBoard();
        let elements = board.elements || [];
        if (args.type) elements = elements.filter(e => e.type === args.type);
        return { content: [{ type: 'text', text: JSON.stringify(elements, null, 2) }] };
      }

      case 'search_elements': {
        const board = await readBoard();
        const q = (args.query || '').toLowerCase();
        const matches = (board.elements || []).filter(el => {
          const text = [el.content, el.text, el.title, el.label].filter(Boolean).join(' ').toLowerCase();
          return text.includes(q);
        });
        return { content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }] };
      }

      case 'add_element': {
        const board = await readBoard();
        const id = 'el_mcp_' + Math.random().toString(36).slice(2, 10);
        const el = {
          id,
          type: args.type,
          x: args.x ?? 100,
          y: args.y ?? 100,
          width:   args.width  ?? 200,
          height:  args.height ?? 120,
          content: args.content ?? '',
          ...(args.color ? { color: args.color } : {}),
          zIndex: ((board.elements || []).length + 1),
        };
        const elements = [...(board.elements || []), el];
        await writeBoard({ ...board, elements });
        return { content: [{ type: 'text', text: JSON.stringify(el, null, 2) }] };
      }

      case 'update_element': {
        const board = await readBoard();
        const idx = (board.elements || []).findIndex(e => e.id === args.id);
        if (idx < 0) throw new Error(`Element ${args.id} not found`);
        const updated = { ...board.elements[idx], ...args.updates, id: args.id };
        const elements = [...board.elements];
        elements[idx] = updated;
        await writeBoard({ ...board, elements });
        return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
      }

      case 'delete_element': {
        const board = await readBoard();
        const before = (board.elements || []).length;
        const elements = (board.elements || []).filter(e => e.id !== args.id);
        if (elements.length === before) throw new Error(`Element ${args.id} not found`);
        await writeBoard({ ...board, elements });
        return { content: [{ type: 'text', text: `Deleted element ${args.id}` }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
