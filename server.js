
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

const WORLD_WIDTH = 1000;
const START_Y = 10;
const POINT_SPACING_MIN = 100;
const POINT_SPACING_MAX = 180;
const POINTS_AHEAD = 3500;
const POINTS_BEHIND = 700;
const PLAYER_SPEED = 260;
const GRAPPLE_RANGE = 650;
const WALL_HOP_FORCE = 420;
const MAX_WALL_HOPS = 5;

const SHOP_ITEMS = [
  { id: "green", name: "Green", color: "#55ff77", cost: 0 },
  { id: "blue", name: "Blue", color: "#55aaff", cost: 10 },
  { id: "pink", name: "Pink", color: "#ff66cc", cost: 20 },
  { id: "purple", name: "Purple", color: "#bb66ff", cost: 35 },
  { id: "gold", name: "Gold", color: "#ffcc33", cost: 50 }
];

const players = new Map();
const grapplePoints = new Map();
const bots = new Map();
let nextPointId = 1;
let nextBotId = 1;
let worldSeed = Math.floor(Math.random() * 2147483647);

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function hashRandom(seed) {
  let value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function getPointX(index) {
  return 60 + hashRandom(index + worldSeed) * (WORLD_WIDTH - 120);
}

function getPointY(index) {
  let y = START_Y;
  for (let i = 0; i < index; i++) {
    y += POINT_SPACING_MIN +
      hashRandom(i + worldSeed * 0.01) *
      (POINT_SPACING_MAX - POINT_SPACING_MIN);
  }
  return y;
}

function getPointIndexAtY(targetY) {
  let y = START_Y;
  let index = 0;

  while (y < targetY && index < 1000000) {
    y += POINT_SPACING_MIN +
      hashRandom(index + worldSeed * 0.01) *
      (POINT_SPACING_MAX - POINT_SPACING_MIN);
    index++;
  }

  return index;
}

function ensurePointsAround(y) {
  const firstIndex = Math.max(0, getPointIndexAtY(Math.max(START_Y, y - POINTS_BEHIND)) - 3);
  const lastIndex = getPointIndexAtY(y + POINTS_AHEAD) + 3;

  for (let index = firstIndex; index <= lastIndex; index++) {
    const id = `point_${index}`;

    if (!grapplePoints.has(id)) {
      grapplePoints.set(id, {
        id,
        x: getPointX(index),
        y: getPointY(index),
        radius: 12
      });
    }
  }

  for (const [id, point] of grapplePoints) {
    if (point.y < y - POINTS_BEHIND - 1000) {
      grapplePoints.delete(id);
    }
  }
}

function createPlayer(socket) {
  return {
    id: socket.id,
    name: `Player ${players.size + 1}`,
    x: WORLD_WIDTH / 2,
    y: START_Y,
    vx: 0,
    vy: PLAYER_SPEED,
    color: "#55ff77",
    reds: 10,
    wins: 0,
    height: 0,
    wallHops: MAX_WALL_HOPS,
    maxWallHops: MAX_WALL_HOPS,
    grappleUpgrade: 1,
    grappling: false,
    grappleTarget: null,
    lastUpdate: Date.now()
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
    color: player.color,
    reds: player.reds,
    wins: player.wins,
    height: Math.max(0, Math.floor(player.y - START_Y)),
    wallHops: player.wallHops,
    maxWallHops: player.maxWallHops,
    grappling: player.grappling,
    grappleTarget: player.grappleTarget
  };
}

function nearestPoint(player, targetId) {
  if (targetId && grapplePoints.has(targetId)) {
    const point = grapplePoints.get(targetId);
    const distance = Math.hypot(point.x - player.x, point.y - player.y);
    if (distance <= GRAPPLE_RANGE * player.grappleUpgrade) return point;
    return null;
  }

  let nearest = null;
  let nearestDistance = Infinity;

  for (const point of grapplePoints.values()) {
    const distance = Math.hypot(point.x - player.x, point.y - player.y);

    if (
      distance < nearestDistance &&
      distance <= GRAPPLE_RANGE * player.grappleUpgrade
    ) {
      nearest = point;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function startGrapple(player, targetId) {
  const point = nearestPoint(player, targetId);

  if (!point) {
    player.grappling = false;
    player.grappleTarget = null;
    return false;
  }

  player.grappling = true;
  player.grappleTarget = point.id;

  const dx = point.x - player.x;
  const dy = point.y - player.y;
  const distance = Math.max(1, Math.hypot(dx, dy));

  player.vx = (dx / distance) * 180;
  player.vy = Math.max(PLAYER_SPEED, (dy / distance) * 320);

  return true;
}

function stopGrapple(player) {
  player.grappling = false;
  player.grappleTarget = null;
}

function spawnBot() {
  const id = `bot_${nextBotId++}`;

  bots.set(id, {
    id,
    name: `Bot ${nextBotId}`,
    x: randomBetween(100, WORLD_WIDTH - 100),
    y: START_Y + randomBetween(50, 400),
    color: "#ff5555",
    vx: randomBetween(-40, 40),
    vy: PLAYER_SPEED
  });
}

function getStateForPlayer(player) {
  ensurePointsAround(player.y);

  const nearbyPoints = [...grapplePoints.values()]
    .filter(point =>
      point.y >= player.y - POINTS_BEHIND &&
      point.y <= player.y + POINTS_AHEAD
    );

  const nearbyBots = [...bots.values()]
    .filter(bot => Math.abs(bot.y - player.y) < POINTS_AHEAD)
    .map(bot => ({ ...bot }));

  return {
    players: [...players.values()].map(publicPlayer),
    grapplePoints: nearbyPoints,
    bots: nearbyBots,
    moon: { x: WORLD_WIDTH / 2, y: 30000, radius: 500 },
    world: { width: WORLD_WIDTH, startY: START_Y },
    shop: SHOP_ITEMS
  };
}

function broadcastState() {
  for (const player of players.values()) {
    const socket = io.sockets.sockets.get(player.id);
    if (!socket) continue;
    socket.emit("state", getStateForPlayer(player));
  }
}

io.on("connection", socket => {
  const player = createPlayer(socket);
  players.set(socket.id, player);
  ensurePointsAround(START_Y);

  socket.emit("init", {
    ...getStateForPlayer(player),
    selfId: socket.id,
    shop: SHOP_ITEMS
  });

  socket.broadcast.emit("playerJoined", publicPlayer(player));

  socket.on("move", data => {
    const current = players.get(socket.id);
    if (!current || !data) return;

    if (Number.isFinite(data.x)) {
      current.x = Math.max(25, Math.min(WORLD_WIDTH - 25, data.x));
    }

    if (Number.isFinite(data.vx)) {
      current.vx = Math.max(-PLAYER_SPEED * 2, Math.min(PLAYER_SPEED * 2, data.vx));
    }

    if (Number.isFinite(data.vy)) {
      current.vy = Math.max(PLAYER_SPEED, data.vy);
    }

    if (Number.isFinite(data.y) && data.y > current.y) {
      current.y = data.y;
    }

    current.height = Math.max(0, Math.floor(current.y - START_Y));
    ensurePointsAround(current.y);
  });

  socket.on("grapple", data => {
    const current = players.get(socket.id);
    if (!current) return;

    const targetId = data && typeof data === "object" ? data.targetId : data;
    startGrapple(current, targetId);
    socket.emit("grappleResult", {
      success: current.grappling,
      targetId: current.grappleTarget
    });
  });

  socket.on("releaseGrapple", () => {
    const current = players.get(socket.id);
    if (current) stopGrapple(current);
  });

  socket.on("wallHop", data => {
    const current = players.get(socket.id);
    if (!current || current.wallHops <= 0) return;

    const direction = data && Number.isFinite(data.direction)
      ? Math.sign(data.direction)
      : (current.x < WORLD_WIDTH / 2 ? 1 : -1);

    current.vx = direction * PLAYER_SPEED * 1.2;
    current.vy = Math.max(current.vy, WALL_HOP_FORCE);
    current.wallHops--;
    socket.emit("wallHopResult", { wallHops: current.wallHops });
  });

  socket.on("resetWallHops", () => {
    const current = players.get(socket.id);
    if (current) current.wallHops = current.maxWallHops;
  });

  socket.on("buySkin", data => {
    const current = players.get(socket.id);
    if (!current || !data) return;

    const item = SHOP_ITEMS.find(entry => entry.id === data.id);
    if (!item || current.reds < item.cost) {
      socket.emit("shopResult", { success: false, message: "Not enough Reds!" });
      return;
    }

    current.reds -= item.cost;
    current.color = item.color;

    socket.emit("shopResult", {
      success: true,
      message: `Equipped ${item.name}!`,
      reds: current.reds,
      color: current.color
    });
  });

  socket.on("buyGrappleUpgrade", () => {
    const current = players.get(socket.id);
    if (!current) return;

    const cost = Math.floor(25 * current.grappleUpgrade);

    if (current.reds < cost) {
      socket.emit("shopResult", { success: false, message: "Not enough Reds!" });
      return;
    }

    current.reds -= cost;
    current.grappleUpgrade = Math.min(5, current.grappleUpgrade + 1);

    socket.emit("shopResult", {
      success: true,
      message: `Grapple range upgraded to ${current.grappleUpgrade}x!`,
      reds: current.reds,
      grappleUpgrade: current.grappleUpgrade
    });
  });

  socket.on("collectRed", data => {
    const current = players.get(socket.id);
    if (!current || !data || !data.id) return;

    const bot = bots.get(data.id);
    if (!bot) return;

    if (Math.hypot(bot.x - current.x, bot.y - current.y) < 60) {
      current.reds += 1;
      bots.delete(data.id);
      socket.emit("redCollected", { reds: current.reds });
    }
  });

  socket.on("setName", name => {
    const current = players.get(socket.id);
    if (!current || typeof name !== "string") return;

    current.name = name.trim().slice(0, 20) || `Player ${players.size}`;
  });

  socket.on("setAppearance", data => {
    const current = players.get(socket.id);
    if (!current || !data) return;

    if (typeof data.color === "string" && /^#[0-9a-f]{6}$/i.test(data.color)) {
      current.color = data.color;
    }
  });

  socket.on("restart", () => {
    const current = players.get(socket.id);
    if (!current) return;

    current.x = WORLD_WIDTH / 2;
    current.y = START_Y;
    current.vx = 0;
    current.vy = PLAYER_SPEED;
    current.height = 0;
    current.wallHops = current.maxWallHops;
    stopGrapple(current);

    ensurePointsAround(START_Y);

    socket.emit("restarted", {
      x: current.x,
      y: current.y,
      wallHops: current.wallHops
    });
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    socket.broadcast.emit("playerLeft", socket.id);
  });
});

setInterval(() => {
  const now = Date.now();

  for (const player of players.values()) {
    const dt = Math.min(0.1, Math.max(0, (now - player.lastUpdate) / 1000));
    player.lastUpdate = now;

    player.y += Math.max(PLAYER_SPEED, player.vy) * dt;
    player.x += player.vx * dt;

    player.x = Math.max(25, Math.min(WORLD_WIDTH - 25, player.x));

    player.vx *= Math.pow(0.12, dt);

    if (player.grappling && player.grappleTarget) {
      const point = grapplePoints.get(player.grappleTarget);

      if (!point) {
        stopGrapple(player);
      } else {
        const dx = point.x - player.x;
        const dy = point.y - player.y;
        const distance = Math.max(1, Math.hypot(dx, dy));

        player.vx += (dx / distance) * 240 * dt;
        player.vy = Math.max(PLAYER_SPEED, player.vy + (dy / distance) * 100 * dt);

        if (distance < 35) stopGrapple(player);
      }
    }

    player.height = Math.max(0, Math.floor(player.y - START_Y));
    ensurePointsAround(player.y);
  }

  for (const bot of bots.values()) {
    bot.y += PLAYER_SPEED * 0.5 * 0.05;
    bot.x += bot.vx * 0.05;

    if (bot.x < 40 || bot.x > WORLD_WIDTH - 40) {
      bot.vx *= -1;
    }
  }

  if (bots.size < 15) spawnBot();

  broadcastState();
}, 50);

app.get("/", (req, res) => {
  res.send("GRAPPLE server is running.");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    players: players.size,
    grapplePoints: grapplePoints.size,
    bots: bots.size
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`GRAPPLE server running on port ${PORT}`);
});
