import { buildDrone } from './drone.js';
import { buildRobotArm } from './robotArm.js';

// Kodla üretilen demo modeller. Galeri bunları ve kullanıcının yüklediklerini listeler.
// choreo: elle hazırlanmış koreografi dosyası (yoksa otomatik üretilir)
export const demoModels = [
  {
    id: 'demo-drone',
    name: 'Katlanabilir Quadcopter',
    build: buildDrone,
    choreo: 'choreo/drone.json',
    isDemo: true,
  },
  { id: 'demo-robot-arm', name: 'Robot Kol', build: buildRobotArm, isDemo: true },
];
