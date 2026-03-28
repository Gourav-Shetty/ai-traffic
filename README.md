# Traffic AI Simulation

A real-time intelligent traffic simulation app with:

- network-level junction coordination
- dynamic lane timing optimization
- emergency priority handling
- live congestion visualization on an interactive map
- local-first ML inference with automatic fallback to hosted API

Built with React + TypeScript on the frontend, Express + SQLite on the backend, and a FastAPI model service.

## Preview

![Traffic AI App Screenshot 1](./Screenshot%202026-03-28%20170726.png)
![Traffic AI App Screenshot 2](./Screenshot%202026-03-28%20170758.png)

## Features

- Real-time multi-junction simulation state updates
- Congestion-aware adaptive signal timing
- Emergency vehicle corridor and priority logic
- Leaflet-based live map with clustering and heat overlay
- SQLite-backed simulation/history persistence
- ML proxy endpoint with local-first failover:
  - tries local model first (`LOCAL_ML_API_URL`)
  - falls back to hosted model (`ML_API_URL`) when local is unavailable

## Tech Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS, React Three Fiber, Recharts
- Map: Leaflet, React Leaflet, leaflet.heat
- Backend: Express, better-sqlite3
- ML Service: FastAPI (Poetry-managed in `ml_model`)

## Project Structure

```text
traffic-ai-simulation1/
  src/                  # React frontend
  server.ts             # Express API + Vite dev server + SQLite integration
  ml_model/             # FastAPI ML model service
  traffic_history.db    # Local SQLite database (runtime-generated)
```

## Quick Start (App Only)

Prerequisite: Node.js 18+

1. Install dependencies:

```bash
npm install
```

2. Run the app server:

```bash
npm run dev
```

3. Open:

```text
http://localhost:4000
```

## ML Routing Behavior

The app backend (`server.ts`) uses this strategy for `/api/ml/predict`:

1. Try local model first (`LOCAL_ML_API_URL`, default `http://127.0.0.1:8000`)
2. If local is unreachable, automatically fallback to hosted model (`ML_API_URL`)

Default fallback is Render-hosted model:

```text
https://traffic-model-1.onrender.com/predict
```

## Environment Variables

Use `.env.example` as reference:

- `APP_URL`: Optional app URL for links/callbacks
- `LOCAL_ML_API_URL`: Local FastAPI base URL
- `ML_API_URL`: Hosted fallback ML URL (base URL or full `/predict` URL)

## Running Local ML Service (Optional)

If you want local ML during development:

1. Install model dependencies:

```powershell
cd ml_model
.\.venv\Scripts\python.exe -m poetry install
```

2. Run local model API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload
```

From workspace root, combined app + local ML can be run with:

```bash
npm run dev:full
```

## Available Scripts

- `npm run dev`: start Express + Vite middleware dev server
- `npm run ml:dev`: start local FastAPI model via Poetry
- `npm run dev:full`: run app + local ML together
- `npm run build`: production build
- `npm run preview`: preview built frontend
- `npm run lint`: TypeScript type-check

## Deployment Notes

- This project can be deployed with split architecture:
  - app server/frontend on one platform
  - ML service on another platform (for example Render)
- Keep `ML_API_URL` set to your hosted model endpoint in production.

## Credits

- ML model implementation: [MirzaMD](https://github.com/MirzaMD) via [traffic-model](https://github.com/MirzaMD/traffic-model.git)
