import { useMemo } from 'react';

export function Road() {
  return (
    <group>
      {/* Ground Plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#222" />
      </mesh>

      {/* Grid Helper */}
      <gridHelper args={[100, 50, 0x333333, 0x111111]} position={[0, 0.01, 0]} />

      {/* Main Intersection */}
      <group position={[0, 0.02, 0]}>
        {/* Horizontal Road */}
        <mesh receiveShadow>
          <boxGeometry args={[100, 0.05, 6]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        
        {/* Vertical Road */}
        <mesh receiveShadow>
          <boxGeometry args={[6, 0.05, 100]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>

        {/* Road Markings */}
        <Markings />
      </group>
    </group>
  );
}

function Markings() {
  const markings = useMemo(() => {
    const m = [];
    // Dashed lines
    for (let i = -50; i < 50; i += 4) {
      if (Math.abs(i) < 4) continue; // Skip intersection center
      m.push(<mesh key={`h-${i}`} position={[i, 0.03, 0]}><boxGeometry args={[2, 0.01, 0.1]} /><meshBasicMaterial color="white" opacity={0.5} transparent /></mesh>);
      m.push(<mesh key={`v-${i}`} position={[0, 0.03, i]}><boxGeometry args={[0.1, 0.01, 2]} /><meshBasicMaterial color="white" opacity={0.5} transparent /></mesh>);
    }
    // Stop lines
    m.push(<mesh key="stop-n" position={[0, 0.03, -4]}><boxGeometry args={[6, 0.01, 0.5]} /><meshBasicMaterial color="white" /></mesh>);
    m.push(<mesh key="stop-s" position={[0, 0.03, 4]}><boxGeometry args={[6, 0.01, 0.5]} /><meshBasicMaterial color="white" /></mesh>);
    m.push(<mesh key="stop-e" position={[4, 0.03, 0]}><boxGeometry args={[0.5, 0.01, 6]} /><meshBasicMaterial color="white" /></mesh>);
    m.push(<mesh key="stop-w" position={[-4, 0.03, 0]}><boxGeometry args={[0.5, 0.01, 6]} /><meshBasicMaterial color="white" /></mesh>);
    
    return m;
  }, []);

  return <group>{markings}</group>;
}
