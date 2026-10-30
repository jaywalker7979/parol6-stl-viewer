import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

const FOLDER_LABEL = {
  BASE: "베이스",
  SHOULDER: "어깨",
  UPPER_ARM: "상완",
  ELBOW: "팔꿈치",
  FOREARM: "전완",
  WRIST: "손목",
  GRIPPER_ATTACHMENTS: "그리퍼",
  ESTOP: "비상정지",
  SMALL_PRINT_BED: "작은 출력 베드",
  UTILITY: "유틸",
  "mounting plates": "마운팅 플레이트",
};

const FOLDER_ORDER = Object.keys(FOLDER_LABEL);

const listEl = document.querySelector("#list");
const queryEl = document.querySelector("#query");
const countEl = document.querySelector("#count");
const nameEl = document.querySelector("#part-name");
const metaEl = document.querySelector("#part-meta");
const statusEl = document.querySelector("#status");
const bannerEl = document.querySelector("#banner");
const canvas = document.querySelector("#view");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x101318, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xf4f7fb, 0x1c2430, 1.15));
const key = new THREE.DirectionalLight(0xffffff, 1.35);
key.position.set(240, 380, 180);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9eb4cc, 0.55);
fill.position.set(-220, 120, -160);
scene.add(fill);

const grid = new THREE.GridHelper(500, 20, 0x3c4654, 0x2a3340);
scene.add(grid);

const material = new THREE.MeshStandardMaterial({
  color: 0xd7dee7,
  metalness: 0.06,
  roughness: 0.45,
});

const loader = new STLLoader();
let mesh = null;
let home = null;
let spin = false;
let wire = false;
let loadToken = 0;
let parts = [];

function formatBytes(n) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMm(n) {
  return `${n.toFixed(n >= 100 ? 0 : 1)} mm`;
}

function setStatus(text) {
  statusEl.hidden = !text;
  statusEl.textContent = text || "";
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight || 1;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function frameObject(size, center) {
  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  const dist = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.35;
  camera.near = Math.max(radius / 200, 0.05);
  camera.far = Math.max(dist * 20, 1000);
  camera.position.set(center.x + dist * 0.72, center.y + dist * 0.48, center.z + dist * 0.86);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  const gridSize = Math.max(200, Math.ceil(Math.max(size.x, size.z) * 1.8 / 50) * 50);
  grid.scale.set(gridSize / 500, 1, gridSize / 500);
  home = {
    position: camera.position.clone(),
    target: controls.target.clone(),
  };
}

function showGeometry(geometry) {
  geometry.computeVertexNormals();
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const center = new THREE.Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -box.min.y, -center.z);
  geometry.computeBoundingBox();
  const placed = geometry.boundingBox;
  const size = new THREE.Vector3();
  placed.getSize(size);

  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = 0;
  scene.add(mesh);
  frameObject(size, new THREE.Vector3(0, size.y / 2, 0));
  return size;
}

function fileUrl(path) {
  return new URL(`../${path}`, window.location.href).href;
}

function loadPart(part) {
  const token = ++loadToken;
  nameEl.textContent = part.name;
  metaEl.textContent = `${FOLDER_LABEL[part.folder] || part.folder} · ${formatBytes(part.bytes)}`;
  setStatus(part.bytes > 15 * 1024 * 1024 ? "큰 파일을 읽는 중입니다…" : "불러오는 중…");
  document.querySelectorAll(".item").forEach((button) => {
    button.classList.toggle("active", button.dataset.path === part.path);
  });

  loader.load(
    fileUrl(part.path),
    (geometry) => {
      if (token !== loadToken) {
        geometry.dispose();
        return;
      }
      const size = showGeometry(geometry);
      metaEl.textContent = `${FOLDER_LABEL[part.folder] || part.folder} · ${formatBytes(part.bytes)} · 가로 ${formatMm(size.x)} · 높이 ${formatMm(size.y)} · 깊이 ${formatMm(size.z)} · 삼각형 ${Math.round(geometry.attributes.position.count / 3).toLocaleString("ko-KR")}`;
      setStatus("");
    },
    (event) => {
      if (token !== loadToken || !event.lengthComputable) return;
      const pct = Math.round((event.loaded / event.total) * 100);
      setStatus(`불러오는 중 ${pct}%`);
    },
    () => {
      if (token !== loadToken) return;
      setStatus("");
      bannerEl.hidden = false;
      bannerEl.textContent = "이 파일을 읽지 못했습니다. 페이지를 저장소 루트에서 서빙하고 있는지 확인해 주세요.";
    },
  );
}

function renderList() {
  const query = queryEl.value.trim().toLowerCase();
  const visible = parts.filter((part) => part.name.toLowerCase().includes(query) || part.folder.toLowerCase().includes(query));
  countEl.textContent = `${visible.length}개`;
  listEl.replaceChildren();

  const folders = [...new Set(visible.map((part) => part.folder))].sort((a, b) => {
    const ai = FOLDER_ORDER.indexOf(a);
    const bi = FOLDER_ORDER.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  for (const folder of folders) {
    const group = document.createElement("section");
    group.className = "group";
    const title = document.createElement("h3");
    title.textContent = FOLDER_LABEL[folder] || folder;
    group.append(title);
    for (const part of visible.filter((item) => item.folder === folder)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "item";
      button.dataset.path = part.path;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = part.name;
      const size = document.createElement("span");
      size.className = "size";
      size.textContent = formatBytes(part.bytes);
      button.append(name, size);
      button.addEventListener("click", () => loadPart(part));
      group.append(button);
    }
    listEl.append(group);
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (spin && mesh) mesh.rotation.y += 0.006;
  controls.update();
  renderer.render(scene, camera);
}

document.querySelector("#wire").addEventListener("click", (event) => {
  wire = !wire;
  material.wireframe = wire;
  event.currentTarget.classList.toggle("on", wire);
});

document.querySelector("#spin").addEventListener("click", (event) => {
  spin = !spin;
  event.currentTarget.classList.toggle("on", spin);
});

document.querySelector("#reset").addEventListener("click", () => {
  if (!home) return;
  camera.position.copy(home.position);
  controls.target.copy(home.target);
  if (mesh) mesh.rotation.y = 0;
  controls.update();
});

queryEl.addEventListener("input", renderList);
window.addEventListener("resize", resize);

if (location.protocol === "file:") {
  bannerEl.hidden = false;
  bannerEl.textContent = "파일을 직접 열면 STL을 불러올 수 없습니다. 저장소 루트에서 웹 서버로 이 페이지를 여세요.";
}

resize();
animate();

const manifest = await fetch(new URL("./manifest.json", window.location.href));
parts = (await manifest.json()).parts;
renderList();
const starter = parts.find((part) => part.name === "J4_limiter.STL") || parts[0];
if (starter) loadPart(starter);
