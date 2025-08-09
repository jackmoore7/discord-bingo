// Load from Vite env (dev) or from injected env.js (prod)
let DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;
if (!DISCORD_CLIENT_ID && typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.VITE_DISCORD_CLIENT_ID) {
  DISCORD_CLIENT_ID = window.__ENV__.VITE_DISCORD_CLIENT_ID;
}
const IS_DEVELOPMENT = import.meta.env.DEV || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
import './style.css';
import rocketLogo from '/rocket.png';

// Import the SDK (loaded lazily only when the Activity environment is present)
let discordSdk = null;
// Will eventually store the authenticated user's access_token / auth result
let auth = null;

// Heuristic: detect if we're likely running inside the Discord desktop/mobile in-app webview.
// In that environment redirecting/embedding discord.com for OAuth is typically blocked by CSP.
function isLikelyDiscordInApp() {
  try {
    // Check for DiscordActivity object
    if (typeof window !== 'undefined' && window.DiscordActivity) {
      return true;
    }
    
    // Check for other possible Discord SDK objects
    if (typeof window !== 'undefined' && (window.Discord || window.discord)) {
      return true;
    }
    
    // Mobile detection - Discord mobile apps use specific user agents
    const ua = navigator.userAgent?.toLowerCase() || '';
    if (ua.includes('discord')) {
      return true;
    }
    
    // Check for Discord-specific domains
    if (location.hostname.includes('discordsays.com') || location.hostname.includes('discordapp.io')) {
      return true;
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

// Watch for the Activity environment becoming available early (some hosts inject it after page load).
// When detected, immediately add the css marker class so dark-mode styles apply before the UI renders.
// Extended timeout and additional diagnostics added to aid debugging when injection is delayed.
// Listen for the DiscordActivity object being injected
window.addEventListener('load', () => {
  // Check immediately after load
  if (window.DiscordActivity) {
    console.log('DiscordActivity found immediately after load');
    handleDiscordActivityDetected();
    return;
  }
  
  // Also check after a short delay
  setTimeout(() => {
    if (window.DiscordActivity) {
      console.log('DiscordActivity found after short delay');
      handleDiscordActivityDetected();
    }
  }, 1000);
});

function handleDiscordActivityDetected() {
  console.group("Discord Activity Detected — Raw Object Dump");
  console.log('Discord Activity object details:', window.DiscordActivity);
  console.log('typeof DiscordActivity:', typeof window.DiscordActivity);
  try {
    console.log('DiscordActivity keys:', Object.keys(window.DiscordActivity));
    console.dir(window.DiscordActivity, { depth: null });
  } catch (err) {
    console.warn('Error introspecting DiscordActivity keys:', err);
  }
  console.groupEnd();
  console.log('Discord Activity environment detected');
  try { document.documentElement.classList.add('discord-embed'); } catch (e) {}
  // Initialize SDK immediately when DiscordActivity is detected
  setupDiscordSdk().catch(e => console.error('Discord SDK setup failed:', e));
}

(function watchForDiscordActivity(deadlineMs = 10000, intervalMs = 100) {
  if (typeof window === 'undefined') return;
  const start = Date.now();
  try {
    console.log('Discord Activity watcher starting', { deadlineMs, intervalMs, userAgent: navigator.userAgent, host: location.host });
  } catch (e) {
    // navigator or location may be unavailable in some contexts; ignore
  }

  // If we strongly detect that we're inside the Discord client, initialize immediately
  // instead of polling for an injected Activity object. This avoids noisy timeout logs
  // when the host doesn't inject window.DiscordActivity but the embedded SDK still works.
  const earlyDiscordHint = () => (
    location.hostname.includes('discordsays.com') ||
    location.hostname.includes('discordapp.io') ||
    isLikelyDiscordInApp()
  );

  if (earlyDiscordHint()) {
    console.log('Likely Discord in-app environment detected — initializing SDK immediately.');
    try { document.documentElement.classList.add('discord-embed'); } catch (e) {}
    setupDiscordSdk().catch(e => console.error('Discord SDK setup failed:', e));
    return;
  }

  function check() {
    // If the Activity object appears, use the existing handler which also adds diagnostic logs.
    if (window.DiscordActivity) {
      handleDiscordActivityDetected();
      return;
    }

    // Log what's available on window for debugging (but only once)
    if (!window._discordDebugLogged) {
      window._discordDebugLogged = true;
      try {
        console.log('Window keys (first 100):', Object.keys(window).slice(0, 100));
        const discordKeys = Object.keys(window).filter(key => key.toLowerCase().includes('discord'));
        if (discordKeys.length > 0) {
          console.log('Potential Discord-related keys on window:', discordKeys);
        }
      } catch (e) { /* ignore */ }
    }

    // Check for alternative Discord SDK objects that might be injected
    if (window.Discord || window.discord) {
      console.log('Alternative Discord object detected:', window.Discord || window.discord);
      try { document.documentElement.classList.add('discord-embed'); } catch (e) {}
      // Initialize SDK with the alternative object
      setupDiscordSdk().catch(e => console.error('Discord SDK setup failed:', e));
      return;
    }

    // Continue watching if deadline hasn't been reached
    if (Date.now() - start < deadlineMs) {
      setTimeout(check, intervalMs);
    } else {
      // Timeout reached: don't spam noisy diagnostics. If we still have a strong hint
      // that this is a Discord in-app environment, try initializing anyway.
      try {
        const likely = isLikelyDiscordInApp();
        if (likely) {
          console.log('Timeout reached but environment appears to be Discord in-app — attempting SDK initialization.');
          setupDiscordSdk().catch(e => console.error('Final setupDiscordSdk after timeout failed:', e));
        } else {
          // Not a Discord environment — surface a single quiet message for debugging.
          console.info('Discord Activity object not injected and environment does not appear to be Discord in-app.');
        }
      } catch (e) {
        console.info('Discord Activity watcher timed out (diagnostics unavailable).');
      }
    }
  }
  check();
})();

// If we're embedded in Discord, add the embed marker immediately so styles are applied
// as early as possible (prevents a flash of the host/light theme before the SDK loads).
if (typeof window !== 'undefined' && window.DiscordActivity) {
  try { document.documentElement.classList.add('discord-embed'); } catch (e) {}
}

async function setupDiscordSdk() {
  // Loading/overlay helpers injected by the client so we can show a friendly "waiting" state
  // when the Activity environment / SDK is taking longer than expected to appear.
  function ensureLoadingOverlay() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('loadingOverlay')) return;

    // Create simple loading overlay
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'loading-overlay';

    overlay.innerHTML = `
      <div class="loading-content" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <div class="loading-text">Waiting for Discord environment…</div>
      </div>
    `;
    const appRoot = document.getElementById('app');
    if (appRoot && appRoot.parentNode) {
      appRoot.parentNode.insertBefore(overlay, appRoot);
    } else {
      document.body.appendChild(overlay);
    }

    // Inject minimal styles (only once)
    if (!document.getElementById('discord-activity-loading-styles')) {
      const style = document.createElement('style');
      style.id = 'discord-activity-loading-styles';
      style.textContent = `
        .loading-overlay {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(4,8,14,0.75);
          z-index: 9999;
          backdrop-filter: blur(4px);
        }
        .loading-overlay.hidden { display: none; }
        .loading-content {
          display: flex;
          gap: 12px;
          align-items: center;
          padding: 18px 22px;
          background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02));
          border-radius: 10px;
          box-shadow: 0 6px 30px rgba(2,6,23,0.6);
          color: #e6eef8;
          font-family: inherit;
        }
        .loading-text { font-size: 1rem; opacity: 0.95; }
        .spinner {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 3px solid rgba(255,255,255,0.08);
          border-top-color: rgba(99,102,241,0.85);
          animation: spin 900ms linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .spinner { animation: none; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  function showLoading(message) {
    try {
      ensureLoadingOverlay();
      const el = document.getElementById('loadingOverlay');
      if (!el) return;
      const text = el.querySelector('.loading-text');
      if (text && message) text.textContent = message;
      el.classList.remove('hidden');
    } catch (e) { /* ignore */ }
  }

  function hideLoading() {
    try {
      const el = document.getElementById('loadingOverlay');
      if (!el) return;
      el.classList.add('hidden');
    } catch (e) { /* ignore */ }
  }

  // Check if we're in a Discord environment even if DiscordActivity object isn't available
  const isDiscordEnvironment = (
    location.hostname.includes('discordsays.com') ||
    location.hostname.includes('discordapp.io') ||
    isLikelyDiscordInApp()
  );

  // Show a loading state when attempting SDK initialization so users don't see timeout-like logs only.
  if (isDiscordEnvironment) {
    showLoading('Waiting for OAuth...');
  }

  if (!window.DiscordActivity && isDiscordEnvironment) {
    console.log("Discord Activity object not found, but we're in a Discord environment. Attempting to initialize SDK anyway...");
    // We'll try to initialize the SDK even without the DiscordActivity object
    // This might work if the SDK can be loaded independently
  } else if (!window.DiscordActivity) {
    console.group("Discord Activity Environment Debug");
    console.error("Discord Activity object NOT found on window.");
    console.log("----- PAGE LOCATION & URL INFO -----");
    console.log("Location.href:", location.href);
    console.log("Location.origin:", location.origin);
    console.log("Location.host:", location.host);
    const searchParams = Object.fromEntries(new URLSearchParams(location.search).entries());
    console.log("Search params:", searchParams);
    console.log("Has instance_id:", !!searchParams.instance_id, "Value:", searchParams.instance_id);
    console.log("Has location_id:", !!searchParams.location_id, "Value:", searchParams.location_id);
    console.log("Has launch_id:", !!searchParams.launch_id, "Value:", searchParams.launch_id);
    console.log("Has guild_id:", !!searchParams.guild_id, "Value:", searchParams.guild_id);
    console.log("Has channel_id:", !!searchParams.channel_id, "Value:", searchParams.channel_id);
    console.log("----- BROWSER & ENVIRONMENT INFO -----");
    console.log("User agent:", navigator.userAgent);
    console.log("Window keys:", Object.keys(window));
    console.log("Window location object dump:", window.location);
    console.log("Navigator object dump:", navigator);
    console.log("----- APP CONFIG INFO -----");
    console.log("IS_DEVELOPMENT flag:", IS_DEVELOPMENT);
    console.log("VITE_DISCORD_CLIENT_ID (import.meta.env):", import.meta.env?.VITE_DISCORD_CLIENT_ID);
    console.log("window.__ENV__:", window.__ENV__);
    console.log("----- FRAME & EMBED INFO -----");
    try {
      console.log("Is in an iframe:", window.self !== window.top);
    } catch(e) {
      console.warn("Unable to check iframe status:", e);
    }
    console.log("Parent window origin (if accessible):", (() => { try { return window.parent.origin; } catch(e) { return "inaccessible"; } })());
    console.log("Frame element:", window.frameElement);
    console.groupEnd();
    const error = new Error("Discord Activity environment not present — cannot initialize SDK.");
    console.error("setupDiscordSdk failed:", error);
    hideLoading();
    throw error;
  }

  // Validate Discord Client ID
  if (!DISCORD_CLIENT_ID) {
    console.error("DISCORD_CLIENT_ID is not configured");
    logMessage('Discord Client ID is not configured. Please check your environment variables.', 'error');
    hideLoading();
    return;
  }

  // Detailed logging for debugging embedded auth
  console.log("Initializing Discord Embedded SDK...", { clientId: DISCORD_CLIENT_ID });

  try {
    const { DiscordSDK } = await import("@discord/embedded-app-sdk");
    discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);

    // Wait for the SDK to be ready
    console.log("Waiting for Discord SDK to be ready...");
    await discordSdk.ready();
    console.log("Discord SDK ready");

    // Immediately mark the document as embedded so CSS can apply without flash
    try {
      document.documentElement.classList.add('discord-embed');
      console.log("Added discord-embed class to document");
    } catch (e) {
      console.warn("Failed to add discord-embed class", e);
    }

    // Run authorize -> token exchange -> authenticate flow and log each step
    let authResult;
    try {
      console.log("Starting Discord authorization...");
      authResult = await discordSdk.commands.authorize({
        client_id: DISCORD_CLIENT_ID,
        response_type: "code",
        state: "",
        prompt: "none",
        // For Discord Activities, we don't need to specify a redirect_uri
        scope: [
          "identify",
          "guilds",
          "applications.commands"
        ],
      });
      console.log("Discord authorization successful:", authResult);
    } catch (err) {
      console.error("discordSdk.commands.authorize failed:", err);
      logMessage('Discord authorization failed. Please try again.', 'error');
      throw new Error(`Authorization failed: ${err.message}`);
    }

    if (!authResult || !authResult.code) {
      console.error("No authorization code returned from authorize()", authResult);
      logMessage('Discord authorization did not return a valid code.', 'error');
      return;
    }
    const { code } = authResult;

    // Exchange the code with our server
    let tokenResp;
    try {
      console.log("Exchanging authorization code for token...");
      tokenResp = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
    } catch (err) {
      console.error("Network error while exchanging code:", err);
      logMessage('Network error during token exchange. Please check your connection.', 'error');
      return;
    }

    if (!tokenResp.ok) {
      const txt = await tokenResp.text().catch(() => "<no body>");
      console.error("Token exchange failed:", tokenResp.status, txt);
      logMessage(`Token exchange failed: ${tokenResp.status}. Please try again.`, 'error');
      return;
    }
    const tokenJson = await tokenResp.json();
    console.log("Token exchange successful");

    const access_token = tokenJson.access_token;
    if (!access_token) {
      console.error("No access_token returned from token endpoint", tokenJson);
      logMessage('No access token received from server.', 'error');
      return;
    }

    // Authenticate the SDK with the returned access token
    try {
      console.log("Authenticating with Discord SDK...");
      auth = await discordSdk.commands.authenticate({ access_token });
      console.log("Discord SDK authentication successful");
    } catch (err) {
      console.error("discordSdk.commands.authenticate failed:", err);
      logMessage('Discord SDK authentication failed. Please try again.', 'error');
      return;
    }

    if (!auth) {
      console.error("Authenticate returned null/undefined", auth);
      logMessage('Discord authentication returned invalid result.', 'error');
      return;
    }

    // Use the authenticated user (authenticate response preferred)
    const user = (auth && auth.user) ? auth.user : (tokenJson.user || null);
    if (user) {
      myName = user.username;
      const nameInput = document.getElementById('nameInput');
      if (nameInput) nameInput.value = myName;
      logMessage(`Successfully signed in as ${myName}`, 'success');

      // Enable the join button now that we're authenticated
      const joinBtnEl = document.getElementById('joinBtn');
      if (joinBtnEl) {
        joinBtnEl.disabled = false;
      }

      // Do NOT auto-join. User should choose when to join and which theme to use.
    } else {
      console.warn("No user info available after authenticate/token exchange", { auth, tokenJson });
      logMessage('No user information received from Discord.', 'warn');
    }
    
    // Append the voice channel name (extra functionality)
    appendVoiceChannelName();
  } catch (err) {
    // Surface detailed error information to console for debugging
    console.error("setupDiscordSdk failed:", err);
    logMessage(`Discord SDK setup failed: ${err.message}`, 'error');
  } finally {
    // Always hide the loading overlay when we're done attempting initialization
    try { hideLoading(); } catch (e) {}
  }
}

document.querySelector('#app').innerHTML = `
  <div>
    <img src="${rocketLogo}" class="logo" alt="Discord" />
    <h1>Hello, World!</h1>
  </div>
`;

const WS_URL = (() => {
  // For Discord Activities, always use secure WebSocket (wss) when in production
  // Discord Activities are served over HTTPS
  if (typeof window !== 'undefined' && window.DiscordActivity) {
    return `wss://${location.host}/ws`;
  }
  // Use the same origin as the page so the websocket connects to the server
  // served from the same host/port. Use wss when the page is https.
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
})();
let ws = null;
let playerId = null;
let state = null;
let myName = `Player-${Math.floor(Math.random() * 900 + 100)}`;

function createUI() {
  const app = document.querySelector('#app');

  app.innerHTML = `
    <div class="container">
      <header>
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="${rocketLogo}" class="logo" alt="Bingo logo" />
          <h1>Bingo Activity</h1>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
          <div id="themeDisplay" style="font-size:0.9em;opacity:0.8;"></div>
          ${IS_DEVELOPMENT ? '<div style="font-size:0.8em;opacity:0.7;color:#ffa500;">Development Mode</div>' : ''}
        </div>
      </header>
      <section id="lobby" class="panel">
        <div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-bottom:8px;flex-wrap:wrap;">
          <input id="nameInput" placeholder="Your name" value="${myName}" />
          <span id="channelInfo" style="font-size:0.9em;opacity:0.85;margin-left:6px;"></span>
          <select id="themeSelect">
            <option value="ds9">Star Trek: Deep Space Nine</option>
          </select>
          <div style="display:flex;gap:8px;align-items:center;">
            <button id="joinBtn">Join Game</button>
          </div>
        </div>
        <div id="players" class="players"></div>
      </section>
  
      <section id="game" class="panel hidden">
        <div class="controls">
          <button id="bingoBtn">Call Bingo</button>
          <div id="calledNumbers" class="called"></div>
          <div id="themeNote" class="theme-note" style="margin-top:8px;font-size:0.9em;opacity:0.9;"></div>
        </div>
        <div id="boards" class="boards"></div>
      </section>
  
      <!-- Compact log toggle helps free vertical space on mobile -->
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button id="msgToggleBtn" class="compact-toggle" aria-pressed="false" title="Toggle compact message log">Compact Log</button>
      </div>
      <div id="messages" class="messages"></div>
    </div>
  `;
  
  document.getElementById('joinBtn').addEventListener('click', joinGame);
  document.getElementById('bingoBtn').addEventListener('click', callBingo);
  
  // Add Discord auth button listener if present
  const discordAuthBtn = document.getElementById('discordAuthBtn');
  if (discordAuthBtn) {
    discordAuthBtn.addEventListener('click', () => {
      console.log('Manual Discord auth triggered');
      startDiscordAuth();
    });
  }
  
  // Show the current channel/game id context so players know which channel is used.
  try {
    const channelInfoEl = document.getElementById('channelInfo');
    if (channelInfoEl) {
      const gid = getGameIdFromContext();
      channelInfoEl.textContent = `Channel ID: ${gid}`;
    }
  } catch (e) { /* ignore */ }
  
  // Compact messages toggle - initialize based on screen size and wire up button
  (function initMessageToggle() {
    const msgToggleBtn = document.getElementById('msgToggleBtn');
    const messagesEl = document.getElementById('messages');
    if (!msgToggleBtn || !messagesEl) return;
    // Default to compact on narrow screens
    const preferCompact = (window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
    if (preferCompact) messagesEl.classList.add('compact');
    msgToggleBtn.textContent = messagesEl.classList.contains('compact') ? 'Expand Log' : 'Compact Log';
    msgToggleBtn.setAttribute('aria-pressed', String(messagesEl.classList.contains('compact')));
    msgToggleBtn.addEventListener('click', () => {
      const isCompact = messagesEl.classList.toggle('compact');
      msgToggleBtn.textContent = isCompact ? 'Expand Log' : 'Compact Log';
      msgToggleBtn.setAttribute('aria-pressed', String(isCompact));
    });
  })();
  
  // If embedded in Discord and not yet authenticated via the Embedded SDK, prevent joining.
  // This enforces: "The user should not be able to play the activity if they aren't in the discord sdk."
  const isEmbedded = (typeof window !== 'undefined' && window.DiscordActivity);
  if (isEmbedded && !auth) {
    const joinBtnEl = document.getElementById('joinBtn');
    if (joinBtnEl) {
      joinBtnEl.disabled = true;
      logMessage('You must sign into Discord (via the embedded client) to join this activity.', 'warn');
      // Attempt to initialize the SDK/auth flow (non-blocking)
      setupDiscordSdk().catch(() => {});
    }
  }
}

function logMessage(msg, type = 'info') {
  const el = document.getElementById('messages');
  const node = document.createElement('div');
  node.className = `msg ${type}`;
  node.textContent = msg;
  el.prepend(node);
}

function connectWS(onOpen) {
  ws = new WebSocket(WS_URL);
  ws.addEventListener('open', () => {
    logMessage('WebSocket connected');
    if (onOpen) onOpen();
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  });
  ws.addEventListener('close', () => {
    logMessage('WebSocket disconnected', 'warn');
    // show reconnect UI
    setTimeout(() => {
      logMessage('Reconnecting...');
      connectWS();
    }, 1500);
  });
  ws.addEventListener('error', (e) => {
    console.error('ws error', e);
  });
}

async function joinGame() {
  // When embedded in Discord, require the Embedded SDK authentication before allowing join.
  if (typeof window !== 'undefined' && window.DiscordActivity) {
    if (!auth) {
      logMessage('Cannot join: you must be signed into Discord via the embedded client.', 'error');
      // Try to (re)initialize SDK/auth flow; this will prompt the embed to authenticate.
      setupDiscordSdk().catch(()=>{});
      return;
    }
  }

  myName = document.getElementById('nameInput').value || myName;
  const gameId = getGameIdFromContext();

  try {
    const probe = await sendProbe(gameId);
    if (probe && probe.exists) {
      // Join existing game in this channel
      sendJoin();
    } else {
      // No game running in this channel — automatically create and join as the host.
      logMessage('No existing game in channel — creating a new game and joining as host.', 'info');
      sendJoin({ create: true });
    }
  } catch (err) {
    console.error('Error probing/joining game', err);
    // Fallback: attempt a normal join (server will create if necessary)
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectWS(() => sendJoin({ create: true }));
    } else {
      sendJoin({ create: true });
    }
  }
}

let pendingProbeResolve = null;
let pendingProbeTimer = null;

function getGameIdFromContext() {
  // Prefer Discord SDK channel id if available
  try {
    if (discordSdk && discordSdk.channelId) return String(discordSdk.channelId);
  } catch (e) {}
  // Try URL params
  const params = new URLSearchParams(location.search);
  if (params.get('channel_id')) return params.get('channel_id');
  if (params.get('channelId')) return params.get('channelId');
  // Fallback
  return 'default';
}

function sendProbe(gameId) {
  return new Promise((resolve) => {
    // Ensure websocket connected before probing
    function doProbe() {
      pendingProbeResolve = resolve;
      if (pendingProbeTimer) clearTimeout(pendingProbeTimer);
      pendingProbeTimer = setTimeout(() => {
        if (pendingProbeResolve) {
          pendingProbeResolve({ exists: false });
          pendingProbeResolve = null;
          pendingProbeTimer = null;
        }
      }, 1200);
      ws.send(JSON.stringify({ type: "probe", gameId }));
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectWS(() => doProbe());
    } else {
      doProbe();
    }
  });
}

function sendJoin(opts = {}) {
  const themeEl = document.getElementById('themeSelect');
  const theme = themeEl ? themeEl.value : null;
  const gameId = getGameIdFromContext();
  const payload = { type: "join", gameId, name: myName };
  if (theme) payload.theme = theme;
  if (opts.create) payload.create = true;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWS(() => {
      ws.send(JSON.stringify(payload));
    });
  } else {
    ws.send(JSON.stringify(payload));
  }
}


function callBingo() {
  // Require embedded Discord authentication when running as an Activity.
  if (typeof window !== 'undefined' && window.DiscordActivity) {
    if (!auth) {
      logMessage('Cannot call Bingo: you must be signed into Discord via the embedded client.', 'error');
      setupDiscordSdk().catch(()=>{});
      return;
    }
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "request_bingo" }));
}

/* Start OAuth flow with Discord by redirecting the browser to the authorize URL.
   Uses the Vite-provided client id at build-time: import.meta.env.VITE_DISCORD_CLIENT_ID
*/
function startDiscordAuth() {
  // Non-embedded browser fallback for OAuth — if embedded, do nothing.
  if (window.DiscordActivity) return;
  const clientId = DISCORD_CLIENT_ID;
  if (!clientId) {
    // Only warn in non-embedded browsers where the developer may need to configure env.
    console.warn('Discord client ID not configured');
    return;
  }
  const url = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=identify`;
  // Try to open in a new top-level window/tab so we don't attempt a navigation inside an embedded/frame context.
  // This is less likely to be blocked by CSP or the host app.
  try {
    const w = window.open(url, '_blank', 'noopener');
    if (!w) {
      // Popup blocked or not allowed; fall back to changing location in non-embedded contexts.
      window.location.href = url;
    }
  } catch (e) {
    // As a last resort, navigate the current window (for normal browsers).
    window.location.href = url;
  }
}

/* Exchange the OAuth code with the server to obtain an access token and user info.
   The server's /api/token endpoint now returns { access_token, user }.
   On success we prefill the name input with the Discord username and auto-join.
*/
async function exchangeCode(code) {
  try {
    const resp = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!resp.ok) throw new Error('token_exchange_failed');
    const json = await resp.json();
    if (json.user) {
      const user = json.user;
      myName = user.username;
      const nameInput = document.getElementById('nameInput');
      if (nameInput) nameInput.value = myName;
      logMessage(`Signed in as ${myName}`, 'success');
      // Do not auto-join after OAuth flow. Enable join button for manual join.
      const joinBtnEl = document.getElementById('joinBtn');
      if (joinBtnEl) joinBtnEl.disabled = false;
    } else {
      logMessage('Discord sign-in did not return user info', 'error');
    }
  } catch (err) {
    console.error(err);
    logMessage('Discord sign-in failed', 'error');
  }
}

/* Handle incoming messages */
function handleMessage(msg) {
  if (msg.type === 'game_exists') {
    if (typeof pendingProbeResolve === 'function') {
      const exists = !!msg.exists;
      const state = msg.state || null;
      pendingProbeResolve({ exists, state });
      if (pendingProbeTimer) { clearTimeout(pendingProbeTimer); pendingProbeTimer = null; }
      pendingProbeResolve = null;
    }
    return;
  }

  if (msg.type === 'joined') {
    playerId = msg.playerId;
    state = msg.state;
    renderFromState();
    document.getElementById('game').classList.remove('hidden');
    document.getElementById('lobby').classList.add('hidden');
    logMessage(`Joined as ${myName}`, 'success');
    return;
  }

  if (msg.type === 'state') {
    state = msg.state;
    renderFromState();
    return;
  }

  // 'drawn' events are not used in themed/watch-party games; ignore if received.

  if (msg.type === 'bingo') {
    const winnerName = msg.name;
    logMessage(`BINGO! Winner: ${winnerName}`, 'success');
    if (state) state.status = 'ended';
    renderFromState();
    
    // Trigger confetti animation for win celebration
    triggerConfetti();
    return;
  }

  if (msg.type === 'error') {
    logMessage(`Error: ${msg.message}`, 'error');
    return;
  }
}

function renderFromState() {
  if (!state) return;
  // Show theme in header if present
  const themeDisplay = document.getElementById('themeDisplay');
  if (themeDisplay) {
    themeDisplay.textContent = state.themeDisplayName ? `Theme: ${state.themeDisplayName}` : '';
  }

  // Players
  const playersEl = document.getElementById('players');
  playersEl.innerHTML = '<h3>Players</h3>';
  const ul = document.createElement('ul');
  for (const p of state.players) {
    const li = document.createElement('li');
    li.textContent = `${p.name}${p.id === state.hostId ? ' (host)' : ''}${p.id === playerId ? ' — you' : ''}`;
    ul.appendChild(li);
  }
  playersEl.appendChild(ul);

  // Called numbers (works for numeric or themed strings)
  const calledEl = document.getElementById('calledNumbers');
  calledEl.innerHTML = '<strong>Called:</strong> ' + (state.numbersCalled || []).join(', ');

  // Boards — render only this player's card for simplicity
  const boardsEl = document.getElementById('boards');
  boardsEl.innerHTML = '';
  const me = state.players.find(p => p.id === playerId);
  if (!me) return;
  const board = buildBoardElement(me);
  boardsEl.appendChild(board);

  // Bingo button state
  const bingoBtn = document.getElementById('bingoBtn');
  if (bingoBtn) bingoBtn.disabled = state.status === 'ended';
}

function buildBoardElement(player) {
  // Render a regular table on desktop, but use a CSS-grid "mobile-friendly"
  // layout on narrow screens to avoid odd table rendering in some webviews.
  const wrapper = document.createElement('div');
  wrapper.className = 'board';

  // Determine whether to render the mobile-friendly grid based on viewport width.
  // Use matchMedia so the choice adapts to the user's device and orientation.
  const isMobileGrid = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width:640px)').matches);

  // Helper to create interactive cell behavior (shared between table and grid)
  function createInteractiveCell(el, r, c, text, isFree) {
    el.classList.add('cell');
    if (isFree) {
      el.classList.add('free-cell');
      el.setAttribute('aria-disabled', 'true');
      el.style.cursor = 'default';
    } else {
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.addEventListener('click', () => toggleMarkUI(r, c, el));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          toggleMarkUI(r, c, el);
        }
      });
      el.addEventListener('touchstart', () => el.classList.add('pulse'));
      el.addEventListener('touchend', () => setTimeout(() => el.classList.remove('pulse'), 120));
    }

    // content wrapper for consistent centering/wrapping
    const inner = document.createElement('div');
    inner.className = 'cell-inner';
    inner.textContent = text;
    el.appendChild(inner);

    const marked = player.marks && player.marks[r] && player.marks[r][c];
    if (marked || (r === 2 && c === 2)) el.classList.add('marked');
  }

  function toggleMarkUI(r, c, el) {
    // local UI pulse + vibrate
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {}
    el.classList.add('pulse');
    setTimeout(() => el.classList.remove('pulse'), 180);

    // send to server
    if (ws && ws.readyState === WebSocket.OPEN) {
      const currentlyMarked = !!(player.marks && player.marks[r] && player.marks[r][c]);
      const newMarked = !currentlyMarked;
      ws.send(JSON.stringify({ type: "mark", r, c, marked: newMarked }));
    } else {
      console.warn('WebSocket not ready, cannot send mark');
    }
  }

    // Always render a responsive CSS grid — this provides consistent behavior
    // across embedded webviews (Discord mobile/desktop) and avoids table-layout
    // quirks that cause cramped cells in some hosts.
    const grid = document.createElement('div');
    grid.className = 'board-grid';
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const cellEl = document.createElement('div');
        const cellText = player.card[r][c] === 0 ? 'FREE' : String(player.card[r][c]);
        createInteractiveCell(cellEl, r, c, cellText, r === 2 && c === 2);
        grid.appendChild(cellEl);
      }
    }
    wrapper.appendChild(grid);
    return wrapper;
}

// If the page was loaded with an OAuth code (Discord redirect), exchange it and auto-join.
(function handleOAuthCodeOnLoad() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code) {
    // Remove the code param from the URL to keep things clean
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    exchangeCode(code);
  }
})();

// Initialize UI and connections
createUI();

// Initialize the Embedded SDK only when appropriate:
// - If the Activity environment is already present, initialize immediately.
// - If we are likely running inside the Discord client (in-app) but the Activity object
//   is not yet injected, do NOT run the OAuth fallback; wait for the watcher to call setupDiscordSdk().
// - Otherwise (regular browser), initialize which may use the OAuth fallback.
// Check if we're in a Discord Activity environment and initialize SDK
// We'll use a more flexible detection that accounts for delayed injection
const isDiscordActivityEnvironment = (
  location.hostname.includes('discordsays.com') ||
  location.hostname.includes('discordapp.io') ||
  (typeof window !== 'undefined' && window.DiscordActivity) ||
  isLikelyDiscordInApp()
);

if (isDiscordActivityEnvironment) {
  console.log('Discord Activity environment detected, initializing SDK...');
  // Show a loading UI so users understand we're waiting for the embed/SDK
  try { showLoading('Waiting for Discord environment…'); } catch (e) {}
  // Even if window.DiscordActivity isn't immediately available, start the watcher
  // which will initialize the SDK when the object is injected
  if (typeof window !== 'undefined' && window.DiscordActivity) {
    setupDiscordSdk().catch(e => {
      console.warn("Discord SDK setup failed:", e);
    });
  } else {
    console.log('DiscordActivity object not yet available, waiting for injection...');
    // The watcher function will handle initialization when the object is available
  }
} else {
  console.error('This app can only run inside Discord Activities. Activity environment not detected.');
  logMessage('Error: This app only runs inside Discord Activities. Please launch it as a Discord Activity.', 'error');
}

connectWS();

// Example function: Append the current voice channel name
async function appendVoiceChannelName() {
  const app = document.querySelector('#app');

  let activityChannelName = 'Unknown';

  // Requesting the channel in GDMs (when the guild ID is null) requires dm_channels.read scope (not currently included)
  if (discordSdk && discordSdk.channelId != null && discordSdk.guildId != null) {
    try {
      const channel = await discordSdk.commands.getChannel({ channel_id: discordSdk.channelId });
      if (channel && channel.name != null) {
        activityChannelName = channel.name;
      }
    } catch (err) {
      console.warn('Failed to get channel info via SDK:', err);
    }
  }

  const textTagString = `Activity Channel: "${activityChannelName}"`;
  const textTag = document.createElement('p');
  textTag.textContent = textTagString;
  app.appendChild(textTag);
}

// After SDK setup, append channel name if authenticated
// This will be called from within setupDiscordSdk when authentication is successful

// Confetti animation for win celebration
function triggerConfetti() {
  const colors = ['#6366f1', '#34d399', '#f87171', '#fbbf24', '#60a5fa'];
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  for (let i = 0; i < 150; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.left = `${Math.random() * 100}vw`;
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDuration = `${Math.random() * 3 + 2}s`;
    container.appendChild(confetti);
  }

  setTimeout(() => {
    container.remove();
  }, 5000);
}
