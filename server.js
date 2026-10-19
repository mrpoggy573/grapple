
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

const GRAPPLE_UPGRADES = [
  { multiplier: 1.25, cost: 10 },
  { multiplier: 1.5, cost: 20 },
  { multiplier: 1.75, cost: 35 },
  { multiplier: 2, cost: 50 }
];

const SHOP_ITEMS = [
  { name: "Green", cost: 0, color: "#00ff66" },
  { name: "Blue", cost: 10, color: "#45a3ff" },
  { name: "Pink", cost: 20, color: "#ff65c8" },
  { name: "Purple", cost: 35, color: "#b18cff" },
  { name: "Gold", cost: 50, color: "#ffcc33" }
];

const ALLOWED_PATTERNS = [
  "Solid",
  "Horizontal",
  "Diagonal",
  "Hexagon"
];

const grapplePoints = [];

for (let i = 0; i < 400; i++) {
  const y = WORLD.height - 350 - i * 120;

  if (y <= WORLD.moon.y + WORLD.moon.radius + 300) {
    break;
  }

  const x = 100 + ((i * 197 + 83) % 800);

  grapplePoints.push({
    id: i,
    x,
    y,
    radius: 25
  });
}

const bots = [];

for (let i = 0; i < 20; i++) {
  bots.push({
    id: i,
    x: 60 + ((i * 173 + 61) % 880),
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

function getNextGrappleUpgrade(p) {
  return GRAPPLE_UPGRADES.find(
    upgrade => upgrade.multiplier > p.grappleMultiplier
  ) || null;
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

    color: "#00ff66",
    pattern: "Solid",

    grappleMultiplier: 1,

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

    wasJumping: false,
    reachedMoon: false,
    floating: false,
    bestHeight: 0
  };
}

function heightOf(p) {
  return Math.max(
    0,
    Math.floor((WORLD.height - p.y) / 10)
  );
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

  p.input.left = false;
  p.input.right = false;
  p.input.jump = false;
  p.input.mouseDown = false;

  p.wasJumping = false;
}

function getPublicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    size: p.size,

    color: p.color,
    pattern: p.pattern,

    grappleMultiplier: p.grappleMultiplier,
    grappleUpgradeCost: getNextGrappleUpgrade(p)?.cost ?? null,

    reds: p.reds,
    hp: p.hp,
    wallHops: p.wallHops,

    height: heightOf(p),
    bestHeight: p.bestHeight,

    reachedMoon: p.reachedMoon,
    floating: p.floating,

    hook: p.hook
      ? { x: p.hook.x, y: p.hook.y }
      : null
  };
}

function handleInput(socket, data) {
  const p = players.get(socket.id);

  if (!p || !data || typeof data !== "object") {
    return;
  }

  p.input.left = data.left === true;
  p.input.right = data.right === true;
  p.input.jump = data.jump === true;

  if (
    Number.isFinite(data.aimX) &&
    Number.isFinite(data.aimY)
  ) {
    p.input.aimX = Math.max(
      -10000,
      Math.min(WORLD.width + 10000, data.aimX)
    );

    p.input.aimY = Math.max(
      -10000,
      Math.min(WORLD.height + 10000, data.aimY)
    );
  }

  const mouseDown = data.mouseDown === true;

  if (mouseDown && !p.input.mouseDown) {
    let nearest = null;
    let nearestDistance = 150;

    for (const point of grapplePoints) {
      const distance = Math.hypot(
        point.x - p.input.aimX,
        point.y - p.input.aimY
      );

      if (distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    }

    if (nearest) {
      const distance = Math.hypot(
        p.x - nearest.x,
        p.y - nearest.y
      );

      if (distance < 900 * p.grappleMultiplier) {
        p.hook = {
          x: nearest.x,
          y: nearest.y,
          length: distance
        };
      }
    }
  }

  if (!mouseDown) {
    p.hook = null;
  }

  p.input.mouseDown = mouseDown;
}

io.on("connection", socket => {
  socket.on("join", data => {
    if (players.has(socket.id)) {
      return;
    }

    const p = makePlayer(
      socket.id,
      data && data.name
    );

    players.set(socket.id, p);

    socket.emit("init", {
      id: socket.id,
      world: WORLD,
      grapplePoints,
      shop: SHOP_ITEMS.map(item => ({
        name: item.name,
        cost: item.cost
      })),

      players: Array.from(
        players.values(),
        getPublicPlayer
      ),

      bots: bots
        .filter(bot => !bot.taken)
        .map(bot => ({ ...bot })),

      tickRate: TICK_RATE
    });

    socket.broadcast.emit(
      "playerJoined",
      getPublicPlayer(p)
    );
  });

  socket.on("input", data => {
    handleInput(socket, data);
  });

  socket.on("setName", data => {
    const p = players.get(socket.id);

    if (!p) {
      return;
    }

    const newName = cleanName(data);
    p.name = newName;

    socket.emit("notice", "Name changed to " + newName + ".");
  });

  socket.on("setAppearance", data => {
    const p = players.get(socket.id);

    if (!p || !data || typeof data !== "object") {
      return;
    }

    if (
      typeof data.color === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(data.color)
    ) {
      p.color = data.color;
    }

    if (ALLOWED_PATTERNS.includes(data.pattern)) {
      p.pattern = data.pattern;
    }
  });

  socket.on("buySkin", name => {
    const p = players.get(socket.id);

    if (!p) {
      return;
    }

    const item = SHOP_ITEMS.find(skin => skin.name === name);

    if (!item) {
      socket.emit("notice", "That skin does not exist.");
      return;
    }

    if (p.color === item.color) {
      socket.emit("notice", "You already have this skin equipped.");
      return;
    }

    if (p.reds < item.cost) {
      socket.emit("notice", "Not enough Reds.");
      return;
    }

    p.reds -= item.cost;
    p.color = item.color;

    socket.emit("notice", item.name + " skin equipped!");
  });

  socket.on("buyGrappleUpgrade", () => {
    const p = players.get(socket.id);

    if (!p) {
      return;
    }

    const upgrade = getNextGrappleUpgrade(p);

    if (!upgrade) {
      socket.emit("notice", "Grapple length is already at 2x.");
      return;
    }

    if (p.reds < upgrade.cost) {
      socket.emit("notice", "Not enough Reds.");
      return;
    }

    p.reds -= upgrade.cost;
    p.grappleMultiplier = upgrade.multiplier;

    socket.emit(
      "notice",
      "Grapple length upgraded to " + upgrade.multiplier + "x!"
    );
  });

  socket.on("restart", () => {
    const p = players.get(socket.id);

    if (p) {
      resetPlayer(p);
    }
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.emit("playerLeft", socket.id);
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

    p.x = Math.max(
      p.size,
      Math.min(WORLD.width - p.size, p.x)
    );

    return;
  }

  if (p.hopResetAt && now >= p.hopResetAt) {
    p.wallHops = 5;
    p.hopResetAt = 0;
  }

  const zeroGravity = currentHeight >= 2235;
  const gravity = zeroGravity ? 0 : 0.65;
  const maxFallSpeed = zeroGravity ? 8 : 18;

  if (p.input.left) {
    p.vx -= 0.8;
  }

  if (p.input.right) {
    p.vx += 0.8;
  }

  if (
    p.input.jump &&
    !p.wasJumping &&
    !zeroGravity
  ) {
    if (p.onGround) {
      p.vy = -17;
      p.onGround = false;
    } else if (
      p.onWall &&
      p.wallHops > 0 &&
      !p.hook
    ) {
      p.wallHops--;
      p.vy = -17;
      p.vx = p.x < WORLD.width / 2 ? 22 : -22;
      p.hopResetAt = now + 5000;
    }
  }

  p.wasJumping = p.input.jump;

  p.vy = Math.min(p.vy + gravity, maxFallSpeed);

  if (p.hook) {
    const dx = p.x - p.hook.x;
    const dy = p.y - p.hook.y;
    const distance = Math.hypot(dx, dy) || 1;

    if (distance > p.hook.length) {
      const nx = dx / distance;
      const ny = dy / distance;

      p.x = p.hook.x + nx * p.hook.length;
      p.y = p.hook.y + ny * p.hook.length;

      const radialVelocity = p.vx * nx + p.vy * ny;

      p.vx -= radialVelocity * nx;
      p.vy -= radialVelocity * ny;
    }
  }

  p.vx *= 0.98;
  p.vy *= 0.995;

  p.x += p.vx;
  p.y += p.vy;

  p.onWall = false;

  if (p.x < p.size) {
    p.x = p.size;
    p.vx = 0;

    if (!p.hook) {
      p.onWall = true;
    }
  }

  if (p.x > WORLD.width - p.size) {
    p.x = WORLD.width - p.size;
    p.vx = 0;

    if (!p.hook) {
      p.onWall = true;
    }
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
    const distance = Math.hypot(dx, dy);

    if (distance < p.size + point.radius) {
      if (p.vy > 0 && p.y < point.y) {
        p.onGround = true;
      }

      const angle = Math.atan2(dy, dx);

      p.x =
        point.x +
        Math.cos(angle) * (p.size + point.radius);

      p.y =
        point.y +
        Math.sin(angle) * (p.size + point.radius);

      p.vx *= 0.5;
      p.vy *= 0.5;
    }
  }

  for (const bot of bots) {
    if (bot.taken) {
      continue;
    }

    if (
      Math.hypot(p.x - bot.x, p.y - bot.y) <
      p.size + 18
    ) {
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
    players: Array.from(
      players.values(),
      getPublicPlayer
    ),

    bots: bots
      .filter(bot => !bot.taken)
      .map(bot => ({ ...bot })),

    world: WORLD
  };
}

setInterval(() => {
  const now = Date.now();

  for (const p of players.values()) {
    updatePlayer(p, now);
  }

  io.emit("state", snapshot());
}, DT * 1000);

app.use(express.static("public"));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    players: players.size,
    grapplePoints: grapplePoints.length,
    bots: bots.filter(bot => !bot.taken).length
  });
});

server.listen(PORT, () => {
  console.log("grapple is running at http://localhost:" + PORT);
  console.log("Grapple points:", grapplePoints.length);
});
