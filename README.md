# Traffic AI Simulation

Traffic signal simulation with a React + Express app and a FastAPI ML backend.

## Architecture

- Frontend + API server: Node/Express + Vite on port `4000`
- ML backend: FastAPI on port `8000`
- Node server proxies prediction calls from `/api/ml/predict` to the ML backend

The proxy target is resolved in this order:

1. `LOCAL_ML_API_URL`
2. `ML_API_URL`
3. `http://localhost:8000` (default)

## Prerequisites

- Node.js 20+
- Python 3.10 or 3.11
- Docker Desktop (optional, for containerized run)

## Run With Docker (recommended)

From project root:

```powershell
docker compose up --build
```

Open:

- App: `http://localhost:4000`
- ML docs: `http://localhost:8000/docs`

Camera feature notes (Docker):

- Use `http://localhost:4000` for local webcam access in browser.
- If you open the app from another device/IP (for example `http://192.168.x.x:4000`), most browsers require HTTPS for camera access.
- Grant camera permission in the browser prompt when you click the camera toggle.

Stop:

```powershell
docker compose down
```

## Run Locally (without Docker)

### 1) Install Node dependencies

```powershell
npm install
```

### 2) Start ML backend locally

From project root:

```powershell
npm run ml:dev
```

This uses `ml_model/.venv/Scripts/python.exe -m uvicorn ...`.

### 3) Start app server

In another terminal:

```powershell
npm run dev
```

Or start both together:

```powershell
npm run dev:full
```

## Render / Cloud ML Mode

If your ML backend is deployed on Render, set one of these environment variables for the Node server:

- `LOCAL_ML_API_URL=https://your-ml-service.onrender.com`
- or `ML_API_URL=https://your-ml-service.onrender.com`

Then start the app with `npm run dev`.

## Environment Variables

See `.env.example` for defaults:

- `LOCAL_ML_API_URL`
- `ML_API_URL` (backward-compatible fallback)
- `APP_URL`

## Useful Commands

```powershell
npm run lint
npm run build
docker compose ps
docker compose logs app --tail 100
docker compose logs ml --tail 100
```

## Notes

- `ml_model/src/models/artifacts.pkl` requires `scikit-learn==1.2.2`.
- Docker setup pins compatible Python package versions in `ml_model/Dockerfile`.
