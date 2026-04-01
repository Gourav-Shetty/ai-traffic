import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CameraOff, Expand, Loader2, Minimize2, PencilLine, Trash2 } from 'lucide-react';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs';

let sharedModel: cocoSsd.ObjectDetection | null = null;
let sharedModelPromise: Promise<cocoSsd.ObjectDetection> | null = null;

function ensureDetectorModel(): Promise<cocoSsd.ObjectDetection> {
  if (sharedModel) {
    return Promise.resolve(sharedModel);
  }

  if (!sharedModelPromise) {
    sharedModelPromise = cocoSsd.load({ base: 'lite_mobilenet_v2' }).then((model) => {
      sharedModel = model;
      return model;
    });
  }

  return sharedModelPromise;
}

type VehicleClass = 'car' | 'truck' | 'bike';

interface Point {
  x: number;
  y: number;
}

interface LaneZone {
  id: string;
  name: string;
  color: string;
  points: Point[];
}

interface LaneCounts {
  car: number;
  truck: number;
  bike: number;
}

interface DetectionBox {
  id: string;
  cls: VehicleClass;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
  laneZoneId: string | null;
}

const LANE_COLORS = ['#22c55e', '#f59e0b', '#3b82f6', '#ef4444', '#a855f7', '#06b6d4'];

const CLASS_MAP: Record<string, VehicleClass | null> = {
  car: 'car',
  truck: 'truck',
  bus: 'truck',
  motorcycle: 'bike',
};

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-6) + xi);

    if (intersects) inside = !inside;
  }

  return inside;
}

function getLaneAnchorPoint(box: { x: number; y: number; w: number; h: number }): Point {
  return {
    x: box.x + box.w / 2,
    y: box.y + box.h * 0.88,
  };
}

export function CameraLaneMonitor() {
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraBooting, setCameraBooting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [isFullscreenWindowOpen, setIsFullscreenWindowOpen] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [laneZones, setLaneZones] = useState<LaneZone[]>([]);
  const [detectionBoxes, setDetectionBoxes] = useState<DetectionBox[]>([]);
  const [popupMountNode, setPopupMountNode] = useState<HTMLDivElement | null>(null);

  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const popupVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const detectorBusyRef = useRef(false);
  const popupWindowRef = useRef<Window | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    [mainVideoRef.current, popupVideoRef.current].forEach((video) => {
      if (video) {
        video.srcObject = null;
      }
    });

    setDetectionBoxes([]);
  };

  const attachStreamToVideo = (video: HTMLVideoElement | null) => {
    if (!video || !streamRef.current) return;

    if (video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current;
    }

    if (video.paused) {
      video.play().catch(() => {});
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootCamera = async () => {
      if (!cameraEnabled) {
        setCameraBooting(false);
        setCameraError(null);
        setDrawMode(false);
        setDrawingPoints([]);
        stopCamera();
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera is not supported in this browser.');
        setCameraEnabled(false);
        return;
      }

      if (streamRef.current) {
        attachStreamToVideo(mainVideoRef.current);
        attachStreamToVideo(popupVideoRef.current);
        return;
      }

      setCameraBooting(true);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        stopCamera();
        streamRef.current = stream;
        setCameraError(null);
        attachStreamToVideo(mainVideoRef.current);
        attachStreamToVideo(popupVideoRef.current);
      } catch {
        setCameraError('Could not access camera. Please allow camera permission.');
        setCameraEnabled(false);
      } finally {
        if (!cancelled) {
          setCameraBooting(false);
        }
      }
    };

    bootCamera();

    return () => {
      cancelled = true;
    };
  }, [cameraEnabled]);

  useEffect(() => {
    let disposed = false;

    const loadModel = async () => {
      if (modelRef.current) {
        setModelReady(!!modelRef.current);
        return;
      }

      setModelLoading(true);
      try {
        const model = await ensureDetectorModel();
        if (disposed) return;
        modelRef.current = model;
        setModelReady(true);
      } catch {
        if (!disposed) {
          setCameraError('Detector failed to load. Refresh and try again.');
        }
      } finally {
        if (!disposed) setModelLoading(false);
      }
    };

    loadModel();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!cameraEnabled || !modelRef.current) return;

    const detect = async () => {
      const activeVideo = isFullscreenWindowOpen
        ? (popupVideoRef.current ?? mainVideoRef.current)
        : (mainVideoRef.current ?? popupVideoRef.current);
      if (detectorBusyRef.current || !activeVideo || !modelRef.current) return;
      if (activeVideo.readyState < 2) return;

      detectorBusyRef.current = true;

      try {
        const predictions = await modelRef.current.detect(activeVideo, 25);
        const boxes: DetectionBox[] = [];

        predictions.forEach((prediction, index) => {
          const cls = CLASS_MAP[prediction.class];
          if (!cls || prediction.score < 0.45) return;

          const [rawX, rawY, rawW, rawH] = prediction.bbox;
          const vw = Math.max(1, activeVideo.videoWidth);
          const vh = Math.max(1, activeVideo.videoHeight);

          const x = Math.max(0, rawX / vw);
          const y = Math.max(0, rawY / vh);
          const w = Math.max(0, rawW / vw);
          const h = Math.max(0, rawH / vh);
          const anchor = getLaneAnchorPoint({ x, y, w, h });
          const zone = laneZones.find((lane) => pointInPolygon(anchor, lane.points));

          boxes.push({
            id: `${cls}-${Math.round(x * 1000)}-${Math.round(y * 1000)}-${Math.round(w * 1000)}-${Math.round(h * 1000)}-${index}`,
            cls,
            score: prediction.score,
            x,
            y,
            w,
            h,
            laneZoneId: zone?.id ?? null,
          });
        });

        setDetectionBoxes(boxes);
      } catch {
        // Keep UI alive even if one detection tick fails.
      } finally {
        detectorBusyRef.current = false;
      }
    };

    const interval = window.setInterval(detect, 450);
    return () => window.clearInterval(interval);
  }, [cameraEnabled, isFullscreenWindowOpen, laneZones]);

  useEffect(() => {
    if (!isFullscreenWindowOpen) {
      if (popupWindowRef.current && !popupWindowRef.current.closed) {
        popupWindowRef.current.close();
      }

      popupWindowRef.current = null;
      setPopupMountNode(null);
      return;
    }

    const popupWindow = window.open(
      '',
      'camera-lane-monitor-fullscreen',
      'popup=yes,width=1600,height=1000,left=0,top=0,resizable=yes,scrollbars=no'
    );

    if (!popupWindow) {
      setCameraError('Popup blocked. Allow popups to open the detached camera window.');
      setIsFullscreenWindowOpen(false);
      return;
    }

    popupWindow.document.head.innerHTML = '';
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      popupWindow.document.head.appendChild(node.cloneNode(true));
    });

    popupWindow.document.title = 'Camera Lane Monitor';
    popupWindow.document.body.style.margin = '0';
    popupWindow.document.body.style.background = '#050505';
    popupWindow.document.body.style.overflow = 'hidden';
    popupWindow.document.body.innerHTML = '';

    const mountNode = popupWindow.document.createElement('div');
    mountNode.id = 'camera-lane-monitor-fullscreen-root';
    popupWindow.document.body.appendChild(mountNode);

    popupWindowRef.current = popupWindow;
    setPopupMountNode(mountNode);

    const handleUnload = () => {
      setIsFullscreenWindowOpen(false);
    };

    const checkClosed = window.setInterval(() => {
      if (popupWindow.closed) {
        window.clearInterval(checkClosed);
        setIsFullscreenWindowOpen(false);
      }
    }, 400);

    popupWindow.addEventListener('beforeunload', handleUnload);
    popupWindow.focus();

    try {
      popupWindow.moveTo(0, 0);
      popupWindow.resizeTo(window.screen.availWidth, window.screen.availHeight);
    } catch {
      // Some browsers block move/resize.
    }

    return () => {
      window.clearInterval(checkClosed);
      popupWindow.removeEventListener('beforeunload', handleUnload);

      if (!popupWindow.closed) {
        popupWindow.close();
      }

      popupWindowRef.current = null;
      setPopupMountNode(null);
    };
  }, [isFullscreenWindowOpen]);

  const laneCountsByZone = useMemo(() => {
    const counts: Record<string, LaneCounts> = {};

    laneZones.forEach((zone) => {
      counts[zone.id] = { car: 0, truck: 0, bike: 0 };
    });

    detectionBoxes.forEach((box) => {
      if (!box.laneZoneId || !counts[box.laneZoneId]) return;
      counts[box.laneZoneId][box.cls] += 1;
    });

    return counts;
  }, [detectionBoxes, laneZones]);

  const visibleDetectionBoxes = useMemo(() => {
    if (laneZones.length === 0) return detectionBoxes;
    return detectionBoxes.filter((box) => box.laneZoneId !== null);
  }, [detectionBoxes, laneZones.length]);

  const laneNamesById = useMemo(() => {
    const names: Record<string, string> = {};
    laneZones.forEach((lane) => {
      names[lane.id] = lane.name;
    });
    return names;
  }, [laneZones]);

  const onOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!drawMode) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    setDrawingPoints((prev) => [
      ...prev,
      { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) },
    ]);
  };

  const finishCurrentLane = () => {
    if (drawingPoints.length < 3) return;

    const laneNumber = laneZones.length + 1;
    const lane: LaneZone = {
      id: `lane-zone-${Date.now()}`,
      name: `Lane ${laneNumber}`,
      color: LANE_COLORS[(laneNumber - 1) % LANE_COLORS.length],
      points: drawingPoints,
    };

    setLaneZones((prev) => [...prev, lane]);
    setDrawingPoints([]);
    setDrawMode(false);
  };

  const renderCameraCard = (mode: 'inline' | 'popup') => {
    const isPopupMode = mode === 'popup';
    const videoRefTarget = isPopupMode ? popupVideoRef : mainVideoRef;
    const shellClassName = isPopupMode
      ? 'fixed inset-0 z-50 bg-black/95 p-4 md:p-6 overflow-hidden pointer-events-auto flex items-center justify-center'
      : 'absolute bottom-8 left-8 z-30 pointer-events-auto';

    const cardClassName = isPopupMode
      ? 'w-full max-w-[1600px] h-[min(96vh,1100px)] bg-[#151619]/95 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col'
      : 'w-[390px] bg-[#151619]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden';

    const previewClassName = isPopupMode
      ? 'relative w-full flex-1 min-h-[420px] bg-black overflow-hidden'
      : 'relative w-full h-[220px] bg-black';

    const countsClassName = isPopupMode
      ? 'p-3 border-t border-white/10 max-h-[180px] overflow-y-auto shrink-0'
      : 'p-3';

    return (
      <div className={shellClassName}>
        <div className={cardClassName}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-[10px] uppercase font-bold tracking-widest text-white/50">Camera Lane Monitor</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsFullscreenWindowOpen((prev) => !prev)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] uppercase font-bold tracking-widest border border-white/15 text-white/70 hover:bg-white/5 transition-colors"
                title={isPopupMode ? 'Close Full Window' : 'Open Full Window'}
              >
                {isPopupMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
                {isPopupMode ? 'Close Full Window' : 'Open Full Window'}
              </button>
              <button
                type="button"
                onClick={() => setCameraEnabled((prev) => !prev)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] uppercase font-bold tracking-widest border transition-colors ${cameraEnabled ? 'bg-red-500/15 text-red-300 border-red-500/30 hover:bg-red-500/20' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'}`}
              >
                {cameraEnabled ? <CameraOff className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
                {cameraEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
              </button>
            </div>
          </div>

          <div className="p-3 border-b border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!cameraEnabled}
                onClick={() => {
                  setDrawMode((prev) => !prev);
                  setDrawingPoints([]);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/15 text-[10px] uppercase font-bold tracking-widest text-white/70 disabled:opacity-40 hover:bg-white/5"
              >
                <PencilLine className="w-3.5 h-3.5" />
                {drawMode ? 'Cancel Draw' : 'Draw Lane'}
              </button>
              <button
                type="button"
                disabled={drawingPoints.length < 3}
                onClick={finishCurrentLane}
                className="px-2.5 py-1.5 rounded-lg border border-emerald-400/40 bg-emerald-400/10 text-[10px] uppercase font-bold tracking-widest text-emerald-300 disabled:opacity-40"
              >
                Save Lane
              </button>
              <button
                type="button"
                disabled={drawingPoints.length === 0}
                onClick={() => setDrawingPoints((prev) => prev.slice(0, -1))}
                className="px-2.5 py-1.5 rounded-lg border border-white/15 text-[10px] uppercase font-bold tracking-widest text-white/70 disabled:opacity-40"
              >
                Undo Point
              </button>
              <button
                type="button"
                disabled={laneZones.length === 0}
                onClick={() => {
                  setLaneZones([]);
                  setDetectionBoxes([]);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-400/30 text-[10px] uppercase font-bold tracking-widest text-red-300 disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Zones
              </button>
            </div>
            <p className="mt-2 text-[10px] text-white/45 uppercase tracking-widest">
              {drawMode ? 'Click points on video, then save lane.' : 'Tip: draw lane polygons for per-lane counts.'}
            </p>
          </div>

          <div onClick={onOverlayClick} className={`${previewClassName} ${drawMode ? 'cursor-crosshair' : ''}`}>
            {cameraEnabled ? (
              <video
                ref={(node) => {
                  videoRefTarget.current = node;
                  attachStreamToVideo(node);
                }}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover object-center"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-[11px] text-white/40 uppercase tracking-widest">
                Camera is off
              </div>
            )}

            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              {laneZones.map((lane) => (
                <g key={lane.id}>
                  <polygon
                    points={lane.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}
                    fill={`${lane.color}33`}
                    stroke={lane.color}
                    strokeWidth={4}
                  />
                  <text
                    x={lane.points[0].x * 1000 + 6}
                    y={lane.points[0].y * 1000 - 6}
                    fill={lane.color}
                    fontSize="20"
                    fontWeight="700"
                  >
                    {lane.name}
                  </text>
                </g>
              ))}

              {drawingPoints.length > 0 && (
                <polyline
                  points={drawingPoints.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}
                  fill="none"
                  stroke="#f97316"
                  strokeWidth={4}
                  strokeDasharray="8 8"
                />
              )}

              {drawingPoints.map((point, i) => (
                <circle key={`point-${i}`} cx={point.x * 1000} cy={point.y * 1000} r={6} fill="#f97316" />
              ))}
            </svg>

            {cameraEnabled && (cameraBooting || modelLoading) && (
              <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 px-2 py-1 rounded bg-black/70 text-[10px] uppercase font-bold tracking-widest text-white/70">
                <Loader2 className="w-3 h-3 animate-spin" />
                {cameraBooting ? 'Starting camera' : 'Loading detector'}
              </div>
            )}

            {cameraEnabled && modelReady && (
              <div className="absolute top-2 right-2 px-2 py-1 rounded bg-emerald-400/15 border border-emerald-400/30 text-[10px] uppercase font-bold tracking-widest text-emerald-300">
                Detector ready
              </div>
            )}

            {visibleDetectionBoxes.map((box) => (
              <div
                key={box.id}
                className="absolute border border-cyan-300/90 bg-cyan-300/10 rounded"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                }}
              >
                <div className="absolute -top-5 left-0 px-1 py-0.5 rounded bg-black/70 text-[9px] uppercase tracking-widest text-cyan-200 whitespace-nowrap">
                  {box.cls} {(box.score * 100).toFixed(0)}% {box.laneZoneId ? `| ${laneNamesById[box.laneZoneId]}` : ''}
                </div>
              </div>
            ))}

            {cameraError && (
              <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-4 text-center text-[11px] text-red-300">
                {cameraError}
              </div>
            )}
          </div>

          <div className={countsClassName}>
            <div className="grid grid-cols-[90px_1fr_1fr_1fr] gap-2 text-[10px] uppercase font-bold tracking-widest text-white/45 mb-2">
              <div>Lane</div>
              <div>Cars</div>
              <div>Trucks</div>
              <div>Bikes</div>
            </div>

            {laneZones.length === 0 ? (
              <div className="text-[11px] text-white/40 py-2">No lane zones yet. Turn camera on and draw zones to start live counts.</div>
            ) : (
              <div className="space-y-1.5">
                {laneZones.map((lane) => {
                  const laneCounts = laneCountsByZone[lane.id] ?? { car: 0, truck: 0, bike: 0 };
                  return (
                    <div key={lane.id} className="grid grid-cols-[90px_1fr_1fr_1fr] gap-2 text-[11px] py-1.5 px-2 rounded-lg border border-white/10 bg-white/5">
                      <div className="font-semibold" style={{ color: lane.color }}>{lane.name}</div>
                      <div>{laneCounts.car}</div>
                      <div>{laneCounts.truck}</div>
                      <div>{laneCounts.bike}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {laneZones.length > 0 && detectionBoxes.length > visibleDetectionBoxes.length && (
              <div className="mt-2 text-[10px] text-white/35 uppercase tracking-widest">
                Hidden outside-zone detections: {detectionBoxes.length - visibleDetectionBoxes.length}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {renderCameraCard('inline')}
      {isFullscreenWindowOpen && popupMountNode ? createPortal(renderCameraCard('popup'), popupMountNode) : null}
    </>
  );
}
