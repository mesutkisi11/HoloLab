import { buildDrone } from './drone.js';
import { buildRobotArm } from './robotArm.js';

// Kodla üretilen demo modeller. Galeri bunları ve kullanıcının yüklediklerini listeler.
export const demoModels = [
  { id: 'demo-drone', name: 'Katlanabilir Quadcopter', build: buildDrone, isDemo: true },
  { id: 'demo-robot-arm', name: 'Robot Kol', build: buildRobotArm, isDemo: true },
];
