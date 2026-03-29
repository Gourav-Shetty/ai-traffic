import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite Database
// File: traffic_history.db (located in the root directory)
const db = new Database("traffic_history.db");

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS simulations (
    id TEXT PRIMARY KEY,
    activeGreenLane INTEGER,
    countdown INTEGER,
    congestionLevel REAL,
    relievingNeighbor TEXT,
    emergencyActive INTEGER,
    emergencyLane INTEGER,
    trafficIntensity TEXT,
    neighborStates TEXT,
    lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP,
    syncVersion INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    junctionId TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    congestion REAL,
    activeLane INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_history_junction ON history(junctionId);
  CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);
`);

// Migrate existing SQLite files that were created with older schemas.
const simulationsTableColumns = db
  .prepare("PRAGMA table_info(simulations)")
  .all() as Array<{ name: string }>;
const simulationsColumnSet = new Set(simulationsTableColumns.map((column) => column.name));

if (!simulationsColumnSet.has("trafficIntensity")) {
  db.exec("ALTER TABLE simulations ADD COLUMN trafficIntensity TEXT");
}
if (!simulationsColumnSet.has("neighborStates")) {
  db.exec("ALTER TABLE simulations ADD COLUMN neighborStates TEXT");
}
if (!simulationsColumnSet.has("syncVersion")) {
  db.exec("ALTER TABLE simulations ADD COLUMN syncVersion INTEGER DEFAULT 0");
}

async function startServer() {
  console.log("Starting local server with SQLite...");
  const app = express();
  const PORT = 4000;
  const mlApiUrl = process.env.LOCAL_ML_API_URL || "http://localhost:8000";

  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", database: "sqlite" });
  });

  // Proxy prediction requests to FastAPI ML service.
  app.post("/api/ml/predict", async (req, res) => {
    try {
      const response = await fetch(`${mlApiUrl}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });

      const result = await response.json();
      if (!response.ok) {
        return res.status(response.status).json({
          error: "ML inference failed",
          details: result,
        });
      }

      return res.json(result);
    } catch (error) {
      console.error("ML proxy error:", error);
      return res.status(502).json({ error: "Unable to reach ML service" });
    }
  });

  // Get all simulations
  app.get("/api/simulations", (req, res) => {
    const rows = db.prepare("SELECT * FROM simulations").all();
    const simulations = rows.reduce((acc: any, row: any) => {
      acc[row.id] = {
        ...row,
        emergencyActive: !!row.emergencyActive,
        trafficIntensity: JSON.parse(row.trafficIntensity || "[50,50,50,50]"),
        neighborStates: JSON.parse(row.neighborStates || "[]")
      };
      return acc;
    }, {});
    res.json(simulations);
  });

  // Update simulation state
  app.post("/api/simulations/:id", (req, res) => {
    const { id } = req.params;
    const existing = db.prepare("SELECT * FROM simulations WHERE id = ?").get(id) as any;

    const existingTrafficIntensity = existing?.trafficIntensity
      ? JSON.parse(existing.trafficIntensity)
      : [50, 50, 50, 50];

    const existingNeighborStates = existing?.neighborStates
      ? JSON.parse(existing.neighborStates)
      : [];

    const merged = {
      activeGreenLane: req.body.activeGreenLane ?? existing?.activeGreenLane ?? 0,
      countdown: req.body.countdown ?? existing?.countdown ?? 10,
      congestionLevel: req.body.congestionLevel ?? existing?.congestionLevel ?? 50,
      relievingNeighbor: req.body.relievingNeighbor ?? existing?.relievingNeighbor ?? null,
      emergencyActive: req.body.emergencyActive ?? (existing ? !!existing.emergencyActive : false),
      emergencyLane: req.body.emergencyLane ?? existing?.emergencyLane ?? null,
      trafficIntensity: req.body.trafficIntensity ?? existingTrafficIntensity,
      neighborStates: req.body.neighborStates ?? existingNeighborStates,
    };

    const stmt = db.prepare(`
      INSERT INTO simulations (id, activeGreenLane, countdown, congestionLevel, relievingNeighbor, emergencyActive, emergencyLane, trafficIntensity, neighborStates, lastUpdated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        activeGreenLane = excluded.activeGreenLane,
        countdown = excluded.countdown,
        congestionLevel = excluded.congestionLevel,
        relievingNeighbor = excluded.relievingNeighbor,
        emergencyActive = excluded.emergencyActive,
        emergencyLane = excluded.emergencyLane,
        trafficIntensity = excluded.trafficIntensity,
        neighborStates = excluded.neighborStates,
        lastUpdated = CURRENT_TIMESTAMP
    `);

    stmt.run(
      id,
      merged.activeGreenLane,
      merged.countdown,
      merged.congestionLevel,
      merged.relievingNeighbor,
      merged.emergencyActive ? 1 : 0,
      merged.emergencyLane,
      JSON.stringify(merged.trafficIntensity),
      JSON.stringify(merged.neighborStates)
    );

    res.json({ success: true });
  });

  // Add history entry
  app.post("/api/history/:id", (req, res) => {
    const { id } = req.params;
    const { congestion, activeLane } = req.body;

    const stmt = db.prepare("INSERT INTO history (junctionId, congestion, activeLane) VALUES (?, ?, ?)");
    stmt.run(id, congestion, activeLane);

    res.json({ success: true });
  });

  // Get history for a junction
  app.get("/api/history/:id", (req, res) => {
    const { id } = req.params;
    const rows = db.prepare("SELECT timestamp as time, congestion FROM history WHERE junctionId = ? ORDER BY timestamp DESC LIMIT 30").all(id);
    res.json(rows.reverse());
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`SQLite database: ${path.join(process.cwd(), "traffic_history.db")}`);
  });
}

startServer();
