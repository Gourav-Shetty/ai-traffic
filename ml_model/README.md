# ML Model Service (FastAPI)

This service exposes a prediction API used by the React/Express app.

## Prerequisites

1. Python `3.10` or `3.11`
2. Poetry environment in this folder (`ml_model/.venv`)

## Install Dependencies

From `ml_model`:

```powershell
.\.venv\Scripts\python.exe -m poetry install
```

## Run Service

From `ml_model`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload
```

Health check:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/openapi.json
```

## Common Issue: `poetry` Not Found

If `poetry --version` fails, Poetry is not on PATH in your shell.
Use the repo-local Python entry point directly (also safer if the project folder moved):

```powershell
.\.venv\Scripts\python.exe -m poetry <command>
```

Example:

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.main:app --host 127.0.0.1 --port 8000
```
