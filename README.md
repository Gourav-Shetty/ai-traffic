<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your app

This contains everything you need to run your app locally.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Run With ML Model (Poetry)

The Express server proxies ML requests to `http://127.0.0.1:8000` by default (`ML_API_URL` can override it).

1. Install frontend dependencies:
   `npm install`
2. Install Python dependencies for the model (inside `ml_model`):
   `cd ml_model`
   `.\.venv\Scripts\poetry.exe install`
3. Start only the ML API (from workspace root):
   `npm run ml:dev`
4. Start only the React/Express app:
   `npm run dev`

Or run both together from workspace root:

`npm run dev:full`

If `poetry` is not recognized globally on Windows, this repo uses the in-project executable at `ml_model\.venv\Scripts\poetry.exe`.
