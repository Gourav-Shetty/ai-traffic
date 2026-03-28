from fastapi import FastAPI
from pydantic import BaseModel, field_validator, Field
import pandas as pd
import joblib
from pathlib import Path
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
from bson import ObjectId

load_dotenv()

# ---------------- Schema ----------------
class TrafficSchema(BaseModel):
    lane_1_count: int = Field(..., ge=0)
    lane_2_count: int = Field(..., ge=0)
    lane_3_count: int = Field(..., ge=0)
    lane_4_count: int = Field(..., ge=0)
    hour: float = Field(..., ge=0, le=23)
    is_peak: int = Field(..., ge=0)
    heavy_ratio: float = Field(..., ge=0)
    two_wheeler_ratio: float = Field(..., ge=0)
    emergency: int = Field(..., ge=0)

    @field_validator("is_peak", "emergency")
    @classmethod
    def binary_values(cls, value):
        if value not in [0, 1]:
            raise ValueError("Must be 0 or 1")
        return value

# ---------------- App ----------------
app = FastAPI()

MONGO_URL = os.getenv("MONGO_URL")
client = AsyncIOMotorClient(MONGO_URL)
db = client["Traffic_Junctio_DB"]
sb = db["traffic_info"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# ---------------- Load Model ----------------
artifacts_path = Path(__file__).resolve().parent / "models" / "artifacts.pkl"
model = None
feature_columns = None
model_load_error = None

try:
    artifacts = joblib.load(artifacts_path)
    model = artifacts["model"]
    feature_columns = artifacts["feature_columns"]
except Exception as exc:
    model_load_error = str(exc)


def heuristic_prediction(data: dict):
    lanes = np.array([
        data["lane_1_count"],
        data["lane_2_count"],
        data["lane_3_count"],
        data["lane_4_count"],
    ], dtype=float)
    total = lanes.sum()
    if total == 0:
        return [10.0, 10.0, 10.0, 10.0]

    # Allocate a 60-second cycle proportionally and clamp to practical bounds.
    ratios = lanes / total
    predictions = np.clip(ratios * 60.0, 5.0, 60.0)
    return predictions.tolist()

# ---------------- Endpoint ----------------
@app.post("/predict")
async def predict_lights(raw_features: TrafficSchema):
    try:
        data = raw_features.model_dump()

        total = data["lane_1_count"] + data["lane_2_count"] + data["lane_3_count"] + data["lane_4_count"]
        data["total_vehicles"] = total
        data["lane_1_ratio"] = data["lane_1_count"] / total if total else 0
        data["lane_2_ratio"] = data["lane_2_count"] / total if total else 0
        data["lane_3_ratio"] = data["lane_3_count"] / total if total else 0
        data["lane_4_ratio"] = data["lane_4_count"] / total if total else 0

        lanes = np.array([
            data["lane_1_count"],
            data["lane_2_count"],
            data["lane_3_count"],
            data["lane_4_count"]
        ])
        data["max_lane_load"] = lanes.max()
        data["load_variance"] = lanes.var()

        if model is not None and feature_columns is not None:
            X = pd.DataFrame([data])
            X = X[feature_columns]
            pred = model.predict(X)[0]
        else:
            pred = heuristic_prediction(data)

        result = {
            "green_1": float(pred[0]),
            "green_2": float(pred[1]),
            "green_3": float(pred[2]),
            "green_4": float(pred[3]),
            "model_ready": model is not None,
            "model_error": model_load_error,
        }

        # ---------------- Store in DB ----------------
        def convert_numpy(obj):
            if isinstance(obj, dict):
                return {k: convert_numpy(v) for k, v in obj.items()}
            elif isinstance(obj, list) or isinstance(obj, np.ndarray):
                return [convert_numpy(x) for x in obj]
            elif isinstance(obj, np.integer):
                return int(obj)
            elif isinstance(obj, np.floating):
                return float(obj)
            return obj

        db_entry = {
            "user_input": convert_numpy(data),
            "prediction": convert_numpy(result)
        }
        try:
            await sb.insert_one(db_entry)
        except Exception:
            pass

        return result

    except Exception as e:
        return {"error": str(e)}



@app.get("/traffic-status")
async def retrieve():
    try:
        # Fetch all documents
        cursor = sb.find()
        results = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])  # convert ObjectId to string
            results.append(doc)
        return {"data": results}
    except Exception as e:
        return {"error": str(e)}