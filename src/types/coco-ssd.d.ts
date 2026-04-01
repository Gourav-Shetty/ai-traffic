declare module '@tensorflow-models/coco-ssd' {
  export interface DetectedObject {
    bbox: [number, number, number, number];
    class: string;
    score: number;
  }

  export interface ObjectDetection {
    detect(
      img: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
      maxNumBoxes?: number,
      minScore?: number,
    ): Promise<DetectedObject[]>;
  }

  export interface ModelConfig {
    base?: 'mobilenet_v1' | 'mobilenet_v2' | 'lite_mobilenet_v2';
  }

  export function load(config?: ModelConfig): Promise<ObjectDetection>;
}
