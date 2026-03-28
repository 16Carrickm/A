import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js';

const canvas = document.getElementById('app');
const statsEl = document.getElementById('stats');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#0c0c13', 0.05);

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 2.3, 6.4);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 1, 0);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 2;
controls.maxDistance = 15;

const hemi = new THREE.HemisphereLight('#7f9bff', '#202010', 0.45);
scene.add(hemi);

const dir = new THREE.DirectionalLight('#f5f1ff', 1.8);
dir.position.set(2, 5, 3);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 20;
dir.shadow.camera.left = -6;
dir.shadow.camera.right = 6;
dir.shadow.camera.top = 6;
dir.shadow.camera.bottom = -6;
scene.add(dir);

const rim = new THREE.PointLight('#66dcff', 30, 18, 2);
rim.position.set(-4, 1.2, -1);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(14, 64),
  new THREE.MeshStandardMaterial({
    color: '#12121c',
    roughness: 0.23,
    metalness: 0.42,
    envMapIntensity: 1.2,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const ped = new THREE.Mesh(
  new THREE.CylinderGeometry(0.35, 0.45, 2.4, 24),
  new THREE.MeshStandardMaterial({
    color: '#2f2d40',
    roughness: 0.52,
    metalness: 0.36,
  }),
);
ped.position.set(0, 1.2, 0);
ped.castShadow = true;
scene.add(ped);

const emitter = new THREE.Group();
emitter.position.set(0, 2.35, 0);
scene.add(emitter);

const sparkGeo = new THREE.BufferGeometry();
const sparkCount = 800;
const sparkPos = new Float32Array(sparkCount * 3);
const sparkVel = new Float32Array(sparkCount * 3);
for (let i = 0; i < sparkCount; i += 1) {
  sparkPos[i * 3] = 999;
}
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
const sparks = new THREE.Points(
  sparkGeo,
  new THREE.PointsMaterial({ color: '#ff9966', size: 0.045, transparent: true, opacity: 0.9 }),
);
scene.add(sparks);

const CLOTH_W = 4;
const CLOTH_H = 3.2;
const SEG_X = 48;
const SEG_Y = 38;
const DRAG = 0.988;
const TEAR_DIST = (CLOTH_W / SEG_X) * 1.7;
let pinTop = true;
let windEnabled = true;

const particleCount = (SEG_X + 1) * (SEG_Y + 1);
const pos = new Float32Array(particleCount * 3);
const prev = new Float32Array(particleCount * 3);
const invMass = new Float32Array(particleCount);
const temp = new Float32Array(particleCount);
const strain = new Float32Array(particleCount);

const constraints = [];
const neighbors = Array.from({ length: particleCount }, () => []);
const originalInvMass = new Float32Array(particleCount);

function idx(x, y) {
  return y * (SEG_X + 1) + x;
}

for (let y = 0; y <= SEG_Y; y += 1) {
  for (let x = 0; x <= SEG_X; x += 1) {
    const i = idx(x, y);
    const px = ((x / SEG_X) - 0.5) * CLOTH_W;
    const py = 2.15 - (y / SEG_Y) * CLOTH_H;
    const pz = 0;
    pos.set([px, py, pz], i * 3);
    prev.set([px, py, pz], i * 3);
    const pinned = y === 0 && x % 2 === 0;
    invMass[i] = pinned ? 0 : 1;
    originalInvMass[i] = invMass[i];
  }
}

function addConstraint(a, b, stiff = 1) {
  const ax = pos[a * 3];
  const ay = pos[a * 3 + 1];
  const az = pos[a * 3 + 2];
  const bx = pos[b * 3];
  const by = pos[b * 3 + 1];
  const bz = pos[b * 3 + 2];
  const rest = Math.hypot(ax - bx, ay - by, az - bz);
  constraints.push({ a, b, rest, live: true, stiff });
  neighbors[a].push(constraints.length - 1);
  neighbors[b].push(constraints.length - 1);
}

for (let y = 0; y <= SEG_Y; y += 1) {
  for (let x = 0; x <= SEG_X; x += 1) {
    if (x < SEG_X) addConstraint(idx(x, y), idx(x + 1, y));
    if (y < SEG_Y) addConstraint(idx(x, y), idx(x, y + 1));
    if (x < SEG_X && y < SEG_Y) {
      addConstraint(idx(x, y), idx(x + 1, y + 1), 0.75);
      addConstraint(idx(x + 1, y), idx(x, y + 1), 0.75);
    }
    if (x + 2 <= SEG_X) addConstraint(idx(x, y), idx(x + 2, y), 0.45);
    if (y + 2 <= SEG_Y) addConstraint(idx(x, y), idx(x, y + 2), 0.45);
  }
}

const clothGeo = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, SEG_X, SEG_Y);
clothGeo.translate(0, 2.15 - CLOTH_H / 2, 0);

const uniforms = {
  time: { value: 0 },
  burnBias: { value: 0.0 },
};

const clothMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms,
  lights: false,
  vertexShader: /* glsl */ `
    attribute float aTemp;
    attribute float aStrain;
    varying float vTemp;
    varying float vStrain;
    varying vec3 vPos;
    varying vec3 vNormal;
    void main() {
      vTemp = aTemp;
      vStrain = aStrain;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vPos = worldPos.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vTemp;
    varying float vStrain;
    varying vec3 vPos;
    varying vec3 vNormal;
    uniform float time;

    float weave(vec2 p) {
      vec2 q = fract(p * vec2(8.0, 7.0));
      float h = smoothstep(0.2, 0.0, abs(q.x - 0.5)) * 0.5 + smoothstep(0.2, 0.0, abs(q.y - 0.5)) * 0.5;
      return h;
    }

    void main() {
      vec3 V = normalize(cameraPosition - vPos);
      float fres = pow(1.0 - max(dot(V, normalize(vNormal)), 0.0), 3.0);
      float pattern = weave(vPos.xz + vec2(sin(time * 0.4), cos(time * 0.35)) * 0.2);
      vec3 cool = mix(vec3(0.16, 0.22, 0.65), vec3(0.34, 0.9, 0.98), pattern);
      vec3 warm = vec3(1.0, 0.34, 0.07);
      vec3 charred = vec3(0.05, 0.04, 0.04);

      float heat = clamp(vTemp, 0.0, 1.6);
      vec3 base = mix(cool, warm, smoothstep(0.2, 1.0, heat));
      base = mix(base, charred, smoothstep(0.85, 1.35, heat));

      float stressGlow = smoothstep(0.35, 1.0, vStrain) * (0.5 + 0.5 * sin(time * 15.0 + vPos.y * 12.0));
      vec3 glow = vec3(1.0, 0.45, 0.1) * stressGlow * 0.8;

      vec3 color = base + glow + fres * vec3(0.22, 0.36, 0.55);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});

clothGeo.setAttribute('aTemp', new THREE.BufferAttribute(temp, 1));
clothGeo.setAttribute('aStrain', new THREE.BufferAttribute(strain, 1));

const cloth = new THREE.Mesh(clothGeo, clothMat);
cloth.castShadow = true;
cloth.receiveShadow = true;
scene.add(cloth);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let dragging = false;
let dragIndex = -1;
let burnMode = false;

function projectPointer(e) {
  const x = (e.clientX / innerWidth) * 2 - 1;
  const y = -(e.clientY / innerHeight) * 2 + 1;
  pointer.set(x, y);
}

function nearestParticle(faceIdx, point) {
  if (faceIdx == null) return -1;
  const ids = clothGeo.index.array;
  const tri = [ids[faceIdx * 3], ids[faceIdx * 3 + 1], ids[faceIdx * 3 + 2]];
  let closest = tri[0];
  let best = Infinity;
  for (const vi of tri) {
    const dx = pos[vi * 3] - point.x;
    const dy = pos[vi * 3 + 1] - point.y;
    const dz = pos[vi * 3 + 2] - point.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) {
      best = d2;
      closest = vi;
    }
  }
  return closest;
}

function ignite(center, radius = 0.22, power = 1) {
  for (let i = 0; i < particleCount; i += 1) {
    const dx = pos[i * 3] - center.x;
    const dy = pos[i * 3 + 1] - center.y;
    const dz = pos[i * 3 + 2] - center.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < radius) temp[i] = Math.max(temp[i], power * (1 - d / radius));
  }
}

canvas.addEventListener('pointerdown', (e) => {
  projectPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(cloth, false)[0];

  if (hit) {
    if (burnMode) {
      ignite(hit.point, 0.3, 1.2);
      burstSparks(hit.point, hit.face.normal);
      return;
    }

    dragIndex = nearestParticle(hit.faceIndex, hit.point);
    if (dragIndex >= 0) {
      dragging = true;
      controls.enabled = false;
      invMass[dragIndex] = 0;
      prev[dragIndex * 3] = pos[dragIndex * 3];
      prev[dragIndex * 3 + 1] = pos[dragIndex * 3 + 1];
      prev[dragIndex * 3 + 2] = pos[dragIndex * 3 + 2];
    }
  }
});

addEventListener('pointermove', (e) => {
  if (!dragging || dragIndex < 0) return;
  projectPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const target = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragPlane, target);
  pos[dragIndex * 3] = THREE.MathUtils.clamp(target.x, -2.6, 2.6);
  pos[dragIndex * 3 + 1] = THREE.MathUtils.clamp(target.y, 0.2, 3.8);
  pos[dragIndex * 3 + 2] = THREE.MathUtils.clamp(target.z, -2.4, 2.4);
});

addEventListener('pointerup', () => {
  if (dragging && dragIndex >= 0) {
    invMass[dragIndex] = originalInvMass[dragIndex];
    dragging = false;
    dragIndex = -1;
    controls.enabled = true;
  }
});

addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'b') burnMode = !burnMode;
  if (e.key.toLowerCase() === 'w') windEnabled = !windEnabled;
  if (e.key.toLowerCase() === 'p') {
    pinTop = !pinTop;
    for (let x = 0; x <= SEG_X; x += 1) {
      const i = idx(x, 0);
      invMass[i] = pinTop && x % 2 === 0 ? 0 : 1;
      originalInvMass[i] = invMass[i];
    }
  }
  if (e.key.toLowerCase() === 'r') resetCloth();
});

function resetCloth() {
  for (let y = 0; y <= SEG_Y; y += 1) {
    for (let x = 0; x <= SEG_X; x += 1) {
      const i = idx(x, y);
      const px = ((x / SEG_X) - 0.5) * CLOTH_W;
      const py = 2.15 - (y / SEG_Y) * CLOTH_H;
      const pz = 0;
      pos.set([px, py, pz], i * 3);
      prev.set([px, py, pz], i * 3);
      temp[i] = 0;
      strain[i] = 0;
      invMass[i] = y === 0 && pinTop && x % 2 === 0 ? 0 : 1;
      originalInvMass[i] = invMass[i];
    }
  }
  for (const c of constraints) c.live = true;
}

function burstSparks(center, normal) {
  let spawned = 0;
  for (let i = 0; i < sparkCount && spawned < 40; i += 1) {
    if (sparkPos[i * 3] > 900) {
      sparkPos.set([center.x, center.y, center.z], i * 3);
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 0.8,
        Math.random() * 0.9,
        (Math.random() - 0.5) * 0.8,
      )
        .addScaledVector(normal, 0.45)
        .normalize();
      sparkVel.set([dir.x * 2.6, dir.y * 2.2, dir.z * 2.6], i * 3);
      spawned += 1;
    }
  }
}

function updateSparks(dt) {
  for (let i = 0; i < sparkCount; i += 1) {
    const p = i * 3;
    if (sparkPos[p] > 900) continue;
    sparkVel[p + 1] -= 6.8 * dt;
    sparkVel[p] *= 0.985;
    sparkVel[p + 2] *= 0.985;
    sparkPos[p] += sparkVel[p] * dt;
    sparkPos[p + 1] += sparkVel[p + 1] * dt;
    sparkPos[p + 2] += sparkVel[p + 2] * dt;
    if (sparkPos[p + 1] < 0.05) sparkPos[p] = 999;
  }
  sparkGeo.attributes.position.needsUpdate = true;
}

const gravity = new THREE.Vector3(0, -8.2, 0);
const wind = new THREE.Vector3();
const clock = new THREE.Clock();

function simStep(dt, time) {
  const windPower = windEnabled ? 3.4 : 0;
  wind.set(
    Math.sin(time * 0.8) * windPower,
    Math.cos(time * 1.7) * 0.4,
    Math.sin(time * 1.2 + 0.5) * windPower,
  );

  for (let i = 0; i < particleCount; i += 1) {
    if (invMass[i] === 0) continue;
    const p = i * 3;
    const cx = pos[p];
    const cy = pos[p + 1];
    const cz = pos[p + 2];

    const vx = (cx - prev[p]) * DRAG;
    const vy = (cy - prev[p + 1]) * DRAG;
    const vz = (cz - prev[p + 2]) * DRAG;

    prev[p] = cx;
    prev[p + 1] = cy;
    prev[p + 2] = cz;

    const fHeat = THREE.MathUtils.smoothstep(temp[i], 0.25, 1.5);
    pos[p] += vx + (gravity.x + wind.x * (1 + fHeat)) * dt * dt;
    pos[p + 1] += vy + (gravity.y + wind.y) * dt * dt;
    pos[p + 2] += vz + (gravity.z + wind.z * (1 + fHeat)) * dt * dt;

    pos[p + 1] = Math.max(pos[p + 1], 0.04);
  }

  for (let iter = 0; iter < 7; iter += 1) {
    for (const c of constraints) {
      if (!c.live) continue;
      const { a, b, rest, stiff } = c;
      const ap = a * 3;
      const bp = b * 3;
      const dx = pos[bp] - pos[ap];
      const dy = pos[bp + 1] - pos[ap + 1];
      const dz = pos[bp + 2] - pos[ap + 2];
      const dist = Math.hypot(dx, dy, dz) + 1e-7;
      const diff = (dist - rest) / dist;
      const ia = invMass[a];
      const ib = invMass[b];
      const w = ia + ib;
      if (w === 0) continue;

      const relax = diff * stiff * 0.95;
      if (ia > 0) {
        pos[ap] += dx * relax * (ia / w);
        pos[ap + 1] += dy * relax * (ia / w);
        pos[ap + 2] += dz * relax * (ia / w);
      }
      if (ib > 0) {
        pos[bp] -= dx * relax * (ib / w);
        pos[bp + 1] -= dy * relax * (ib / w);
        pos[bp + 2] -= dz * relax * (ib / w);
      }

      const heatCut = Math.max(temp[a], temp[b]);
      const tearLimit = rest * (1.65 - THREE.MathUtils.clamp(heatCut * 0.55, 0, 0.7));
      if (dist > tearLimit || dist > TEAR_DIST) {
        c.live = false;
        burstSparks(
          new THREE.Vector3((pos[ap] + pos[bp]) * 0.5, (pos[ap + 1] + pos[bp + 1]) * 0.5, (pos[ap + 2] + pos[bp + 2]) * 0.5),
          new THREE.Vector3(dx, dy, dz).normalize(),
        );
      }
    }
  }

  const nextTemp = new Float32Array(temp);
  for (let i = 0; i < particleCount; i += 1) {
    let t = temp[i] * 0.985;
    if (t < 0.001) {
      nextTemp[i] = 0;
      continue;
    }
    for (const ci of neighbors[i]) {
      const c = constraints[ci];
      if (!c.live) continue;
      const other = c.a === i ? c.b : c.a;
      t += (temp[other] - temp[i]) * 0.02;
    }
    nextTemp[i] = THREE.MathUtils.clamp(t, 0, 1.8);
  }
  temp.set(nextTemp);

  const positions = clothGeo.attributes.position.array;
  const indexArr = clothGeo.index.array;
  strain.fill(0);

  for (let i = 0; i < constraints.length; i += 1) {
    const c = constraints[i];
    if (!c.live) continue;
    const ap = c.a * 3;
    const bp = c.b * 3;
    const dx = pos[bp] - pos[ap];
    const dy = pos[bp + 1] - pos[ap + 1];
    const dz = pos[bp + 2] - pos[ap + 2];
    const dist = Math.hypot(dx, dy, dz);
    const s = Math.abs(dist - c.rest) / c.rest;
    strain[c.a] = Math.max(strain[c.a], s);
    strain[c.b] = Math.max(strain[c.b], s);
  }

  for (let i = 0; i < particleCount; i += 1) {
    positions[i * 3] = pos[i * 3];
    positions[i * 3 + 1] = pos[i * 3 + 1];
    positions[i * 3 + 2] = pos[i * 3 + 2];
  }

  for (let i = 0; i < indexArr.length; i += 3) {
    const a = indexArr[i];
    const b = indexArr[i + 1];
    const c = indexArr[i + 2];

    let alive = false;
    for (const ci of neighbors[a]) {
      const edge = constraints[ci];
      if (!edge.live) continue;
      if ((edge.a === a && (edge.b === b || edge.b === c)) || (edge.b === a && (edge.a === b || edge.a === c))) {
        alive = true;
        break;
      }
    }
    if (!alive) {
      positions[a * 3 + 1] = -9;
      positions[b * 3 + 1] = -9;
      positions[c * 3 + 1] = -9;
    }
  }

  clothGeo.attributes.position.needsUpdate = true;
  clothGeo.attributes.aTemp.needsUpdate = true;
  clothGeo.attributes.aStrain.needsUpdate = true;
  clothGeo.computeVertexNormals();
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.033);
  const t = clock.elapsedTime;
  uniforms.time.value = t;

  simStep(dt, t);
  updateSparks(dt);
  controls.update();
  renderer.render(scene, camera);

  const liveLinks = constraints.reduce((acc, c) => acc + (c.live ? 1 : 0), 0);
  const maxTemp = Math.max(...temp);
  statsEl.textContent = `Связей: ${liveLinks}/${constraints.length} · Огонь: ${burnMode ? 'ON' : 'OFF'} · Ветер: ${windEnabled ? 'ON' : 'OFF'} · maxHeat ${maxTemp.toFixed(2)}`;

  requestAnimationFrame(animate);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
