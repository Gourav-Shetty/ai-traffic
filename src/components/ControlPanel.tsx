import { motion, AnimatePresence } from 'motion/react';
import { PredictionSource, SimulationState } from '../types';
import { Sliders, Siren, Activity, ChevronDown, ChevronUp, Map, LineChart as LineChartIcon, FastForward } from 'lucide-react';
import { useState, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface ControlPanelProps {
  simState: SimulationState;
  onBack: () => void;
  simulationSpeed: number;
  setSimulationSpeed: (speed: number) => void;
  predictionSource: PredictionSource | null;
  predictionUpdatedAt: number | null;
}

const LANE_NAMES = ['North Lane', 'East Lane', 'South Lane', 'West Lane'];

export function ControlPanel({
  simState,
  onBack,
  simulationSpeed,
  setSimulationSpeed,
  predictionSource,
  predictionUpdatedAt,
}: ControlPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(true);
  const updateTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

  const handleIntensityChange = (lane: number, value: number) => {
    const newIntensity = [...simState.trafficIntensity];
    newIntensity[lane] = value;
    
    // Update local state immediately for responsiveness
    if ((window as any).setLocalSimulations) {
      (window as any).setLocalSimulations((prev: any) => ({
        ...prev,
        [simState.id]: {
          ...prev[simState.id],
          trafficIntensity: newIntensity
        }
      }));
    }

    // Debounce local API update
    const key = `intensity-${simState.id}`;
    if (updateTimeoutRef.current[key]) clearTimeout(updateTimeoutRef.current[key]);
    
    updateTimeoutRef.current[key] = setTimeout(() => {
      fetch(`/api/simulations/${simState.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trafficIntensity: newIntensity })
      }).catch(err => console.error('Failed to update intensity:', err));
    }, 1000);
  };

  const handleEmergencyToggle = (lane: number) => {
    const isActive = simState.emergencyActive && simState.emergencyLane === lane;
    const nextActive = !isActive;
    const nextLane = nextActive ? lane : null;

    // Update local state immediately
    if ((window as any).setLocalSimulations) {
      (window as any).setLocalSimulations((prev: any) => ({
        ...prev,
        [simState.id]: {
          ...prev[simState.id],
          emergencyActive: nextActive,
          emergencyLane: nextLane
        }
      }));
    }

    // Debounce local API update
    const key = `emergency-${simState.id}`;
    if (updateTimeoutRef.current[key]) clearTimeout(updateTimeoutRef.current[key]);

    updateTimeoutRef.current[key] = setTimeout(() => {
      const update = { emergencyActive: nextActive, emergencyLane: nextLane };
      fetch(`/api/simulations/${simState.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update)
      }).catch(err => console.error('Failed to update emergency status:', err));
    }, 500);
  };

  return (
    <motion.div 
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 300, opacity: 0 }}
      className="absolute top-8 right-8 w-80 max-h-[calc(100vh-4rem)] flex flex-col bg-[#151619]/90 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl z-30 overflow-hidden"
    >
      <div className="flex items-center justify-between p-6 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#F27D26]/20 rounded-xl">
            <Activity className="w-5 h-5 text-[#F27D26]" />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-widest">Control Panel</h3>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-white/5 rounded-full transition-colors group"
            title="Back to Map"
          >
            <Map className="w-4 h-4 text-white/40 group-hover:text-white" />
          </button>
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-2 hover:bg-white/5 rounded-full transition-colors group"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? (
              <ChevronDown className="w-4 h-4 text-white/40 group-hover:text-white" />
            ) : (
              <ChevronUp className="w-4 h-4 text-white/40 group-hover:text-white" />
            )}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-6 pb-6 overflow-y-auto"
          >
            <div className="space-y-8 pt-6">
              {/* Control Loop Speed */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
                  <FastForward className="w-3 h-3" />
                  <span>Control Loop Speed</span>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-medium text-white/60">
                    <span>Speed</span>
                    <span>{simulationSpeed}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.5" 
                    max="5" 
                    step="0.5"
                    value={simulationSpeed}
                    onChange={(e) => setSimulationSpeed(parseFloat(e.target.value))}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#16a34a]"
                  />
                  <div className="flex justify-between text-[10px] text-white/30">
                    <span>Slower</span>
                    <span>Faster</span>
                  </div>
                </div>
              </div>

              {/* Traffic Intensity Sliders */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
                  <Sliders className="w-3 h-3" />
                  <span>Traffic Intensity</span>
                </div>
                
                {simState.trafficIntensity.map((intensity, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between text-[10px] font-medium text-white/60">
                      <span>{LANE_NAMES[i]}</span>
                      <span>{intensity}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={intensity}
                      onChange={(e) => handleIntensityChange(i, parseInt(e.target.value))}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#F27D26]"
                    />
                  </div>
                ))}
              </div>

              {/* Emergency Vehicle Toggle */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
                  <Siren className="w-3 h-3" />
                  <span>Emergency Priority</span>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1, 2, 3].map((lane) => {
                    const isActive = simState.emergencyActive && simState.emergencyLane === lane;
                    return (
                      <button 
                        key={lane}
                        onClick={() => handleEmergencyToggle(lane)}
                        className={`w-full flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                          isActive 
                            ? 'bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                            : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'
                        }`}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-widest text-center">
                          {LANE_NAMES[lane]}
                        </span>
                        <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-red-500 animate-ping' : 'bg-white/20'}`} />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Historical Traffic Chart */}
              {simState.history && simState.history.length > 0 && (
                <div className="space-y-4">
                  <button 
                    onClick={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
                    className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <LineChartIcon className="w-3 h-3" />
                      <span>Traffic History</span>
                    </div>
                    {isHistoryCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                  </button>
                  
                  <AnimatePresence initial={false}>
                    {!isHistoryCollapsed && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="h-24 w-full pt-2">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={simState.history}>
                              <XAxis dataKey="time" hide />
                              <YAxis domain={[0, 100]} hide />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#151619', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
                                itemStyle={{ color: '#F27D26' }}
                                labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
                              />
                              <Line 
                                type="monotone" 
                                dataKey="congestion" 
                                stroke="#F27D26" 
                                strokeWidth={2} 
                                dot={false}
                                isAnimationActive={false}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* System Status */}
              <div className="pt-6 border-t border-white/5">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-white/40">
                  <span>Active Lane</span>
                  <span className={`font-bold ${simState.activeGreenLane === -1 ? 'text-red-500' : 'text-white'}`}>
                    {simState.activeGreenLane === -1 ? 'CLEARANCE (ALL RED)' : LANE_NAMES[simState.activeGreenLane]}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-white/40 mt-2">
                  <span>Model Status</span>
                  <span className={`px-2 py-0.5 rounded-full border text-[9px] ${predictionSource === 'model' ? 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10' : 'text-yellow-400 border-yellow-400/40 bg-yellow-400/10'}`}>
                    {predictionSource === 'model' ? 'LIVE MODEL' : 'FALLBACK'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-white/40 mt-2">
                  <span>Time Remaining</span>
                  <div className="flex flex-col items-end">
                    <span className={`text-lg font-black ${simState.countdown < 3 ? 'text-red-500' : 'text-[#F27D26]'}`}>
                      {simState.countdown}s
                    </span>
                    <span className="text-[8px] text-white/20 italic">
                      {predictionUpdatedAt ? `Updated ${new Date(predictionUpdatedAt).toLocaleTimeString()}` : 'Waiting for model'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
