import { Text } from '@react-three/drei';

interface TrafficLightProps {
  position: [number, number, number];
  rotation: [number, number, number];
  isGreen: boolean;
  countdown: number | null;
}

export function TrafficLight({ position, rotation, isGreen, countdown }: TrafficLightProps) {
  const displayValue = countdown === null ? '--' : String(Math.max(0, countdown)).padStart(2, '0');

  return (
    <group position={position} rotation={rotation}>
      {/* Pole */}
      <mesh position={[0, 2.5, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 5]} />
        <meshStandardMaterial color="#222" />
      </mesh>

      {/* Light Box (faces approaching traffic) */}
      <group position={[0, 4.5, -0.5]}>
        <mesh castShadow>
          <boxGeometry args={[0.6, 1.2, 0.4]} />
          <meshStandardMaterial color="#111" />
        </mesh>

        {/* Red Light */}
        <mesh position={[0, 0.3, -0.2]}>
          <sphereGeometry args={[0.25, 16, 16]} />
          <meshStandardMaterial 
            color="#ff0000" 
            emissive="#ff0000" 
            emissiveIntensity={isGreen ? 0 : 10} 
            toneMapped={false}
          />
          {!isGreen && <pointLight color="#ff0000" intensity={2} distance={10} />}
        </mesh>

        {/* Green Light */}
        <mesh position={[0, -0.3, -0.2]}>
          <sphereGeometry args={[0.25, 16, 16]} />
          <meshStandardMaterial 
            color="#00ff00" 
            emissive="#00ff00" 
            emissiveIntensity={isGreen ? 10 : 0} 
            toneMapped={false}
          />
          {isGreen && <pointLight color="#00ff00" intensity={2} distance={10} />}
        </mesh>

        {/* Countdown Display */}
        <group position={[0, 1.0, -0.16]}>
          <mesh>
            <boxGeometry args={[0.95, 0.36, 0.08]} />
            <meshStandardMaterial color="#090909" metalness={0.25} roughness={0.4} />
          </mesh>
          <Text
            position={[0, 0, -0.05]}
            rotation={[0, Math.PI, 0]}
            fontSize={0.28}
            color={isGreen ? "#6DFFA3" : "#FF7A7A"}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="#111111"
            letterSpacing={0.03}
          >
            {displayValue}
          </Text>
        </group>
      </group>
    </group>
  );
}
