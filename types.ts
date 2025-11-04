
export enum AppMode {
  HOME = 'HOME',
  FAST = 'FAST',
  SCENE_DESCRIPTOR = 'SCENE_DESCRIPTOR',
  MAPS = 'MAPS',
}

export interface BoundingBox {
  id: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
