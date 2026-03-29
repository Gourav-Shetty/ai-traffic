FROM python:3.11-slim

WORKDIR /app

# Copy project files
COPY . .

# Install dependencies with locked versions (critical for scikit-learn pickle compatibility)
RUN pip install --no-cache-dir \
    fastapi==0.135.2 \
    uvicorn==0.42.0 \
    pandas==2.0.3 \
    numpy==1.26.4 \
    scikit-learn==1.2.2 \
    joblib==1.3.2 \
    motor==3.7.1 \
    python-dotenv==1.2.2

# Run FastAPI app via uvicorn
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
