// Begehbares 3D-Büro (Ich-Perspektive) mit three.js.
// Alles wird prozedural erzeugt, es gibt keine externen Modelle.

import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

const EYE = 1.62;
const SEAT_EYE = 1.22;
const SPEED = 3.4;
const RADIUS = 0.32;
const ROOM = { minX: -11, maxX: 11, minZ: -9, maxZ: 9 };

// Schreibtische: zwei Reihen à drei Plätze, Stuhl jeweils auf der +z-Seite
export const DESKS = [
  { x: -6, z: -2 }, { x: 0, z: -2 }, { x: 6, z: -2 },
  { x: -6, z: 3.5 }, { x: 0, z: 3.5 }, { x: 6, z: 3.5 },
];

// Laufweg des Chefs (aus seinem Büro durch die Gänge und zurück)
const BOSS_PATH = [
  [-8, -7.2], [-8, -4.3], [-9.3, 0.8], [9.3, 0.8], [9.3, 6.3], [-9.3, 6.3], [-9.3, 0.8], [-8, -4.3], [-8, -7.2],
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
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

function box(w, h, d, color, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.8, metalness: opts.metalness ?? 0, ...opts.mat });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  return m;
}

function person(color, { suit = false } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.75, 6, 12),
    new THREE.MeshStandardMaterial({ color: suit ? 0x22252e : color, roughness: 0.7 }),
  );
  body.position.y = 0.85;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf1c7a0, roughness: 0.6 }));
  head.position.y = 1.55;
  g.add(head);
  // Headset bzw. Krawatte
  if (suit) {
    const tie = box(0.08, 0.4, 0.02, 0xd02030);
    tie.position.set(0, 1.12, 0.27);
    g.add(tie);
  } else {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.025, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    band.position.y = 1.58;
    g.add(band);
    const mic = box(0.03, 0.03, 0.16, 0x111111);
    mic.position.set(0.17, 1.47, 0.1);
    g.add(mic);
  }
  // Augen, damit man sieht, wohin die Figur schaut
  for (const dx of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    eye.position.set(dx, 1.58, 0.18);
    g.add(eye);
  }
  return g;
}

export function createOffice(container, handlers) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d24);
  scene.fog = new THREE.Fog(0x1b1d24, 22, 45);

  const camera = new THREE.PerspectiveCamera(72, container.clientWidth / container.clientHeight, 0.05, 80);
  camera.position.set(0, EYE, 7.5);
  camera.lookAt(0, EYE, 0);

  const controls = new PointerLockControls(camera, renderer.domElement);
  controls.addEventListener("lock", () => handlers.onLockChange?.(true));
  controls.addEventListener("unlock", () => handlers.onLockChange?.(false));

  // Licht
  scene.add(new THREE.HemisphereLight(0xeef2ff, 0x8a8070, 1.2));
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1dd, 0.8);
  sun.position.set(-6, 10, 4);
  scene.add(sun);

  const colliders = []; // { minX, maxX, minZ, maxZ }
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
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(22, 18), new THREE.MeshStandardMaterial({ map: carpet, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(22, 18), new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 1 }));
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
  // Neonröhren-Licht über den Schreibtischreihen
  for (const [x, z] of [[-6, 0.5], [0, 0.5], [6, 0.5], [-7, -7], [7, -6]]) {
    const lamp = new THREE.PointLight(0xfff8ee, 9, 11, 1.2);
    lamp.position.set(x, 3, z);
    scene.add(lamp);
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9c5b8, roughness: 0.95 });
  const walls = [
    [0, ROOM.minZ, 22, 0.2], [0, ROOM.maxZ, 22, 0.2], [ROOM.minX, 0, 0.2, 18], [ROOM.maxX, 0, 0.2, 18],
  ];
  for (const [x, z, w, d] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 3.2, d), wallMat);
    m.position.set(x, 1.6, z);
    scene.add(m);
  }
  // Fenster an der rechten Wand
  for (let z = -6; z <= 6; z += 4) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4), new THREE.MeshBasicMaterial({ color: 0x9cc8ff }));
    win.position.set(ROOM.maxX - 0.11, 1.8, z);
    win.rotation.y = -Math.PI / 2;
    scene.add(win);
  }
  // Fußleiste
  const skirting = new THREE.MeshStandardMaterial({ color: 0x5a5a5a });
  for (const [x, z, w, d] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.12, d + 0.02), skirting);
    m.position.set(x, 0.06, z);
    scene.add(m);
  }

  // Chefbüro mit Glaswand (hinten links)
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.25, roughness: 0.1 });
  // Front in zwei Teilen mit Tür dazwischen (x ≈ -8.5)
  for (const [x, w] of [[-10.2, 1.6], [-6.95, 1.5]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, 0.08), glass);
    m.position.set(x, 1.3, -5.5);
    scene.add(m);
    addCollider(x, -5.5, w, 0.2);
  }
  const side = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.6, 3.5), glass);
  side.position.set(-6.25, 1.3, -7.25);
  scene.add(side);
  addCollider(-6.25, -7.25, 0.2, 3.5);
  const bossDesk = box(1.8, 0.78, 0.9, 0x5b3a24);
  bossDesk.position.set(-8.6, 0.39, -8.1);
  scene.add(bossDesk);
  addCollider(-8.6, -8.1, 1.8, 0.9);
  const bossSign = label("CHEF", "#ffcc33", 0.9);
  bossSign.position.set(-8.3, 2.75, -5.45);
  scene.add(bossSign);

  // Kaffeemaschine und Pflanzen
  const coffee = new THREE.Group();
  const counter = box(1.6, 0.9, 0.6, 0x6d6f78);
  counter.position.y = 0.45;
  coffee.add(counter);
  const machine = box(0.45, 0.55, 0.4, 0x1e1e1e, { metalness: 0.4, roughness: 0.4 });
  machine.position.set(-0.3, 1.18, 0);
  coffee.add(machine);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0xffffff }));
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

  for (const [x, z] of [[-10.3, 8.3], [10.3, 8.3], [3.5, -8.4], [10.3, -3]]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.45, 12), new THREE.MeshStandardMaterial({ color: 0x8a5a3c }));
    pot.position.set(x, 0.22, z);
    scene.add(pot);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: 0x3f8f4f, flatShading: true }));
    leaves.position.set(x, 0.85, z);
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
  board.position.set(1.5, 1.9, ROOM.minZ + 0.12);
  scene.add(board);
  let boardKey = "";
  function drawBoard(st) {
    const minutes = Math.floor(Math.min(1, st.elapsed / st.dayLength) * 8 * 60);
    const time = `${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
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

  // Schreibtische
  const deskObjs = DESKS.map((d, i) => {
    const g = new THREE.Group();
    g.position.set(d.x, 0, d.z);
    const top = box(1.9, 0.06, 0.95, 0xb8b0a0);
    top.position.y = 0.76;
    g.add(top);
    for (const [lx, lz] of [[-0.88, -0.4], [0.88, -0.4], [-0.88, 0.4], [0.88, 0.4]]) {
      const leg = box(0.05, 0.76, 0.05, 0x555555);
      leg.position.set(lx, 0.38, lz);
      g.add(leg);
    }
    // Trennwand
    const divider = box(1.9, 0.5, 0.05, 0x55657f);
    divider.position.set(0, 1.04, -0.47);
    g.add(divider);
    // Monitor
    const stand = box(0.08, 0.25, 0.08, 0x222222);
    stand.position.set(0, 0.92, -0.2);
    g.add(stand);
    const frame = box(0.7, 0.45, 0.04, 0x1a1a1a);
    frame.position.set(0, 1.25, -0.2);
    g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.39), new THREE.MeshBasicMaterial({ color: 0x2255aa }));
    screen.position.set(0, 1.25, -0.178);
    g.add(screen);
    const keyboard = box(0.45, 0.02, 0.15, 0x2a2a2a);
    keyboard.position.set(0, 0.8, 0.12);
    g.add(keyboard);
    // Telefon mit Klingel-Lampe
    const phone = box(0.22, 0.07, 0.18, 0x2b2b2b);
    phone.position.set(0.6, 0.82, -0.05);
    g.add(phone);
    const handset = box(0.22, 0.05, 0.06, 0x111111);
    handset.position.set(0.6, 0.88, -0.11);
    g.add(handset);
    const ringLamp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0x441111 }));
    ringLamp.position.set(0.68, 0.87, 0.03);
    g.add(ringLamp);
    // Stuhl
    const chair = new THREE.Group();
    const seat = box(0.5, 0.08, 0.5, 0x2f3340);
    seat.position.y = 0.48;
    chair.add(seat);
    const back = box(0.5, 0.55, 0.06, 0x2f3340);
    back.position.set(0, 0.8, 0.25);
    chair.add(back);
    const post = box(0.06, 0.44, 0.06, 0x444444);
    post.position.y = 0.22;
    chair.add(post);
    chair.position.set(0, 0, 0.8);
    g.add(chair);
    // Namensschild
    const sign = label(`Platz ${i + 1}`, "#9aa0b4", 0.8);
    sign.position.set(0, 1.75, -0.47);
    g.add(sign);

    scene.add(g);
    addCollider(d.x, d.z, 1.95, 1.0);
    g.userData.interact = { type: "desk", desk: i };
    interactables.push(g);
    return { group: g, screen, ringLamp, sign, chair };
  });

  // Andere Spieler und Chef
  const avatars = new Map(); // playerId -> { group, tag, target }
  const boss = person(0x22252e, { suit: true });
  boss.scale.setScalar(1.12);
  const bossTag = label("👔 CHEF", "#ff8a8a", 0.9);
  bossTag.position.y = 2.15;
  boss.add(bossTag);
  boss.position.set(-8, 0, -7.2);
  scene.add(boss);

  // Steuerung
  const keys = new Set();
  let seatedDesk = null;
  let focus = null;
  let state = null;
  let myId = null;
  let camAnim = null;

  function onKey(e, down) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const k = e.code;
    if (down) keys.add(k);
    else keys.delete(k);
    if (down && k === "KeyE" && controls.isLocked && focus) interact(focus);
  }
  document.addEventListener("keydown", (e) => onKey(e, true));
  document.addEventListener("keyup", (e) => onKey(e, false));
  renderer.domElement.addEventListener("click", () => {
    if (seatedDesk === null && handlers.canMove?.()) controls.lock();
  });

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
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  function updateFocus() {
    focus = null;
    if (!controls.isLocked) return handlers.onFocus?.(null);
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects(interactables, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.interact) o = o.parent;
      focus = o || null;
    }
    let text = null;
    if (focus) {
      const it = focus.userData.interact;
      if (it.type === "coffee") text = "[E] Kaffee holen";
      if (it.type === "desk") {
        const mine = state && state.players.find((p) => p.id === myId);
        const owner = state && state.players.find((p) => p.desk === it.desk);
        if (mine && mine.desk === it.desk) text = "[E] Hinsetzen";
        else text = owner ? `Platz von ${owner.name}` : "Freier Platz";
      }
    }
    handlers.onFocus?.(text);
  }

  function move(dt) {
    if (!controls.isLocked || seatedDesk !== null) return;
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
    const len = Math.hypot(dx, dz);
    if (!len) return;
    const sprint = keys.has("ShiftLeft") ? 1.6 : 1;
    const step = (SPEED * sprint * dt) / len;
    const nx = camera.position.x + dx * step;
    const nz = camera.position.z + dz * step;
    // Achsenweise prüfen, damit man an Wänden entlangrutscht
    if (!collides(nx, camera.position.z)) camera.position.x = nx;
    if (!collides(camera.position.x, nz)) camera.position.z = nz;
    camera.position.y = EYE + Math.sin(performance.now() / 120) * 0.025;
  }

  function animateCamera(toPos, lookAt, duration = 0.6) {
    const fromPos = camera.position.clone();
    const fromQ = camera.quaternion.clone();
    const tmp = camera.clone();
    tmp.position.copy(toPos);
    tmp.lookAt(lookAt);
    camAnim = { fromPos, fromQ, toPos: toPos.clone(), toQ: tmp.quaternion.clone(), t: 0, duration };
  }

  function sitAt(desk) {
    const d = DESKS[desk];
    seatedDesk = desk;
    if (controls.isLocked) controls.unlock();
    animateCamera(new THREE.Vector3(d.x, SEAT_EYE, d.z + 0.75), new THREE.Vector3(d.x, 1.15, d.z - 0.2));
  }

  function stand() {
    if (seatedDesk === null) return;
    const d = DESKS[seatedDesk];
    seatedDesk = null;
    animateCamera(new THREE.Vector3(d.x, EYE, d.z + 1.6), new THREE.Vector3(d.x, EYE - 0.1, d.z - 2));
  }

  function bossPosition(t) {
    // Position entlang des Laufwegs, t von 0 bis 1
    const segs = [];
    let total = 0;
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
    drawBoard(state);
    const t = performance.now() / 1000;
    const ringing = state.queue.length > 0;

    deskObjs.forEach((d, i) => {
      const owner = state.players.find((p) => p.desk === i);
      setLabel(d.sign, owner ? owner.name : `Platz ${i + 1}`, owner ? owner.color : "#9aa0b4");
      const onCall = owner && owner.callId;
      d.screen.material.color.set(!owner ? 0x111318 : onCall ? 0x1f8a4c : 0x2255aa);
      const blink = owner && !onCall && ringing && Math.floor(t * 4) % 2 === 0;
      d.ringLamp.material.color.set(blink ? 0xff2020 : 0x441111);
    });

    // Avatare der anderen
    const seen = new Set();
    for (const p of state.players) {
      if (p.id === myId) continue;
      seen.add(p.id);
      let a = avatars.get(p.id);
      if (!a) {
        const group = person(new THREE.Color(p.color).getHex());
        const tag = label(p.name, p.color, 0.9);
        tag.position.y = 2.05;
        group.add(tag);
        scene.add(group);
        a = { group, tag };
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
      g.position.x += (tx - g.position.x) * Math.min(1, dt * 8);
      g.position.z += (tz - g.position.z) * Math.min(1, dt * 8);
      g.position.y = p.seated ? -0.35 : 0;
      g.rotation.y = ry;
      g.visible = p.online;
    }
    for (const [pid, a] of avatars) {
      if (!seen.has(pid)) {
        scene.remove(a.group);
        avatars.delete(pid);
      }
    }

    // Chef läuft während seines Besuchs durchs Büro
    if (state.phase === "day" && state.bossVisit > 0) {
      const bp = bossPosition(1 - state.bossVisit / state.bossVisitLength);
      boss.position.x += (bp.x - boss.position.x) * Math.min(1, dt * 6);
      boss.position.z += (bp.z - boss.position.z) * Math.min(1, dt * 6);
      boss.rotation.y = bp.ry;
      boss.position.y = Math.abs(Math.sin(t * 8)) * 0.05;
    } else {
      boss.position.set(-8.6, 0, -7.3);
      boss.rotation.y = 0;
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
    lock: () => controls.lock(),
    unlock: () => controls.unlock(),
    isLocked: () => controls.isLocked,
    isSeated: () => seatedDesk !== null,
    // Spawn vor dem eigenen Platz (z. B. bei Tagesbeginn)
    placeNear(desk) {
      const d = DESKS[desk];
      seatedDesk = null;
      camAnim = null;
      camera.position.set(d.x, EYE, d.z + 1.7);
      camera.lookAt(d.x, EYE - 0.15, d.z - 2);
    },
    pose() {
      camera.getWorldDirection(forward);
      return { x: camera.position.x, z: camera.position.z, ry: Math.atan2(forward.x, forward.z) };
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.dispose();
    },
  };
}
