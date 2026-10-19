
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
  },
  perMessageDeflate: false
});

const PORT = process.env.PORT || 3000;
const TICK_RATE = 60;
const STATE_RATE = 30;
const STEP = 30 / TICK_RATE;

const WORLD = {
  width: 1000,
  height: 30000,
  moon: { x: 500, y: 1500, radius: 500 }
};

const COLORS = {
  Red: "#ff3333",
  Orange: "#ff8800",
  Yellow: "#ffff00",
  Green: "#00ff66",
  Blue: "#3388ff",
  Purple: "#aa44ff",
  Pink: "#ff66cc",
  Cyan: "#00ffff",
  White: "#ffffff",
  Black: "#222222",
  Brown: "#8b4513",
  Gray: "#888888"
};

const ALLOWED_PATTERNS = [
  "Solid",
  "Horizontal",
  "Diagonal",
  "Hexagon"
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
    pattern: "Solid",

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
      const dx = point.x - p.input.aimX;
      const dy = point.y - p.input.aimY;

      if (
        Math.abs(dx) >= nearestDistance ||
        Math.abs(dy) >= nearestDistance
      ) {
        continue;
      }

      const distance = Math.hypot(dx, dy);

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

      if (distance < 900) {
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
      colors: COLORS,

      players: Array.from(
        players.values(),
        getPublicPlayer
      ),

      bots: bots.map(bot => ({ ...bot })),
      tickRate: TICK_RATE,
      stateRate: STATE_RATE
    });

    socket.broadcast.emit(
      "playerJoined",
      getPublicPlayer(p)
    );
  });

  socket.on("input", data => {
    handleInput(socket, data);
  });

  socket.on("setAppearance", data => {
    const p = players.get(socket.id);

    if (!p || !data || typeof data !== "object") {
      return;
    }

    if (
      typeof data.color === "string" &&
      Object.values(COLORS).includes(data.color)
    ) {
      p.color = data.color;
    }

    if (ALLOWED_PATTERNS.includes(data.pattern)) {
      p.pattern = data.pattern;
    }
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
    p.vx *= Math.pow(0.94, STEP);
    p.vy = -3 * STEP;

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
  const gravity = zeroGravity ? 0 : 0.5;

  if (p.input.left) {
    p.vx -= 0.8 * STEP;
  }

  if (p.input.right) {
    p.vx += 0.8 * STEP;
  }

  if (
    p.input.jump &&
    !p.wasJumping &&
    !zeroGravity
  ) {
    if (p.onGround) {
      p.vy = -17 * STEP;
      p.onGround = false;
    } else if (
      p.onWall &&
      p.wallHops > 0 &&
      !p.hook
    ) {
      p.wallHops--;
      p.vy = -22 * STEP;
      p.vx = (p.x < WORLD.width / 2 ? 10 : -10) * STEP;
      p.hopResetAt = now + 5000;
    }
  }

  p.wasJumping = p.input.jump;

  p.vy += gravity * STEP;

  if (p.hook) {
    const dx = p.x - p.hook.x;
    const dy = p.y - p.hook.y;
    const distance = Math.hypot(dx, dy) || 1;

    if (distance > p.hook.length) {
      const nx = dx / distance;
      const ny = dy / distance;

      p.x = p.hook.x + nx * p.hook.length;
      p.y = p.hook.y + ny * p.hook.length;

      const radialVelocity =
        p.vx * nx + p.vy * ny;

      p.vx -= radialVelocity * nx;
      p.vy -= radialVelocity * ny;
    }
  }

  p.vx *= Math.pow(0.98, STEP);
  p.vy *= Math.pow(zeroGravity ? 0.995 : 0.99, STEP);

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
    const collisionDistance = p.size + point.radius;

    if (
      Math.abs(dx) >= collisionDistance ||
      Math.abs(dy) >= collisionDistance
    ) {
      continue;
    }

    const distance = Math.hypot(dx, dy);

    if (distance >= collisionDistance) {
      continue;
    }

    if (p.vy > 0 && p.y < point.y) {
      p.onGround = true;
    }

    const angle = Math.atan2(dy, dx);

    p.x =
      point.x +
      Math.cos(angle) * collisionDistance;

    p.y =
      point.y +
      Math.sin(angle) * collisionDistance;

    p.vx *= 0.5;
    p.vy *= 0.5;
  }

  for (const bot of bots) {
    if (bot.taken) {
      continue;
    }

    const dx = p.x - bot.x;
    const dy = p.y - bot.y;

    if (
      Math.abs(dx) >= p.size + 18 ||
      Math.abs(dy) >= p.size + 18
    ) {
      continue;
    }

    if (Math.hypot(dx, dy) < p.size + 18) {
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
    p.vy = -3 * STEP;
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

let tick = 0;

setInterval(() => {
  const now = Date.now();

  for (const p of players.values()) {
    updatePlayer(p, now);
  }

  tick++;

  if (tick % (TICK_RATE / STATE_RATE) === 0) {
    if (players.size > 0) {
      io.volatile.emit("state", snapshot());
    }
  }
}, 1000 / TICK_RATE);

app.use(express.static("public"));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log(
    `grapple is running at http://localhost:${PORT}`
  );
});
