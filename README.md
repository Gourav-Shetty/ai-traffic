# Traffic AI Control Platform

_Auto-generated fallback update (LLM quota exceeded)._

### Recent PR Impact
The following files changed and likely require documentation alignment:

- `src/App.tsx`

### Suggested Documentation Checks
- Validate setup and usage examples
- Verify API/function behavior descriptions
- Confirm command-line or configuration references
### Recent PR Impact
The following files changed and likely require documentation alignment:

- `src/App.tsx`
### Suggested Documentation Checks
- Validate setup and usage examples
- Verify API/function behavior descriptions
- Confirm command-line or configuration references
## Preview

![Traffic AI App Screenshot 1](./Screenshot%202026-03-28%20170726.png)
![Traffic AI App Screenshot 2](./Screenshot%202026-03-28%20170758.png)
## Features

- Real-time multi-junction traffic state updates
- Congestion-aware adaptive signal timing
- Emergency vehicle corridor and priority logic
- Leaflet-based live map with clustering and heat overlay
- SQLite-backed traffic/history persistence
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
traffic-ai-control-platform/
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

_Auto-generated fallback update (LLM quota exceeded)._
### Recent PR Impact
The following files changed and likely require documentation alignment:

- `Dockerfile`
- `docker-compose.yml`
- `ml_model/Dockerfile`
### Suggested Documentation Checks
- Validate setup and usage examples
- Verify API/function behavior descriptions
- Confirm command-line or configuration references
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
## Docker Branch

- A dedicated Docker setup is available on the `docker` branch.
- Branch link: https://github.com/Gourav-Shetty/ai-traffic/tree/docker
- Use that branch if you want full local containerized run with Docker Compose.
## Credits

- ML model implementation: [MirzaMD](https://github.com/MirzaMD) via [traffic-model](https://github.com/MirzaMD/traffic-model.git)
