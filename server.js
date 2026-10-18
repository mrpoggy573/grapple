
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "https://mrpoggy573.github.io",
      "http://localhost:3000",
      "http://127.0.0.1:3000"
    ],
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;

const WORLD = {
  width: 1000,
  height: 30000,
  moon: { x: 500, y: 1500, radius: 500 }
};

const COLORS = {
  Green: "#00ff66",
  Blue: "#45a3ff",
  Pink: "#ff65c8",
  Purple: "#b18cff",
  Gold: "#ffcc33"
};

const SHOP = [
  { name: "Green", cost: 0 },
  { name: "Blue", cost: 10 },
  { name: "Pink", cost: 20 },
  { name: "Purple", cost: 30 },
  { name: "Gold", cost: 50 }
];

const grapplePoints = [];
for (let i = 0; i < 400; i++) {
  const y = WORLD.height - i * 120 - 400;
  if (y > WORLD.moon.y + WORLD.moon.radius + 300) {
    grapplePoints.push({
      id: i,
      x: 100 + Math.random() * 800,
      y,
      radius: 25
    });
  }
}

const bots = [];
for (let i = 0; i < 20; i++) {
  bots.push({
    id: i,
    x: 60 + Math.random() * 880,
    y: WORLD.height - 500 - i * 1200,
    reds: 10,
    taken: false
  });
}

const players = new Map();

function cleanName(value) {
  const name = String(value || "Player")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
  return name || "Player";
}

function makePlayer(id, name) {
  return {
    id,
    name: cleanName(name),
    x: WORLD.width / 2,
    y: WORLD.height - 150,
    vx: 0,
    vy: 0,
    size: 18,
    color: COLORS.Green,
    skin: "Green",
    reds: 10,
    hp: 100,
    wallHops: 5,
    hopResetAt: 0,
    onGround: false,
    onWall: false,
    hook: null,
    input: {
      left: false,
      right: false,
      jump: false,
      mouseDown: false,
      aimX: 500,
      aimY: 1000
    },
    reachedMoon: false,
    floating: false,
    bestHeight: 0,
    lastInputAt: 0
  };
}

function heightOf(p) {
  return Math.max(0, Math.floor((WORLD.height - p.y) / 10));
}

function resetPlayer(p) {
  p.x = WORLD.width / 2;
  p.y = WORLD.height - 150;
  p.vx = 0;
  p.vy = 0;
  p.hp = 100;
  p.wallHops = 5;
  p.hopResetAt = 0;
  p.onGround = false;
  p.onWall = false;
  p.hook = null;
  p.reachedMoon = false;
  p.floating = false;
  p.bestHeight = 0;
  p.input.jump = false;
}

function getPublicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    size: p.size,
    color: p.color,
    reds: p.reds,
    hp: p.hp,
    wallHops: p.wallHops,
    height: heightOf(p),
    bestHeight: p.bestHeight,
    reachedMoon: p.reachedMoon,
    floating: p.floating,
    hook: p.hook ? { x: p.hook.x, y: p.hook.y } : null
  };
}

function handleInput(socket, data) {
  const p = players.get(socket.id);
  if (!p || !data || typeof data !== "object") return;

  p.input.left = data.left === true;
  p.input.right = data.right === true;
  p.input.jump = data.jump === true;

  if (Number.isFinite(data.aimX) && Number.isFinite(data.aimY)) {
    p.input.aimX = Math.max(-10000, Math.min(WORLD.width + 10000, data.aimX));
    p.input.aimY = Math.max(-10000, Math.min(WORLD.height + 10000, data.aimY));
  }

  const mouseDown = data.mouseDown === true;

  if (mouseDown && !p.input.mouseDown) {
    let nearest = null;
    let nearestDistance = 150;

    for (const point of grapplePoints) {
      const d = Math.hypot(
        point.x - p.input.aimX,
        point.y - p.input.aimY
      );

      if (d < nearestDistance) {
        nearest = point;
        nearestDistance = d;
      }
    }

    if (nearest) {
      const distance = Math.hypot(p.x - nearest.x, p.y - nearest.y);

      if (distance < 900) {
        p.hook = {
          x: nearest.x,
          y: nearest.y,
          length: distance
        };
      }
    }
  }

  if (!mouseDown) p.hook = null;
  p.input.mouseDown = mouseDown;
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("join", (data) => {
    if (players.has(socket.id)) return;

    const p = makePlayer(socket.id, data && data.name);
    players.set(socket.id, p);

    socket.emit("init", {
      id: socket.id,
      world: WORLD,
      grapplePoints,
      shop: SHOP,
      players: Array.from(players.values(), getPublicPlayer),
      bots: bots.map(b => ({ ...b })),
      tickRate: TICK_RATE
    });

    socket.broadcast.emit("playerJoined", getPublicPlayer(p));
  });

  socket.on("input", (data) => handleInput(socket, data));

  socket.on("buySkin", (skinName) => {
    const p = players.get(socket.id);
    if (!p || typeof skinName !== "string") return;

    const item = SHOP.find(s => s.name === skinName);
    if (!item) return;

    if (p.skin === item.name) {
      socket.emit("notice", "You already have that colour.");
      return;
    }

    if (p.reds < item.cost) {
      socket.emit("notice", "Not enough Reds.");
      return;
    }

    p.reds -= item.cost;
    p.skin = item.name;
    p.color = COLORS[item.name];
    socket.emit("notice", item.name + " colour equipped!");
  });

  socket.on("restart", () => {
    const p = players.get(socket.id);
    if (p) resetPlayer(p);
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.emit("playerLeft", socket.id);
    console.log("Player disconnected:", socket.id);
  });
});

function updatePlayer(p, now) {
  const currentHeight = heightOf(p);

  if (currentHeight > p.bestHeight) {
    p.bestHeight = currentHeight;
  }

  if (p.floating) {
    p.vx *= 0.94;
    p.vy = -3;
    p.x += p.vx;
    p.y += p.vy;
    p.x = Math.max(p.size, Math.min(WORLD.width - p.size, p.x));
    return;
  }

  if (p.hopResetAt && now >= p.hopResetAt) {
    p.wallHops = 5;
    p.hopResetAt = 0;
  }

  const zeroGravity = currentHeight >= 2235;
  const gravity = zeroGravity ? 0 : 0.5;

  if (p.input.left) p.vx -= 0.8;
  if (p.input.right) p.vx += 0.8;

  if (p.input.jump && !p.wasJumping && !zeroGravity) {
    if (p.onGround) {
      p.vy = -17;
      p.onGround = false;
    } else if (p.onWall && p.wallHops > 0 && !p.hook) {
      p.wallHops--;
      p.vy = -17;
      p.vx = p.x < WORLD.width / 2 ? 22 : -22;
      p.hopResetAt = now + 5000;
    }
  }

  p.wasJumping = p.input.jump;
  p.vy += gravity;

  if (p.hook) {
    const dx = p.x - p.hook.x;
    const dy = p.y - p.hook.y;
    const d = Math.hypot(dx, dy) || 1;

    if (d > p.hook.length) {
      const nx = dx / d;
      const ny = dy / d;

      p.x = p.hook.x + nx * p.hook.length;
      p.y = p.hook.y + ny * p.hook.length;

      const radialVelocity = p.vx * nx + p.vy * ny;
      p.vx -= radialVelocity * nx;
      p.vy -= radialVelocity * ny;
    }
  }

  p.vx *= 0.98;
  p.vy *= zeroGravity ? 0.995 : 0.99;
  p.x += p.vx;
  p.y += p.vy;

  p.onWall = false;

  if (p.x < p.size) {
    p.x = p.size;
    p.vx = 0;
    if (!p.hook) p.onWall = true;
  }

  if (p.x > WORLD.width - p.size) {
    p.x = WORLD.width - p.size;
    p.vx = 0;
    if (!p.hook) p.onWall = true;
  }

  p.onGround = false;

  if (p.y > WORLD.height - p.size) {
    p.y = WORLD.height - p.size;
    p.vy = 0;
    p.onGround = true;
  }

  for (const point of grapplePoints) {
    const dx = p.x - point.x;
    const dy = p.y - point.y;
    const d = Math.hypot(dx, dy);

    if (d < p.size + point.radius) {
      if (p.vy > 0 && p.y < point.y) p.onGround = true;

      const angle = Math.atan2(dy, dx);
      p.x = point.x + Math.cos(angle) * (p.size + point.radius);
      p.y = point.y + Math.sin(angle) * (p.size + point.radius);
      p.vx *= 0.5;
      p.vy *= 0.5;
    }
  }

  for (const bot of bots) {
    if (bot.taken) continue;

    if (Math.hypot(p.x - bot.x, p.y - bot.y) < p.size + 18) {
      bot.taken = true;
      p.reds += bot.reds;
      io.emit("botTaken", bot.id);
    }
  }

  if (p.y <= WORLD.moon.y + WORLD.moon.radius) {
    p.reachedMoon = true;
    p.floating = true;
    p.hook = null;
    p.vx *= 0.25;
    p.vy = -3;
  }
}

function snapshot() {
  return {
    players: Array.from(players.values(), getPublicPlayer),
    bots: bots.filter(b => !b.taken).map(b => ({ ...b })),
    world: WORLD
  };
}

setInterval(() => {
  const now = Date.now();

  for (const p of players.values()) {
    updatePlayer(p, now);
  }

  io.emit("state", snapshot());
}, 1000 / TICK_RATE);

app.use(express.static("public"));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log(`grapple is running on port ${PORT}`);
});
