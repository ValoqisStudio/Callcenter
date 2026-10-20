// Begehbares 3D-Büro (Ich-Perspektive) mit three.js.
// Alles wird prozedural erzeugt, es gibt keine externen Modelle.
// Am PC steuert man mit Maus und Tastatur, am Handy mit Joystick und Wischen.

import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

const EYE = 1.62;
const SEAT_EYE = 1.22;
const SPEED = 3.4;
const RADIUS = 0.32;
const ROOM = { minX: -11, maxX: 11, minZ: -9, maxZ: 9 };

export const IS_TOUCH = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

// Schreibtische: zwei Reihen à drei Plätze, Stuhl jeweils auf der +z-Seite
export const DESKS = [
  { x: -6, z: -2 }, { x: 0, z: -2 }, { x: 6, z: -2 },
  { x: -6, z: 3.5 }, { x: 0, z: 3.5 }, { x: 6, z: 3.5 },
];

// Laufweg des Chefs (aus seinem Büro durch die Gänge und zurück)
const BOSS_PATH = [
  [-8.5, -7.2], [-8.5, -4.3], [-9.3, 0.8], [9.3, 0.8], [9.3, 6.3], [-9.3, 6.3], [-9.3, 0.8], [-8.5, -4.3], [-8.5, -7.2],
];

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function label(text, color = "#ffffff", scale = 1) {
  const tex = canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = "rgba(20,22,30,0.75)";
    g.beginPath();
    g.roundRect(8, 24, w - 16, h - 48, 30);
    g.fill();
    g.font = "bold 52px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 2);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.6 * scale, 0.4 * scale, 1);
  sprite.userData.text = text;
  return sprite;
}

function setLabel(sprite, text, color) {
  if (sprite.userData.text === text) return;
  const fresh = label(text, color);
  sprite.material.map.dispose();
  sprite.material.map = fresh.material.map;
  sprite.material.needsUpdate = true;
  sprite.userData.text = text;
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...opts });
}

function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.material || mat(color, opts.mat));
  m.castShadow = opts.shadow !== false;
  m.receiveShadow = true;
  return m;
}

// Einfache Figur mit Armen und Beinen; userData.limbs für die Laufanimation
function person(color, { suit = false } = {}) {
  const g = new THREE.Group();
  const clothes = mat(suit ? 0x22252e : color, { roughness: 0.7 });
  const pants = mat(suit ? 0x1a1c22 : 0x2c3344);
  const skin = mat(0xf1c7a0, { roughness: 0.6 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.45, 6, 12), clothes);
  torso.position.y = 1.15;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 14), skin);
  head.position.y = 1.68;
  head.castShadow = true;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.195, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2.2), mat(suit ? 0x888888 : 0x3b2a1e));
  hair.position.y = 1.7;
  g.add(hair);

  const limbs = [];
  const limb = (geomLen, radius, material, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, geomLen, 4, 8), material);
    m.position.y = -geomLen / 2 - radius;
    m.castShadow = true;
    pivot.add(m);
    g.add(pivot);
    limbs.push(pivot);
    return pivot;
  };
  limb(0.5, 0.075, pants, -0.11, 0.8); // Beine
  limb(0.5, 0.075, pants, 0.11, 0.8);
  limb(0.42, 0.06, clothes, -0.31, 1.38); // Arme
  limb(0.42, 0.06, clothes, 0.31, 1.38);
  g.userData.limbs = limbs;

  if (suit) {
    const tie = box(0.07, 0.36, 0.02, 0xd02030, { shadow: false });
    tie.position.set(0, 1.25, 0.24);
    g.add(tie);
  } else {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.022, 6, 16, Math.PI), mat(0x111111));
    band.position.y = 1.71;
    g.add(band);
    const mic = box(0.025, 0.025, 0.15, 0x111111, { shadow: false });
    mic.position.set(0.16, 1.6, 0.1);
    g.add(mic);
  }
  for (const dx of [-0.065, 0.065]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    eye.position.set(dx, 1.71, 0.17);
    g.add(eye);
  }
  return g;
}

function animateLimbs(g, phase, amount) {
  const [lLeg, rLeg, lArm, rArm] = g.userData.limbs;
  const s = Math.sin(phase) * 0.6 * amount;
  lLeg.rotation.x = s;
  rLeg.rotation.x = -s;
  lArm.rotation.x = -s * 0.8;
  rArm.rotation.x = s * 0.8;
}

function seatPose(g) {
  const [lLeg, rLeg, lArm, rArm] = g.userData.limbs;
  lLeg.rotation.x = rLeg.rotation.x = -1.4;
  lArm.rotation.x = rArm.rotation.x = -1.0;
}

export function createOffice(container, handlers) {
  const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !IS_TOUCH;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d24);

  const camera = new THREE.PerspectiveCamera(IS_TOUCH ? 75 : 72, container.clientWidth / container.clientHeight, 0.05, 80);
  camera.position.set(0, EYE, 7.5);
  camera.lookAt(0, EYE, 0);

  const controls = new PointerLockControls(camera, renderer.domElement);
  controls.addEventListener("lock", () => handlers.onLockChange?.(true));
  controls.addEventListener("unlock", () => handlers.onLockChange?.(false));

  // Licht
  scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x8a8070, 0.9));
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xfff1dd, 1.6);
  sun.position.set(9, 12, 3);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 11, bottom: -11, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  for (const [x, z] of [[-6, 0.5], [0, 0.5], [6, 0.5], [-8, -7], [7, -6]]) {
    const lamp = new THREE.PointLight(0xfff8ee, 7, 11, 1.2);
    lamp.position.set(x, 3, z);
    scene.add(lamp);
  }

  const colliders = [];
  const interactables = [];
  const addCollider = (x, z, w, d) => colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

  // Boden, Decke, Wände
  const carpet = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = "#3a4256";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = Math.random() < 0.5 ? "#353c4f" : "#414a60";
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = "#2f3546";
    g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
  });
  carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
  carpet.repeat.set(11, 9);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(22, 18), mat(0xffffff, { map: carpet, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const tiles = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = "#e4e3dc";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#b9b8b0";
    g.lineWidth = 4;
    g.strokeRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = "#d3d2ca";
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
  });
  tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
  tiles.repeat.set(18, 15);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(22, 18), mat(0xffffff, { map: tiles, roughness: 1 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 3.2;
  scene.add(ceiling);
  for (let x = -8; x <= 8; x += 4) {
    for (let z = -6; z <= 6; z += 4) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.6), new THREE.MeshBasicMaterial({ color: 0xfafaff }));
      panel.rotation.x = Math.PI / 2;
      panel.position.set(x, 3.19, z);
      scene.add(panel);
    }
  }

  const wallMat = mat(0xd3cfc2, { roughness: 0.95 });
  const walls = [
    [0, ROOM.minZ, 22, 0.2], [0, ROOM.maxZ, 22, 0.2], [ROOM.minX, 0, 0.2, 18], [ROOM.maxX, 0, 0.2, 18],
  ];
  for (const [x, z, w, d] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 3.2, d), wallMat);
    m.position.set(x, 1.6, z);
    m.receiveShadow = true;
    scene.add(m);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.12, d + 0.02), mat(0x5a5a5a));
    skirt.position.set(x, 0.06, z);
    scene.add(skirt);
  }

  // Fenster mit Stadtpanorama an der rechten Wand
  const skyline = canvasTexture(512, 256, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#7fb6f0");
    sky.addColorStop(1, "#d7ecff");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w;) {
      const bw = 30 + Math.random() * 50;
      const bh = 60 + Math.random() * 150;
      const shade = 90 + Math.floor(Math.random() * 60);
      g.fillStyle = `rgb(${shade - 20},${shade - 10},${shade + 10})`;
      g.fillRect(x, h - bh, bw, bh);
      g.fillStyle = "rgba(255,240,180,0.55)";
      for (let wy = h - bh + 8; wy < h - 6; wy += 14) {
        for (let wx = x + 5; wx < x + bw - 6; wx += 10) if (Math.random() < 0.45) g.fillRect(wx, wy, 5, 7);
      }
      x += bw + 4;
    }
  });
  for (let z = -6; z <= 6; z += 4) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.5), new THREE.MeshBasicMaterial({ map: skyline }));
    win.position.set(ROOM.maxX - 0.11, 1.8, z);
    win.rotation.y = -Math.PI / 2;
    scene.add(win);
    // Rahmen aus vier Leisten plus Mittelsprosse
    for (const [dy, dz, h, w] of [[0.78, 0, 0.06, 2.72], [-0.78, 0, 0.06, 2.72], [0, 1.33, 1.62, 0.06], [0, -1.33, 1.62, 0.06], [0, 0, 0.04, 2.6]]) {
      const bar = box(0.05, h, w, 0xeeeeee, { shadow: false });
      bar.position.set(ROOM.maxX - 0.13, 1.8 + dy, z + dz);
      scene.add(bar);
    }
  }

  // Poster an der linken Wand
  const posters = [
    ["LÄCHELN!", "Kunden hören das.", "#ff7a59"],
    ["MITARBEITER", "DES MONATS: ???", "#4b7bec"],
    ["ERFOLG", "ist kein Zufall.", "#20bf6b"],
  ];
  posters.forEach(([title, sub, color], i) => {
    const tex = canvasTexture(256, 340, (g, w, h) => {
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#fff";
      g.font = "bold 40px system-ui";
      g.textAlign = "center";
      g.fillText(title, w / 2, 120);
      g.font = "26px system-ui";
      g.fillText(sub, w / 2, 175);
      g.font = "90px system-ui";
      g.fillText(["😁", "🏆", "📈"][i], w / 2, 290);
    });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    p.position.set(ROOM.minX + 0.12, 1.75, -2 + i * 3.5);
    p.rotation.y = Math.PI / 2;
    scene.add(p);
  });

  // Wanduhr über der Tür zeigt die Spielzeit
  const clockCanvas = document.createElement("canvas");
  clockCanvas.width = clockCanvas.height = 256;
  const clockTex = new THREE.CanvasTexture(clockCanvas);
  clockTex.colorSpace = THREE.SRGBColorSpace;
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.4, 32), new THREE.MeshBasicMaterial({ map: clockTex }));
  clock.position.set(-4, 2.55, ROOM.maxZ - 0.12);
  clock.rotation.y = Math.PI;
  scene.add(clock);
  let clockKey = "";
  function drawClock(minutes) {
    const key = String(Math.floor(minutes / 2));
    if (key === clockKey) return;
    clockKey = key;
    const g = clockCanvas.getContext("2d");
    g.fillStyle = "#fafafa";
    g.beginPath();
    g.arc(128, 128, 124, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = "#222";
    g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillStyle = "#222";
      g.fillRect(128 + Math.sin(a) * 100 - 3, 128 - Math.cos(a) * 100 - 3, 6, 6);
    }
    const hour = 9 + minutes / 60;
    const hand = (angle, len, width) => {
      g.lineWidth = width;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(128, 128);
      g.lineTo(128 + Math.sin(angle) * len, 128 - Math.cos(angle) * len);
      g.stroke();
    };
    hand(((hour % 12) / 12) * Math.PI * 2, 60, 10);
    hand(((minutes % 60) / 60) * Math.PI * 2, 92, 6);
    clockTex.needsUpdate = true;
  }

  // Eingangstür (nur Deko)
  const door = box(1.1, 2.2, 0.06, 0x7a5a3a);
  door.position.set(0, 1.1, ROOM.maxZ - 0.13);
  scene.add(door);
  const exit = label("AUSGANG", "#4cd18a", 0.6);
  exit.position.set(0, 2.5, ROOM.maxZ - 0.2);
  scene.add(exit);

  // Chefbüro mit Glaswand (hinten links), Tür bei x ≈ -8.5
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.22, roughness: 0.05 });
  for (const [x, w] of [[-10.2, 1.6], [-6.95, 1.5]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, 0.06), glass);
    m.position.set(x, 1.3, -5.5);
    scene.add(m);
    addCollider(x, -5.5, w, 0.2);
  }
  const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 3.5), glass);
  side.position.set(-6.25, 1.3, -7.25);
  scene.add(side);
  addCollider(-6.25, -7.25, 0.2, 3.5);
  const bossDesk = box(1.8, 0.78, 0.9, 0x5b3a24, { mat: { roughness: 0.5 } });
  bossDesk.position.set(-8.6, 0.39, -8.1);
  scene.add(bossDesk);
  addCollider(-8.6, -8.1, 1.8, 0.9);
  const bossSign = label("CHEF", "#ffcc33", 0.9);
  bossSign.position.set(-8.3, 2.75, -5.45);
  scene.add(bossSign);

  // Kaffeeecke
  const coffee = new THREE.Group();
  const counter = box(1.6, 0.9, 0.6, 0x6d6f78);
  counter.position.y = 0.45;
  coffee.add(counter);
  const machine = box(0.45, 0.55, 0.4, 0x1e1e1e, { mat: { metalness: 0.5, roughness: 0.35 } });
  machine.position.set(-0.3, 1.18, 0);
  coffee.add(machine);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 12), mat(0xffffff));
  cup.position.set(0.3, 0.95, 0);
  coffee.add(cup);
  coffee.position.set(8.5, 0, -8.5);
  scene.add(coffee);
  addCollider(8.5, -8.5, 1.6, 0.6);
  coffee.userData.interact = { type: "coffee" };
  interactables.push(coffee);
  const coffeeSign = label("☕ Kaffee", "#ffffff", 0.8);
  coffeeSign.position.set(8.5, 2, -8.5);
  scene.add(coffeeSign);

  // Wasserspender, Drucker, Aktenschränke, Pflanzen
  const cooler = new THREE.Group();
  const coolerBase = box(0.38, 1.0, 0.38, 0xeeeeee);
  coolerBase.position.y = 0.5;
  cooler.add(coolerBase);
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.45, 16), new THREE.MeshStandardMaterial({ color: 0x66aaff, transparent: true, opacity: 0.6, roughness: 0.1 }));
  bottle.position.y = 1.23;
  cooler.add(bottle);
  cooler.position.set(6.6, 0, -8.6);
  scene.add(cooler);
  addCollider(6.6, -8.6, 0.4, 0.4);

  const printer = box(0.7, 0.4, 0.55, 0xdddddd);
  printer.position.set(10.5, 1.0, 3);
  scene.add(printer);
  const printerTable = box(0.9, 0.8, 0.7, 0x777a84);
  printerTable.position.set(10.5, 0.4, 3);
  scene.add(printerTable);
  addCollider(10.5, 3, 0.9, 0.7);

  for (let i = 0; i < 3; i++) {
    const cab = box(0.6, 1.3, 0.55, 0x8a8f99, { mat: { metalness: 0.3, roughness: 0.5 } });
    cab.position.set(-1 + i * 0.65, 0.65, ROOM.minZ + 0.4);
    scene.add(cab);
    for (let d = 0; d < 3; d++) {
      const handle = box(0.16, 0.03, 0.02, 0x333333, { shadow: false });
      handle.position.set(-1 + i * 0.65, 0.3 + d * 0.4, ROOM.minZ + 0.68);
      scene.add(handle);
    }
  }
  addCollider(-0.35, ROOM.minZ + 0.4, 1.95, 0.6);

  for (const [x, z] of [[-10.3, 8.3], [10.3, 8.3], [4.2, -8.4], [10.3, -3]]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.45, 12), mat(0x8a5a3c));
    pot.position.set(x, 0.22, z);
    pot.castShadow = true;
    scene.add(pot);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), mat(0x3f8f4f, { flatShading: true }));
    leaves.position.set(x, 0.85, z);
    leaves.castShadow = true;
    scene.add(leaves);
    addCollider(x, z, 0.5, 0.5);
  }

  // Whiteboard mit Quote und Uhrzeit
  const boardCanvas = document.createElement("canvas");
  boardCanvas.width = 1024;
  boardCanvas.height = 512;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: boardTex }));
  board.position.set(4.5, 1.9, ROOM.minZ + 0.12);
  scene.add(board);
  let boardKey = "";
  function drawBoard(st, minutes, time) {
    const key = `${st.day}|${time}|${Math.round(st.earned)}|${st.quota}`;
    if (key === boardKey) return;
    boardKey = key;
    const g = boardCanvas.getContext("2d");
    g.fillStyle = "#f4f4ef";
    g.fillRect(0, 0, 1024, 512);
    g.strokeStyle = "#888";
    g.lineWidth = 16;
    g.strokeRect(0, 0, 1024, 512);
    g.fillStyle = "#1f3f9f";
    g.font = "bold 70px 'Comic Sans MS', system-ui";
    g.fillText(`TAG ${st.day}  ·  ${time} Uhr`, 50, 110);
    g.fillStyle = "#222";
    g.font = "bold 60px 'Comic Sans MS', system-ui";
    g.fillText(`QUOTE: ${Math.round(st.earned)} / ${st.quota} €`, 50, 220);
    const pct = Math.max(0, Math.min(1, st.earned / st.quota));
    g.strokeStyle = "#222";
    g.lineWidth = 6;
    g.strokeRect(50, 270, 920, 70);
    g.fillStyle = pct >= 1 ? "#2c9a5a" : "#d33";
    g.fillRect(56, 276, 908 * pct, 58);
    g.fillStyle = "#c22";
    g.font = "48px 'Comic Sans MS', system-ui";
    g.fillText(pct >= 1 ? "Quote geschafft! 🎉" : "LÄCHELN AM TELEFON!!!", 50, 430);
    boardTex.needsUpdate = true;
  }

  // Monitor-Bilder (geteilt von allen Schreibtischen)
  const screenTex = (title, color, icon) => canvasTexture(320, 196, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.15)";
    g.fillRect(0, 0, w, 22);
    g.fillStyle = "#fff";
    g.font = "bold 14px system-ui";
    g.fillText("CallOS 98", 8, 16);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(20, 40, w - 40, h - 70);
    g.fillStyle = "#fff";
    g.font = "48px system-ui";
    g.textAlign = "center";
    g.fillText(icon, w / 2, 110);
    g.font = "bold 20px system-ui";
    g.fillText(title, w / 2, 150);
  });
  const SCREENS = {
    off: new THREE.MeshBasicMaterial({ color: 0x0c0e12 }),
    idle: new THREE.MeshBasicMaterial({ map: screenTex("Bereit", "#2256a8", "🖥️") }),
    ringing: new THREE.MeshBasicMaterial({ map: screenTex("Eingehender Anruf!", "#a82222", "📞") }),
    call: new THREE.MeshBasicMaterial({ map: screenTex("Im Gespräch", "#1f8a4c", "🎧") }),
  };

  // Schreibtische
  const chairMat = mat(0x2f3340, { roughness: 0.6 });
  const deskObjs = DESKS.map((d, i) => {
    const g = new THREE.Group();
    g.position.set(d.x, 0, d.z);
    const top = box(1.9, 0.05, 0.95, 0xc9bfac, { mat: { roughness: 0.55 } });
    top.position.y = 0.76;
    g.add(top);
    for (const lx of [-0.9, 0.9]) {
      const side2 = box(0.04, 0.74, 0.85, 0x6b6f78);
      side2.position.set(lx, 0.37, 0);
      g.add(side2);
    }
    const divider = box(1.9, 0.55, 0.05, 0x55657f, { mat: { roughness: 1 } });
    divider.position.set(0, 1.06, -0.47);
    g.add(divider);
    // Monitor
    const stand = box(0.06, 0.22, 0.06, 0x222222);
    stand.position.set(0, 0.89, -0.22);
    g.add(stand);
    const foot = box(0.25, 0.02, 0.18, 0x222222);
    foot.position.set(0, 0.79, -0.22);
    g.add(foot);
    const frame = box(0.74, 0.46, 0.04, 0x15161a);
    frame.position.set(0, 1.23, -0.22);
    g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.4), SCREENS.idle);
    screen.position.set(0, 1.23, -0.198);
    g.add(screen);
    const keyboard = box(0.45, 0.02, 0.15, 0x2a2a2a);
    keyboard.position.set(0, 0.79, 0.12);
    g.add(keyboard);
    const mouse = box(0.06, 0.02, 0.1, 0x2a2a2a);
    mouse.position.set(0.33, 0.79, 0.14);
    g.add(mouse);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 12), mat([0xff7ab6, 0x5ab4ff, 0xffcc33, 0x4cd18a, 0xb38cff, 0xff8a5c][i]));
    mug.position.set(-0.6, 0.83, 0.1);
    g.add(mug);
    // Telefon mit Klingel-Lampe
    const phone = box(0.22, 0.07, 0.18, 0x2b2b2b);
    phone.position.set(0.62, 0.81, -0.05);
    g.add(phone);
    const handset = box(0.22, 0.05, 0.06, 0x111111);
    handset.position.set(0.62, 0.87, -0.11);
    g.add(handset);
    const ringLamp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0x441111 }));
    ringLamp.position.set(0.7, 0.86, 0.03);
    g.add(ringLamp);
    // Bürostuhl mit Fußkreuz
    const chair = new THREE.Group();
    const seat = box(0.5, 0.08, 0.5, 0, { material: chairMat });
    seat.position.y = 0.48;
    chair.add(seat);
    const back = box(0.48, 0.55, 0.06, 0, { material: chairMat });
    back.position.set(0, 0.82, 0.25);
    chair.add(back);
    const post = box(0.05, 0.4, 0.05, 0x444444);
    post.position.y = 0.24;
    chair.add(post);
    for (let k = 0; k < 5; k++) {
      const leg = box(0.3, 0.03, 0.04, 0x444444);
      leg.position.set(Math.cos((k / 5) * Math.PI * 2) * 0.15, 0.05, Math.sin((k / 5) * Math.PI * 2) * 0.15);
      leg.rotation.y = -(k / 5) * Math.PI * 2;
      chair.add(leg);
    }
    chair.position.set(0, 0, 0.8);
    g.add(chair);
    const sign = label(`Platz ${i + 1}`, "#9aa0b4", 0.8);
    sign.position.set(0, 1.8, -0.47);
    g.add(sign);

    scene.add(g);
    addCollider(d.x, d.z, 1.95, 1.0);
    g.userData.interact = { type: "desk", desk: i };
    interactables.push(g);
    return { group: g, screen, ringLamp, sign };
  });

  // Andere Spieler und Chef
  const avatars = new Map();
  const boss = person(0x22252e, { suit: true });
  boss.scale.setScalar(1.1);
  const bossTag = label("👔 CHEF", "#ff8a8a", 0.9);
  bossTag.position.y = 2.15;
  boss.add(bossTag);
  boss.position.set(-8.6, 0, -7.3);
  scene.add(boss);

  // -------------------------------------------------------------------------
  // Steuerung: Maus/Tastatur (Pointer Lock) oder Touch (Joystick + Wischen)
  // -------------------------------------------------------------------------

  const keys = new Set();
  let seatedDesk = null;
  let focus = null;
  let state = null;
  let myId = null;
  let camAnim = null;
  let touchActive = false;
  const moveInput = { x: 0, y: 0 };
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const isActive = () => controls.isLocked || touchActive;

  function onKey(e, down) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (down) keys.add(e.code);
    else keys.delete(e.code);
    if (down && e.code === "KeyE" && isActive() && focus) interact(focus);
  }
  document.addEventListener("keydown", (e) => onKey(e, true));
  document.addEventListener("keyup", (e) => onKey(e, false));
  renderer.domElement.addEventListener("click", () => {
    if (!IS_TOUCH && seatedDesk === null && handlers.canMove?.()) controls.lock();
  });

  // Touch-Bedienelemente
  const ui = document.createElement("div");
  ui.className = "touch-ui hidden";
  ui.innerHTML = `<div class="joystick"><div class="knob"></div></div><button class="use-btn hidden">✋ Benutzen</button>`;
  container.appendChild(ui);
  const stick = ui.querySelector(".joystick");
  const knob = ui.querySelector(".knob");
  const useBtn = ui.querySelector(".use-btn");
  let stickId = null;
  let lookId = null;
  let lookLast = null;

  stick.addEventListener("pointerdown", (e) => {
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    updateStick(e);
  });
  stick.addEventListener("pointermove", (e) => { if (e.pointerId === stickId) updateStick(e); });
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    moveInput.x = moveInput.y = 0;
    knob.style.transform = "";
  };
  stick.addEventListener("pointerup", endStick);
  stick.addEventListener("pointercancel", endStick);
  function updateStick(e) {
    const r = stick.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    moveInput.x = dx;
    moveInput.y = dy;
    knob.style.transform = `translate(${dx * 35}px, ${dy * 35}px)`;
  }

  renderer.domElement.style.touchAction = "none";
  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (!touchActive || e.pointerType === "mouse" || lookId !== null) return;
    lookId = e.pointerId;
    lookLast = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookId || seatedDesk !== null || camAnim) return;
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= (e.clientX - lookLast.x) * 0.006;
    euler.x = Math.max(-1.3, Math.min(1.3, euler.x - (e.clientY - lookLast.y) * 0.006));
    camera.quaternion.setFromEuler(euler);
    lookLast = { x: e.clientX, y: e.clientY };
  });
  const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
  renderer.domElement.addEventListener("pointerup", endLook);
  renderer.domElement.addEventListener("pointercancel", endLook);
  useBtn.addEventListener("click", () => focus && interact(focus));

  function updateTouchUi() {
    ui.classList.toggle("hidden", !(touchActive && seatedDesk === null));
  }

  function activate() {
    if (IS_TOUCH) {
      touchActive = true;
      updateTouchUi();
      handlers.onLockChange?.(true);
    } else {
      controls.lock();
    }
  }

  function interact(obj) {
    const it = obj.userData.interact;
    if (it.type === "desk") {
      const mine = state && state.players.find((p) => p.id === myId);
      if (mine && mine.desk === it.desk) handlers.onSit?.();
      else handlers.onHint?.("Das ist nicht dein Platz.");
    } else if (it.type === "coffee") {
      handlers.onCoffee?.();
    }
  }

  function collides(x, z) {
    if (x < ROOM.minX + RADIUS || x > ROOM.maxX - RADIUS || z < ROOM.minZ + RADIUS || z > ROOM.maxZ - RADIUS) return true;
    return colliders.some((c) => x > c.minX - RADIUS && x < c.maxX + RADIUS && z > c.minZ - RADIUS && z < c.maxZ + RADIUS);
  }

  const raycaster = new THREE.Raycaster();
  raycaster.far = 2.8;
  const center = new THREE.Vector2(0, 0);
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  function updateFocus() {
    focus = null;
    if (!isActive() || seatedDesk !== null) {
      useBtn.classList.add("hidden");
      return handlers.onFocus?.(null);
    }
    raycaster.setFromCamera(center, camera);
    const hits = raycaster.intersectObjects(interactables, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.interact) o = o.parent;
      focus = o || null;
    }
    // Wer direkt vor dem eigenen Stuhl steht, kann sich immer hinsetzen
    const mineNow = state && state.players.find((p) => p.id === myId);
    if (!focus && mineNow) {
      const d = DESKS[mineNow.desk];
      if (Math.hypot(camera.position.x - d.x, camera.position.z - (d.z + 0.9)) < 1.2) focus = deskObjs[mineNow.desk].group;
    }
    let text = null;
    let usable = false;
    if (focus) {
      const it = focus.userData.interact;
      if (it.type === "coffee") {
        text = IS_TOUCH ? "Kaffee holen" : "[E] Kaffee holen";
        usable = true;
      }
      if (it.type === "desk") {
        const mine = state && state.players.find((p) => p.id === myId);
        const owner = state && state.players.find((p) => p.desk === it.desk);
        if (mine && mine.desk === it.desk) {
          text = IS_TOUCH ? "Hinsetzen" : "[E] Hinsetzen";
          usable = true;
        } else {
          text = owner ? `Platz von ${owner.name}` : "Freier Platz";
        }
      }
    }
    useBtn.classList.toggle("hidden", !usable);
    if (usable) useBtn.textContent = `✋ ${text}`;
    handlers.onFocus?.(text);
  }

  let walkPhase = 0;
  function move(dt) {
    if (!isActive() || seatedDesk !== null || camAnim) return;
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up).normalize();
    let dx = 0;
    let dz = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) { dx += forward.x; dz += forward.z; }
    if (keys.has("KeyS") || keys.has("ArrowDown")) { dx -= forward.x; dz -= forward.z; }
    if (keys.has("KeyD") || keys.has("ArrowRight")) { dx += right.x; dz += right.z; }
    if (keys.has("KeyA") || keys.has("ArrowLeft")) { dx -= right.x; dz -= right.z; }
    dx += forward.x * -moveInput.y + right.x * moveInput.x;
    dz += forward.z * -moveInput.y + right.z * moveInput.x;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const sprint = keys.has("ShiftLeft") ? 1.6 : 1;
    const step = (SPEED * sprint * dt * Math.min(1, len)) / len;
    const nx = camera.position.x + dx * step;
    const nz = camera.position.z + dz * step;
    // Achsenweise prüfen, damit man an Wänden entlangrutscht
    if (!collides(nx, camera.position.z)) camera.position.x = nx;
    if (!collides(camera.position.x, nz)) camera.position.z = nz;
    walkPhase += dt * 9;
    camera.position.y = EYE + Math.sin(walkPhase) * 0.025;
  }

  function animateCamera(toPos, lookAt, duration = 0.6) {
    const tmp = camera.clone();
    tmp.position.copy(toPos);
    tmp.lookAt(lookAt);
    camAnim = { fromPos: camera.position.clone(), fromQ: camera.quaternion.clone(), toPos: toPos.clone(), toQ: tmp.quaternion.clone(), t: 0, duration };
  }

  function sitAt(desk) {
    const d = DESKS[desk];
    seatedDesk = desk;
    if (controls.isLocked) controls.unlock();
    updateTouchUi();
    animateCamera(new THREE.Vector3(d.x, SEAT_EYE, d.z + 0.75), new THREE.Vector3(d.x, 1.15, d.z - 0.2));
  }

  function stand() {
    if (seatedDesk === null) return;
    const d = DESKS[seatedDesk];
    seatedDesk = null;
    updateTouchUi();
    animateCamera(new THREE.Vector3(d.x, EYE, d.z + 1.6), new THREE.Vector3(d.x, EYE - 0.1, d.z - 2));
  }

  function bossPosition(t) {
    let total = 0;
    const segs = [];
    for (let i = 1; i < BOSS_PATH.length; i++) {
      const [ax, az] = BOSS_PATH[i - 1];
      const [bx, bz] = BOSS_PATH[i];
      const len = Math.hypot(bx - ax, bz - az);
      segs.push({ ax, az, bx, bz, len });
      total += len;
    }
    let dist = t * total;
    for (const s of segs) {
      if (dist <= s.len) {
        const f = dist / s.len;
        return { x: s.ax + (s.bx - s.ax) * f, z: s.az + (s.bz - s.az) * f, ry: Math.atan2(s.bx - s.ax, s.bz - s.az) };
      }
      dist -= s.len;
    }
    const [x, z] = BOSS_PATH[BOSS_PATH.length - 1];
    return { x, z, ry: 0 };
  }

  function sync(dt) {
    if (!state) return;
    const minutes = Math.floor(Math.min(1, state.elapsed / state.dayLength) * 8 * 60);
    const time = `${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    drawBoard(state, minutes, time);
    drawClock(minutes);
    const t = performance.now() / 1000;
    const ringing = state.phase === "day" && state.queue.length > 0;

    deskObjs.forEach((d, i) => {
      const owner = state.players.find((p) => p.desk === i);
      setLabel(d.sign, owner ? owner.name : `Platz ${i + 1}`, owner ? owner.color : "#9aa0b4");
      const onCall = owner && owner.callId;
      const blink = owner && !onCall && ringing && Math.floor(t * 4) % 2 === 0;
      d.screen.material = !owner ? SCREENS.off : onCall ? SCREENS.call : ringing ? SCREENS.ringing : SCREENS.idle;
      d.ringLamp.material.color.set(blink ? 0xff2020 : 0x441111);
    });

    const seen = new Set();
    for (const p of state.players) {
      if (p.id === myId) continue;
      seen.add(p.id);
      let a = avatars.get(p.id);
      if (!a) {
        const group = person(new THREE.Color(p.color).getHex());
        const tag = label(p.name, p.color, 0.9);
        tag.position.y = 2.1;
        group.add(tag);
        scene.add(group);
        a = { group, tag, phase: 0 };
        avatars.set(p.id, a);
      }
      setLabel(a.tag, p.callId ? `📞 ${p.name}` : p.name, p.color);
      let tx = p.pos.x;
      let tz = p.pos.z;
      let ry = p.pos.ry;
      if (p.seated) {
        const d = DESKS[p.desk];
        tx = d.x;
        tz = d.z + 0.85;
        ry = Math.PI;
      }
      const g = a.group;
      const ox = g.position.x;
      const oz = g.position.z;
      g.position.x += (tx - g.position.x) * Math.min(1, dt * 8);
      g.position.z += (tz - g.position.z) * Math.min(1, dt * 8);
      g.rotation.y = ry;
      g.visible = p.online;
      if (p.seated) {
        g.position.y = -0.3;
        seatPose(g);
      } else {
        g.position.y = 0;
        const speed = Math.hypot(g.position.x - ox, g.position.z - oz) / Math.max(dt, 0.001);
        a.phase += dt * 9;
        animateLimbs(g, a.phase, Math.min(1, speed / 2));
      }
    }
    for (const [pid, a] of avatars) {
      if (!seen.has(pid)) {
        scene.remove(a.group);
        avatars.delete(pid);
      }
    }

    if (state.phase === "day" && state.bossVisit > 0) {
      const bp = bossPosition(1 - state.bossVisit / state.bossVisitLength);
      boss.position.x += (bp.x - boss.position.x) * Math.min(1, dt * 6);
      boss.position.z += (bp.z - boss.position.z) * Math.min(1, dt * 6);
      boss.rotation.y = bp.ry;
      animateLimbs(boss, t * 9, 1);
    } else {
      boss.position.set(-8.6, 0, -7.3);
      boss.rotation.y = 0;
      animateLimbs(boss, 0, 0);
    }
  }

  let last = performance.now();
  let raf = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (camAnim) {
      camAnim.t += dt / camAnim.duration;
      const k = Math.min(1, camAnim.t);
      const e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, e);
      camera.quaternion.slerpQuaternions(camAnim.fromQ, camAnim.toQ, e);
      if (k >= 1) camAnim = null;
    }
    move(dt);
    updateFocus();
    sync(dt);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);

  function resize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }
  window.addEventListener("resize", resize);

  return {
    update(newState, playerId) {
      state = newState;
      myId = playerId;
    },
    sitAt,
    stand,
    activate,
    deactivate() {
      touchActive = false;
      updateTouchUi();
      if (controls.isLocked) controls.unlock();
    },
    isActive,
    isSeated: () => seatedDesk !== null,
    // Vor den eigenen Platz stellen (z. B. bei Tagesbeginn)
    placeNear(desk) {
      const d = DESKS[desk];
      seatedDesk = null;
      camAnim = null;
      camera.position.set(d.x, EYE, d.z + 1.7);
      camera.lookAt(d.x, EYE - 0.15, d.z - 2);
      updateTouchUi();
    },
    pose() {
      camera.getWorldDirection(forward);
      return { x: camera.position.x, z: camera.position.z, ry: Math.atan2(forward.x, forward.z) };
    },
  };
}
