import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Database
const db = new Database("gallery.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS gallery_items (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    thumbnailUrl TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    createdAt TEXT NOT NULL
  )
`);

// Seed initial data if empty
const count = db.prepare("SELECT COUNT(*) as count FROM gallery_items").get() as { count: number };
if (count.count === 0) {
  const initialItems = [
    {
      id: '1',
      url: 'https://picsum.photos/seed/nature1/1200/800',
      type: 'image',
      title: 'Mountain Sunrise',
      description: 'A beautiful sunrise over the snow-capped mountains.',
      tags: JSON.stringify(['nature', 'mountain', 'sunrise']),
      createdAt: new Date('2024-01-01').toISOString(),
    },
    {
      id: '2',
      url: 'https://picsum.photos/seed/city1/1200/800',
      type: 'image',
      title: 'Urban Night',
      description: 'The city lights reflecting off the wet pavement at night.',
      tags: JSON.stringify(['city', 'night', 'urban']),
      createdAt: new Date('2024-01-02').toISOString(),
    },
    {
      id: '3',
      url: 'https://www.w3schools.com/html/mov_bbb.mp4',
      thumbnailUrl: 'https://picsum.photos/seed/bunny/1200/800',
      type: 'video',
      title: 'Big Buck Bunny',
      description: 'A short animated film about a large rabbit.',
      tags: JSON.stringify(['animation', 'funny', 'bunny']),
      createdAt: new Date('2024-01-03').toISOString(),
    }
  ];

  const insert = db.prepare(`
    INSERT INTO gallery_items (id, url, thumbnailUrl, type, title, description, tags, createdAt)
    VALUES (@id, @url, @thumbnailUrl, @type, @title, @description, @tags, @createdAt)
  `);

  for (const item of initialItems) {
    insert.run({
      ...item,
      thumbnailUrl: item.thumbnailUrl || null,
      description: item.description || null
    });
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' })); // Increase limit for base64 images
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const PORT = 3000;

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Gallery API
  app.get("/api/gallery", (req, res) => {
    const items = db.prepare("SELECT * FROM gallery_items ORDER BY createdAt DESC").all();
    res.json(items.map((item: any) => ({
      ...item,
      tags: item.tags ? JSON.parse(item.tags) : []
    })));
  });

  app.post("/api/gallery", (req, res) => {
    const item = req.body;
    const stmt = db.prepare(`
      INSERT INTO gallery_items (id, url, thumbnailUrl, type, title, description, tags, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      item.id,
      item.url,
      item.thumbnailUrl || null,
      item.type,
      item.title,
      item.description || "",
      JSON.stringify(item.tags || []),
      item.createdAt
    );
    res.status(201).json({ status: "success" });
  });

  app.delete("/api/gallery/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM gallery_items WHERE id = ?").run(id);
    res.json({ status: "success" });
  });

  // WebSocket handling
  wss.on("connection", (ws) => {
    console.log("New client connected");

    ws.on("message", (message) => {
      const data = JSON.parse(message.toString());
      
      if (data.type === "chat") {
        const broadcastMsg = JSON.stringify({
          type: "chat",
          text: data.text,
          image: data.image,
          sender: data.sender || "user",
          timestamp: new Date().toISOString()
        });
        
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMsg);
          }
        });
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
    });
  });

  // Handle upgrade for WebSocket
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
