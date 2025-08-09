import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
// Load .env for local development; in production Fly.io will provide environment variables.
dotenv.config({ path: "../.env" });
 
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
 
const app = express();
const port = process.env.PORT || 8080;
 
// Allow express to parse JSON bodies
app.use(express.json());

// CORS middleware for Discord Activities
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Allow localhost for development
  if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  // Allow Discord Activity domains
  else if (origin && (origin.includes('discord') || origin.includes('discordapp'))) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  // Allow same origin
  else if (!origin || origin === `${req.protocol}://${req.get('host')}`) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
 
// Serve built client (if present) from /public
// Expose VITE_DISCORD_CLIENT_ID to the client at runtime
app.get('/env.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`window.__ENV__ = { VITE_DISCORD_CLIENT_ID: "${process.env.VITE_DISCORD_CLIENT_ID || ''}" };`);
});

app.use(express.static(path.join(__dirname, "public")));

// Token exchange endpoint - exchanges an OAuth2 code for an access token and returns user info.
app.post("/api/token", async (req, res) => {
  try {
    if (!req.body || !req.body.code) {
      return res.status(400).send({ error: "missing_code" });
    }

    // Exchange the code for an access_token
    const tokenResp = await fetch(`https://discord.com/api/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.VITE_DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: req.body.code,
        redirect_uri: `https://${process.env.VITE_DISCORD_CLIENT_ID}.discordsays.com`,
      }),
    });

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text().catch(() => "");
      console.error("Token endpoint returned error:", tokenResp.status, errBody);
      return res.status(502).send({ error: "token_exchange_failed" });
    }

    const tokenJson = await tokenResp.json();
    const access_token = tokenJson.access_token;
    if (!access_token) {
      console.error("No access_token in token response", tokenJson);
      return res.status(502).send({ error: "token_exchange_failed" });
    }

    // Fetch the user's identity from Discord
    const userResp = await fetch("https://discord.com/api/users/@me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    if (!userResp.ok) {
      const errBody = await userResp.text().catch(() => "");
      console.error("Failed to fetch user info:", userResp.status, errBody);
      return res.status(502).send({ error: "failed_fetch_user" });
    }

    const user = await userResp.json();

    // Return the access_token and user info to the client
    res.send({ access_token, user });
  } catch (err) {
    console.error("Token exchange failed", err);
    res.status(500).send({ error: "token_exchange_failed" });
  }
});

// Create HTTP server and attach websocket server to it
const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws', // Match client's WebSocket endpoint
  // Allow connections from Discord Activity domains
  verifyClient: (info) => {
    const origin = info.origin;
    // Allow localhost for development
    if (origin && (
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.includes('.discord.') ||
        origin.includes('discordapp.com')
    )) {
      return true;
    }
    // Allow Discord Activity domains
    if (origin && (origin.includes('discord') || origin.includes('discordapp'))) {
      return true;
    }
    // Allow same origin
    if (!origin || origin === `${info.req.headers['x-forwarded-proto'] || 'http'}://${info.req.headers.host}`) {
      return true;
    }
    console.log('WebSocket connection rejected from origin:', origin);
    return false;
  }
});

const THEMES = {
 ds9: {
    name: "Star Trek: Deep Space Nine",
    items: [
      "Rule of acquisition",
      "Sexual tension between Odo and Quark",
      "Pretend to be nice to Cardassians",
      "Miles and Keiko disagree / argue",
      "Jake and Nog sit above promenade",
      "Odo shapeshifts",
      "Sisko misgenders Jadzia",
      "Gaslighting",
      "Morn!",
      "Flashing light",
      "Kira in just her tank top",
      "Bashir gets pushed against a wall",
      "Racism",
      "Odo accuses Quark",
      "Sisko sits on his little couch",
      "Odo is authoritarian",
      "Problem could be solved with CCTV",
      "Baseball mentioned / Baseball shown",
      "Prophets mentioned",
      "Wormhole gets used",
      "Odo solves the problem",
      "Dabo girl mentioned",
      "Quark moans",
      "Cardassian politics mentioned"
    ],
  },
};

// In-memory games store
const games = new Map();


function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function createPoolFromTheme(themeKey) {
  const theme = THEMES[themeKey];
  if (!theme || !Array.isArray(theme.items)) return [];
  const pool = theme.items.slice();
  shuffle(pool);
  return pool;
}

function generateCard(themeItems) {
  const card = Array.from({ length: 5 }, () => Array(5).fill(''));
  if (Array.isArray(themeItems) && themeItems.length > 0) {
    const pool = [...themeItems];
    shuffle(pool);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (r === 2 && c === 2) {
          card[r][c] = 0;
          continue;
        }
        card[r][c] = pool.length > 0 ? pool.pop() : themeItems[Math.floor(Math.random() * themeItems.length)];
      }
    }
  } else {
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (r === 2 && c === 2) card[r][c] = 0;
        else card[r][c] = '';
      }
    }
  }
  return card;
}

function getOrCreateGame(gameId = "default") {
  if (!games.has(gameId)) {
    const game = {
      gameId,
      status: "lobby",
      hostId: null,
      players: new Map(),
      numbersCalled: [],
      numberPool: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    games.set(gameId, game);
  }
  return games.get(gameId);
}

function serializeGame(game) {
  return {
    gameId: game.gameId,
    status: game.status,
    hostId: game.hostId,
    themeKey: game.themeName || null,
    themeDisplayName: game.themeName && THEMES[game.themeName] ? THEMES[game.themeName].name : null,
    players: Array.from(game.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      card: p.card,
      marks: p.marks,
    })),
    numbersCalled: game.numbersCalled,
  };
}

function broadcastGame(game) {
  const payload = JSON.stringify({ type: "state", state: serializeGame(game) });
  for (const p of game.players.values()) {
    if (p.socket && p.socket.readyState === p.socket.OPEN) {
      p.socket.send(payload);
    }
  }
}

function sendError(socket, message) {
  if (socket && socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "error", message }));
  }
}

function isCardComplete(player) {
  const marks = player.marks || Array.from({ length: 5 }, () => Array(5).fill(false));
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (r === 2 && c === 2) continue; // free cell
      if (!marks[r][c]) return false;
    }
  }
  return true;
}

// Handle websocket connections
wss.on("connection", (ws) => {
  ws.id = Math.random().toString(36).slice(2, 9);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      return sendError(ws, "invalid_json");
    }

    const { type } = msg;

    if (type === "probe") {
      const { gameId = "default" } = msg;
      if (games.has(gameId)) {
        const g = games.get(gameId);
        ws.send(JSON.stringify({ type: "game_exists", exists: true, state: serializeGame(g) }));
      } else {
        ws.send(JSON.stringify({ type: "game_exists", exists: false }));
      }
      return;
    }

    if (type === "join") {
      const { gameId = "default", name = "Anonymous", theme = null, create = false } = msg;
      // Automatically create the game if it doesn't exist — the first joiner becomes the host.
      let game;
      if (!games.has(gameId)) {
        game = getOrCreateGame(gameId);
      } else {
        game = games.get(gameId);
      }

      // If a theme was provided and the game doesn't already have one, apply it
      if (theme && !game.themeName) {
        if (THEMES[theme]) {
          game.themeName = theme;
          game.themeItems = THEMES[theme].items.slice();
          game.numberPool = createPoolFromTheme(theme);
        } else {
          // Unknown theme; ignore and keep default pool
        }
      }

      // Create player
      const playerId = ws.id;
      const player = {
        id: playerId,
        name,
        socket: ws,
        card: generateCard(game.themeItems),
        marks: Array.from({ length: 5 }, () => Array(5).fill(false)),
      };
      // Free center mark
      player.marks[2][2] = true;

      game.players.set(playerId, player);
      if (!game.hostId) {
        game.hostId = playerId;
      }
      game.updatedAt = Date.now();

      // Attach player.gameId for reconnection handling
      ws.playerId = playerId;
      ws.gameId = gameId;

      // Send initial full state
      ws.send(JSON.stringify({ type: "joined", playerId, state: serializeGame(game) }));

      // Broadcast updated state
      broadcastGame(game);
      return;
    }

    // Other messages require the socket to be associated with a game+player
    const gameId = ws.gameId;
    if (!gameId) return sendError(ws, "not_joined");
    const game = games.get(gameId);
    if (!game) return sendError(ws, "game_not_found");
    const player = game.players.get(ws.playerId);
    if (!player) return sendError(ws, "player_not_found");

    if (type === "mark") {
      const { r, c, marked } = msg;
      if (typeof r !== "number" || typeof c !== "number") return sendError(ws, "invalid_mark");
      player.marks[r][c] = !!marked;
      game.updatedAt = Date.now();
      broadcastGame(game);
      return;
    }


    if (type === "request_bingo") {
      // Validate bingo for this player — themed/watch-party rule: all non-free cells marked.
      const valid = isCardComplete(player);
      if (valid) {
        game.status = "ended";
        game.updatedAt = Date.now();
        const payload = JSON.stringify({ type: "bingo", playerId: player.id, name: player.name });
        for (const p of game.players.values()) {
          if (p.socket && p.socket.readyState === p.socket.OPEN) {
            p.socket.send(payload);
          }
        }
        broadcastGame(game);
      } else {
        sendError(ws, "invalid_bingo");
      }
      return;
    }

    sendError(ws, "unknown_message_type");
  });

  ws.on("close", () => {
    // Remove player from game if present
    const gameId = ws.gameId;
    if (!gameId) return;
    const game = games.get(gameId);
    if (!game) return;
    const pid = ws.playerId;
    game.players.delete(pid);
    // If the host left, elect a new host
    if (game.hostId === pid) {
      const next = game.players.keys().next();
      game.hostId = next.done ? null : next.value;
    }
    game.updatedAt = Date.now();
    broadcastGame(game);
  });
});

server.listen(port, () => {
  console.log(`Server listening at http://localhost:${port} (ws protocol attached)`);
});
