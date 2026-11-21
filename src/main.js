import * as THREE from "three";
import { createWorld, spriteURL } from "./world.js";
import { createPlayer } from "./player.js";
import { travelStops } from "./navigation.js";
import { createSoundscape } from "./soundscape.js";
import { characterFor } from "./dialogue.js";
import "./style.css";

const byId = (id) => document.getElementById(id);
const canvas = byId("view");
const entry = byId("entry");
const hud = byId("hud");
const begin = byId("begin");
const beginLabel = byId("begin-label");
const progressBar = byId("entry-progress");
const loadStatus = byId("load-status");
const interaction = byId("interact");
const conversation = byId("dialogue");
const options = byId("dialogue-options");
const speech = byId("speech");
const portrait = byId("portrait");
const cameraMode = byId("camera-mode");
const pointer = byId("pointer-lock");
const dayMode = byId("day-night");
const sundial = byId("sundial");
const timeLabel = byId("time-label");
const curtain = byId("travel-curtain");
const audioButton = byId("audio-toggle");
const waypoints=byId("landmark-menu");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const mb = bytes => `${(bytes / 1e6).toFixed(1)} MB`;
function progress({loaded,size,preparing}) {
  const percent = preparing ? 94 : Math.min(90,Math.floor(loaded * 90 / size));
  progressBar.style.setProperty("--progress", `${percent}%`);
  progressBar.setAttribute("aria-valuenow", percent);
  loadStatus.textContent = `${preparing ? "正在准备主城与立绘" : "正在加载乌鲁克主城"} · ${mb(loaded)} / ${mb(size)}`;
}

function showLoadError(message) {
  hud.hidden=true;
  entry.hidden=false;
  entry.dataset.stage="title";
  begin.disabled=false;
  beginLabel.textContent="点击重试";
  loadStatus.textContent=message;
  loadStatus.dataset.error="true";
  begin.addEventListener("click",()=>location.reload(),{once:true});
}

async function launch() {
  const world = await createWorld(canvas, progress);
  const sound = createSoundscape(world.soundAnchors,world.regions);
  const eye = new THREE.Vector3();
  const target = new THREE.Vector3();
  const clickRay = new THREE.Raycaster();
  const clickNDC = new THREE.Vector2();
  let started = false;
  let active = null;
  let nearby = null;
  let night = false;
  let clock = 0;
  let traveling = false;
  let caption = null;
  let lastTime = 0;
  let nextProximity = 0;
  let lastLocation = "";
  const canMove = () => started && !active && !traveling && !waypoints.open;
  const player = createPlayer(world, canvas, canMove, clickOnCharacter, sound.land);
  const profiles = new Map(world.npcs.map((npc) => [npc, characterFor(npc)]));
  const wildStatus=byId("wild-status");
  const wildRetry=byId("retry-wild");
  const wildButtons=Array.from(document.querySelectorAll("#wild-landmarks [data-travel]"));
  let graphicsLost=false;
  wildButtons.forEach(button=>{button.disabled=true;});
  async function startWild() {
    wildRetry.hidden=true;
    wildStatus.textContent="旷野加载中…";
    try {
      const anchors=await world.loadWild(({loaded,size,preparing})=>{
        wildStatus.textContent=`${preparing?"正在准备旷野":"旷野加载中…"} ${mb(loaded)} / ${mb(size)}`;
      });
      sound.addAnchors(anchors);
      for (const npc of world.npcs) if (!profiles.has(npc)) profiles.set(npc,characterFor(npc));
      wildButtons.forEach(button=>{button.disabled=false;});
      wildStatus.textContent="旷野已就绪";
    } catch (error) {
      console.error(error);
      wildStatus.textContent=`旷野加载失败：${error.message}`;
      wildRetry.hidden=false;
    }
  }
  wildRetry.addEventListener("click",startWild);
  canvas.addEventListener("webglcontextlost",()=>{
    graphicsLost=true;
    player.releasePointer();
    showLoadError("显卡中断了画面渲染。请关闭其他占用显卡的页面后重试。");
  });

  function reachable(npc) {
    const { position } = player;
    const range = npc.name === "npc_gilgamesh_01" ? 4.05 : 3.45;
    if (position.distanceTo(npc.point) > range || Math.abs(position.y - npc.point.y) > 1.25) return false;
    eye.copy(position).y += 1.49;
    target.copy(npc.point).y += 0.94;
    return world.blockers(eye, target) >= eye.distanceTo(target) - 0.12;
  }

  function clickOnCharacter(x, y) {
    const bounds = canvas.getBoundingClientRect();
    clickNDC.set((x - bounds.left) / bounds.width * 2 - 1, 1 - (y - bounds.top) / bounds.height * 2);
    clickRay.setFromCamera(clickNDC, world.camera);
    const acceptable = world.npcs.filter(reachable);
    const hit = clickRay.intersectObjects(acceptable.map((npc) => npc.mesh), false)[0];
    if (!hit) return false;
    talk(acceptable.find((npc) => npc.mesh === hit.object));
    return true;
  }

  function updateNearby() {
    if (!canMove()) {
      interaction.hidden = true;
      return;
    }
    let closest = null;
    let distance = Infinity;
    for (const npc of world.npcs) {
      const squared = npc.point.distanceToSquared(player.position);
      if (squared < distance && reachable(npc)) {
        closest = npc;
        distance = squared;
      }
    }
    if (nearby !== closest && closest) byId("nearby-name").textContent = profiles.get(closest).name;
    nearby = closest;
    interaction.hidden = !closest;
  }

  function option(label, onSelect, index) {
    const element = document.createElement("button");
    element.type = "button";
    const key = document.createElement("kbd");
    key.textContent = index + 1;
    const title = document.createElement("span");
    title.textContent = label;
    element.append(key, title);
    element.addEventListener("click", onSelect);
    return element;
  }

  function say(text, choices) {
    const characters = Array.from(text);
    byId("accessible-speech").textContent = text;
    caption = { text, characters, startedAt: performance.now(), shown: 0 };
    if (reducedMotion.matches) finishSpeech();
    else {
      speech.textContent = "";
      speech.dataset.typing = "true";
    }
    options.replaceChildren(...choices.map(([label, action], index) => option(label, action, index)));
    options.firstElementChild?.focus({ preventScroll: true });
  }

  function finishSpeech() {
    if (!caption) return;
    speech.textContent = caption.text;
    delete speech.dataset.typing;
    caption = null;
  }

  function animateSpeech(time) {
    if (!caption) return;
    const shown = Math.floor((time - caption.startedAt) / 24) + 1;
    if (shown >= caption.characters.length || reducedMotion.matches) {
      finishSpeech();
    } else if (shown > caption.shown) {
      speech.textContent = caption.characters.slice(0, shown).join("");
      caption.shown = shown;
    }
  }

  function talk(npc) {
    if (!npc || !canMove() || !reachable(npc)) return;
    const profile = profiles.get(npc);
    active = npc;
    player.clear();
    interaction.hidden = true;
    hud.inert = true;
    hud.dataset.talking = "true";
    player.releasePointer();
    byId("speaker-name").textContent = profile.name;
    byId("speaker-role").textContent = profile.role;
    portrait.src = spriteURL(npc.file);
    conversation.hidden = false;
    function menu() {
      say(profile.intro, [
        ...profile.questions.map(([title, answer, follow, followAnswer]) => [title, () => {
          say(answer, [
            ...(follow ? [[follow, () => say(followAnswer, [["再问一件事", menu], ["告辞", closeTalk]])]] : []),
            ["再问一件事", menu],
            ["告辞", closeTalk],
          ]);
        }]),
        ["告辞", closeTalk],
      ]);
    }
    menu();
  }

  function closeTalk() {
    if (!active) return;
    finishSpeech();
    active = null;
    conversation.hidden = true;
    hud.inert = false;
    delete hud.dataset.talking;
    canvas.focus({ preventScroll: true });
    updateNearby();
  }

  function toggleDay() {
    if (!canMove()) return;
    setClock(night ? 0 : 2);
  }

  function setClock(value) {
    clock = value;
    night = clock >= 1.5;
    world.setTime(clock);
    const text = clock < .48 ? "正午" : night ? "星夜" : "晚霞";
    sundial.value = clock;
    sundial.setAttribute("aria-valuetext", text);
    timeLabel.textContent = text;
    dayMode.setAttribute("aria-pressed", night);
    dayMode.setAttribute("aria-label", night ? "切换为日间" : "切换为夜间");
    document.documentElement.dataset.night = String(night);
  }

  async function travelTo(stop) {
    if (!canMove()) return;
    const destination=travelStops[stop];
    if (!destination) return;
    const [x,y,z]=destination.point;
    let ground;
    for (const [dx,dz] of [[0,0],[.45,0],[-.45,0],[0,.45],[0,-.45],[.8,.55],[-.8,.55],[.8,-.55],[-.8,-.55]]) {
      const support=world.floor(x+dx,z+dz,y,.68,1.14);
      if (support&&!world.occupied(x+dx,support.point.y,z+dz)){ground=support; break;}
    }
    if (!ground) return false;
    traveling = true;
    player.clear();
    nearby = null;
    updateNearby();
    curtain.dataset.active = "true";
    player.releasePointer();
    await new Promise((resolve) => setTimeout(resolve, reducedMotion.matches ? 0 : 210));
    player.relocate(ground.point);
    player.lookAt(new THREE.Vector3(...destination.look));
    updateCompass();
    if (!reducedMotion.matches) await new Promise((resolve) => setTimeout(resolve, 205));
    delete curtain.dataset.active;
    traveling = false;
    updateNearby();
    canvas.focus({ preventScroll: true });
    return true;
  }

  function toggleSound() {
    if (!canMove()) return;
    const muted = sound.toggle();
    audioButton.setAttribute("aria-pressed", muted);
    audioButton.setAttribute("aria-label", muted ? "开启声音" : "静音");
    audioButton.querySelector("span").textContent = muted ? "静音" : "声景";
    if (!muted) sound.unlock().catch(() => {});
  }

  function toggleCamera() {
    if (!canMove()) return;
    player.setShoulder(!player.shoulder);
    cameraMode.setAttribute("aria-pressed", player.shoulder);
    cameraMode.setAttribute("aria-label", player.shoulder ? "切换为第一人称" : "切换为越肩视角");
    cameraMode.querySelector("span").textContent = player.shoulder ? "越肩" : "第一人称";
  }

  function togglePointer() {
    if (!canMove()) return;
    if (player.pointerActive) player.releasePointer();
    else player.lockPointer();
  }

  dayMode.addEventListener("click", toggleDay);
  sundial.addEventListener("input", () => { if (canMove()) setClock(Number(sundial.value)); });
  sundial.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) event.stopPropagation();
  });
  for (const button of waypoints.querySelectorAll("[data-travel]")) {
    button.addEventListener("click", () => {
      waypoints.open=false;
      travelTo(button.dataset.travel);
    });
  }
  waypoints.addEventListener("toggle",()=>{
    if (!waypoints.open) return;
    player.clear();
    player.releasePointer();
    updateNearby();
  });
  document.addEventListener("pointerdown",event=>{
    if (waypoints.open&&!waypoints.contains(event.target)) waypoints.open=false;
  });
  audioButton.addEventListener("click", toggleSound);
  cameraMode.addEventListener("click", toggleCamera);
  pointer.addEventListener("click", togglePointer);
  hud.addEventListener("focusin", () => player.releasePointer());
  interaction.addEventListener("click", () => talk(nearby));
  byId("close-dialogue").addEventListener("click", closeTalk);
  speech.addEventListener("click", finishSpeech);
  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    pointer.setAttribute("aria-pressed", locked);
    pointer.setAttribute("aria-label", locked ? "释放鼠标视角" : "锁定鼠标视角");
    pointer.title = locked ? "释放鼠标 · Esc" : "锁定鼠标 · Q";
    hud.dataset.pointer = String(locked);
  });
  document.addEventListener("pointerlockerror", () => {
    pointer.title = "当前窗口限制指针锁定，可按住鼠标拖动视角";
  });
  if (!canvas.requestPointerLock) pointer.hidden = true;

  window.addEventListener("keydown", (event) => {
    if (!started || event.repeat || event.altKey || event.metaKey || event.ctrlKey) return;
    if (active) {
      if (event.code === "Escape") closeTalk();
      if (/^Digit[1-3]$/.test(event.code)) options.children[Number(event.code.at(-1)) - 1]?.click();
      if (event.code === "Tab") {
        const buttons = Array.from(conversation.querySelectorAll("button"));
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if (waypoints.open) {
      if (event.code==="Escape") { waypoints.open=false; waypoints.querySelector("summary").focus(); }
      return;
    }
    if (event.code === "Escape" && player.pointerActive) player.releasePointer();
    const action = { KeyE: () => talk(nearby), KeyN: toggleDay, KeyM: toggleSound, KeyV: toggleCamera, KeyQ: togglePointer }[event.code];
    if (action) {
      event.preventDefault();
      action();
    }
  });
  for (const button of document.querySelectorAll("[data-key]")) {
    const code = button.dataset.key;
    button.addEventListener("pointerdown", (event) => {
      button.setPointerCapture(event.pointerId);
      player.touchKey(code, true);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(type, () => player.touchKey(code, false));
    }
  }
  byId("jump-touch").addEventListener("pointerdown", (event) => {
    event.preventDefault();
    player.jump();
  });

  begin.addEventListener("click", (event) => {
    if (started) return;
    started = true;
    sound.unlock().catch(() => {});
    world.endPreview();
    entry.hidden = true;
    hud.hidden = false;
    canvas.focus({ preventScroll: true });
    if (event.pointerType !== "touch") player.lockPointer();
    updateNearby();
    setTimeout(startWild,0);
  });

  function updateCompass() {
    const heading = (360 - player.yaw * 180 / Math.PI + 360) % 360;
    const cardinals = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
    byId("direction").textContent = cardinals[Math.round(heading / 45) % 8];
    byId("degrees").textContent = `${String(Math.floor(heading)).padStart(3, "0")}°`;
    const [cn, en] = world.regions.label(player.position);
    if (lastLocation !== cn) {
      lastLocation = cn;
      byId("district-cn").textContent = cn;
      byId("district-en").textContent = en;
    }
  }

  function frame(time) {
    if (graphicsLost) return;
    const seconds = Math.min(0.085, (time - (lastTime || time)) / 1000);
    lastTime = time;
    if (!started) {
      world.preview(time, reducedMotion.matches);
      requestAnimationFrame(frame);
      return;
    }
    player.update(seconds);
    animateSpeech(time);
    if (time >= nextProximity) {
      nextProximity = time + 92;
      if (started) {
        updateCompass();
        updateNearby();
      }
    }
    sound.update(player.position, player.yaw, night, time);
    world.render(player.position, time, player.yaw, player.shoulder, !player.isGrounded);
    requestAnimationFrame(frame);
  }

  function revealTitle() {
    entry.dataset.stage = "title";
    beginLabel.textContent = "踏入乌鲁克";
    loadStatus.textContent = "键盘行走 · 移动鼠标转向";
    entry.querySelector(".entry-content").dataset.ready = "true";
    progressBar.style.setProperty("--progress","100%");
    progressBar.setAttribute("aria-valuenow","100");
    begin.disabled = false;
  }
  revealTitle();
  requestAnimationFrame(frame);

  if (import.meta.env.DEV && new URLSearchParams(location.search).has("acceptance")) {
    window.urukAcceptance = () => ({
      position: player.position.toArray(), camera: world.camera.position.toArray(),
      yaw: player.yaw, pitch: player.pitch, shoulder: player.shoulder, night, started,
      clock, phase: world.timePhase, traveling, locked: player.pointerActive,
      npc: nearby?.name, dialogue: active?.name, counts: world.counts, audioRunning: sound.running,
      isGrounded: player.isGrounded, velocityY: player.velocityY, landings: sound.landings, westMix: sound.westMix,
      candidates:world.collisionCandidates, area:world.regions.label(player.position)[0], audioMix:sound.mix,
      render:world.frameStats,
    });
    window.urukQA={
      aim(x,y,z){player.lookAt(new THREE.Vector3(x,y,z));},
      place(x,y,z,look){const h=world.floor(x,z,y,.6,1.5); if(!h||world.occupied(x,h.point.y,z))return false;
        player.relocate(h.point); if(look)player.lookAt(new THREE.Vector3(...look)); return true;},
      key(code,down){player.touchKey(code,down);},
      walkPath(points) {
        const direction = new THREE.Vector3();
        const samples = [];
        player.clear();
        player.touchKey("KeyW",true);
        player.touchKey("ShiftLeft",true);
        try {
          for (const [x,y,z] of points) {
            const distance = () => Math.hypot(player.position.x-x,player.position.z-z);
            const limit = Math.ceil(distance()/.16)+35;
            for (let i=0;i<limit && distance()>.115;i++) {
              player.lookAt(direction.set(x,y+1.66,z));
              player.update(Math.min(1/30,distance()/5.7));
            }
            samples.push({ target:[x,y,z], position:player.position.toArray(), reached:distance()<=.115 });
            if (distance()>.115) break;
          }
        } finally { player.clear(); }
        return samples;
      },
      probe(x,y,z){const h=world.floor(x,z,y,.6,1.5);return {height:h?.point.y,surface:h?.object.name,occupied:h?world.occupied(x,h.point.y,z):true};},
      cast:()=>world.npcs.map(({name,point,file})=>({name,position:point.toArray(),file})),
    };
  }
}

launch().catch((error) => {
  console.error(error);
  showLoadError(`城邦加载失败：${error.message}`);
});
