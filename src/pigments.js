import * as THREE from "three";

export function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const SIZE = 1024;

function canvas(size = SIZE) {
  const surface = document.createElement("canvas");
  surface.width = surface.height = size;
  return surface;
}

function softenedGrid(size, random, resolution) {
  const points = Float32Array.from({ length: size * size }, random);
  const line = Array.from({ length: resolution }, (_, i) => {
    const u = i * size / resolution;
    const whole = Math.floor(u);
    const t = u - whole;
    return [whole, (whole + 1) % size, t * t * (3 - 2 * t)];
  });
  return (x, y) => {
    const [a, b, u] = line[x];
    const [c, d, v] = line[y];
    const upper = points[c * size + a] * (1 - u) + points[c * size + b] * u;
    const lower = points[d * size + a] * (1 - u) + points[d * size + b] * u;
    return upper * (1 - v) + lower * v;
  };
}

function groundPigment(ctx, random, kind) {
  const size = ctx.canvas.width;
  const base = softenedGrid(7, random, size);
  const grain = softenedGrid(kind === "pot" ? 61 : 43, random, size);
  const image = ctx.createImageData(size, size);
  const contrast = { clay: [33, 18, 15], stone: [26, 18, 17], sand: [34, 26, 24], cloth: [19, 12, 10], pot: [22, 14, 20], marsh: [40, 24, 23], strata: [38, 22, 21] }[kind];
  const jitter = { clay: [2, 0, -3], stone: [2, 1, 0], sand: [2, 0, -5], cloth: [2, 1, 0], pot: [2, 0, -3], marsh: [-5, 4, -8], strata: [5, -1, -7] }[kind];
  for (let y = 0; y < size; y++) {
    const strata = kind === "clay" ? Math.sin(y * .161) * 1.7 + Math.sin(y * .043) * 2.0 : 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const pigment = 238 + (base(x, y) - .5) * contrast[0]
        + (grain(x, y) - .5) * contrast[1] + (random() - .5) * contrast[2] + strata;
      const weave = kind === "cloth" ? ((x % 5 === 1) ? 7 : 0) + ((y % 7 < 2) ? 11 : 0) : 0;
      image.data[i] = pigment - weave + jitter[0];
      image.data[i + 1] = pigment - weave + jitter[1];
      image.data[i + 2] = pigment - weave + jitter[2];
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function stroke(ctx, coords, style, width) {
  ctx.beginPath();
  ctx.moveTo(...coords[0]);
  coords.slice(1).forEach((xy) => ctx.lineTo(...xy));
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
}

function clay(ctx, rand) {
  // Broken horizontal courses, with most seams buried under an eroded plaster wash.
  for (let row = 0; row < 9; row++) {
    const y = row * (SIZE / 9) + 9;
    let x = row % 2 ? -114 : -9;
    while (x < SIZE) {
      const span = 135 + rand() * 200;
      const shift = (rand() - .5) * 4;
      if (rand() > .18) {
        stroke(ctx, [[x, y], [x + span * .29, y + shift], [x + span * .69, y + 1], [x + span, y]],
          "rgba(105,79,72,.18)", 1.1 + rand() * 2.5);
        stroke(ctx, [[x + 7, y + 4], [x + span * .48, y + 5], [x + span - 10, y + 4]],
          "rgba(255,243,218,.45)", 2.0);
        if (rand() > .16) stroke(ctx, [[x + span, y], [x + span - 2, y + 56], [x + span + 3, y + 111]],
          "rgba(112,81,75,.13)", 1.65);
      }
      x += span;
    }
  }
  for (let i = 0; i < 780; i++) {
    const x = rand() * SIZE, y = rand() * SIZE;
    const w = 3 + rand() ** 2 * 48;
    ctx.fillStyle = i % 3 ? "rgba(108,77,62,.070)" : "rgba(255,248,224,.23)";
    ctx.fillRect(x, y, w, .8 + rand() * 2.1);
  }
}

function stone(ctx, rand) {
  for (let row = 0; row < 4; row++) {
    const y = row * 256 + 6;
    stroke(ctx, [[0, y + 1], [252, y + 3], [502, y], [756, y + 2], [1024, y]],
      "rgba(102,91,113,.18)", 3.7);
    const offset = row % 2 ? 127 : 0;
    for (let i = -1; i < 4; i++) {
      const x = i * 342 + offset;
      stroke(ctx, [[x, y], [x + 2, y + 135], [x + 1, y + 256]], "rgba(104,90,106,.15)", 2.7);
      stroke(ctx, [[x + 4, y + 8], [x + 5, y + 140], [x + 3, y + 251]], "rgba(255,253,240,.41)", 3.2);
      const dx = 40 + rand() * 70;
      stroke(ctx, [[x + dx, y + 6], [x + dx + 16, y + 27], [x + dx + 35, y + 32], [x + dx + 45, y + 43]],
        "rgba(116,101,113,.11)", 1 + rand());
    }
  }
  for (let i = 0; i < 86; i++) {
    const x = rand() * SIZE, y = rand() * SIZE;
    ctx.fillStyle = "rgba(118,95,105,.085)";
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rand() * 6, 1 + rand() * 2, rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function sand(ctx, rand) {
  for (let i = 0; i < 12900; i++) {
    const x = rand() * SIZE, y = rand() * SIZE;
    const w = 1 + rand() ** 3 * 4.1;
    ctx.fillStyle = i % 4 ? "rgba(105,73,58,.13)" : "rgba(255,249,228,.55)";
    ctx.fillRect(x, y, w, .65 + w * .35);
  }
  for (let i = 0; i < 47; i++) {
    const x = rand() * SIZE, y = rand() * SIZE, w = rand() * 48 + 14;
    stroke(ctx, [[x, y], [x + w * .45, y + rand() * 4], [x + w, y - 2]], "rgba(147,123,101,.095)", 1.9);
  }
}

function cloth(ctx, rand) {
  for (let i = 0; i < 710; i++) {
    const x = rand() * SIZE, y = rand() * SIZE;
    const w = 9 + rand() * 52;
    stroke(ctx, [[x, y], [x + w, y + (i % 2 ? 1 : -1)]],
      i % 3 ? "rgba(252,248,234,.11)" : "rgba(103,79,94,.16)", .75);
  }
}

function pot(ctx, rand) {
  for (let i = 0; i < 1800; i++) {
    const x = rand() * SIZE, y = rand() * SIZE;
    ctx.fillStyle = i % 4 ? "rgba(119,79,56,.13)" : "rgba(255,241,207,.43)";
    ctx.fillRect(x, y, .55 + rand() * 2.5, .6 + rand());
  }
}

function marsh(ctx, rand) {
  for (let i=0;i<6800;i++) {
    const x=rand()*SIZE,y=rand()*SIZE,l=4+rand()**3*22;
    stroke(ctx,[[x,y],[x+l*.53,y-3],[x+l,y-5+rand()*4]],i%3?"rgba(94,111,66,.22)":"rgba(225,231,159,.42)",.35+rand()*1.04);
  }
}
function strata(ctx, rand) {
  for (let row=0;row<36;row++) {
    const y=(row+.1+rand()*.59)*SIZE/36;
    const a=1.5+rand()*4.4;
    for(let k=0;k<29;k++) {
      const start=rand()*SIZE, end=start+15+rand()*150;
      stroke(ctx,[[start,y+a*Math.sin(start*.023)],[start+(end-start)*.56,y+a*.52],[end,y-a*.67]],
        k%3?"rgba(114,77,75,.18)":"rgba(255,216,173,.44)",.6+rand()*2);
    }
  }
}

function microGrain(anisotropy) {
  const surface = canvas(256);
  const ctx = surface.getContext("2d");
  const image = ctx.createImageData(256, 256);
  const random = seeded(893192);
  const cloud = softenedGrid(96, random, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      const value = Math.round(212 + ((cloud(x, y) - .5) * 47) + (random() - .53) * 28);
      image.data[i] = image.data[i+1] = image.data[i+2] = value;
      image.data[i+3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(surface);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(8, anisotropy);
  return texture;
}

export function makePigments(anisotropy, compact = false) {
  const surfaces = Object.fromEntries(Object.entries({ clay, stone, sand, cloth, pot, marsh, strata }).map(([kind, finish], index) => {
    const highResolution = !compact && ["stone","sand","marsh","strata"].includes(kind);
    const surface = canvas(highResolution ? 2048 : SIZE);
    const random = seeded(42113 + index * 7771);
    const ctx = surface.getContext("2d");
    groundPigment(ctx, random, kind);
    if (highResolution) ctx.scale(2, 2);
    finish(ctx, random);
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(8, anisotropy);
    return [kind, texture];
  }));
  surfaces.micro = microGrain(anisotropy);
  return surfaces;
}

export function pigmentFor(name) {
  if (/^wild_terrain_/.test(name)) return ["sand", [.32,.32], .86];
  if (/^(?:rework_stratified|rework_talus_|wild_rock_)/.test(name)) return ["strata", [.275,.52], .96];
  if (/^(?:rework_bridge_|wild_ashlar|wild_sandstone)/.test(name)) return ["stone", [.37,.51], .77];
  if (/^(?:rework_mud_|rework_plaster|rework_roof_daubs|wild_aged_brick|wild_brown_brick)/.test(name)) return ["clay", [.48,.55],.92];
  if (/^(?:rework_berm_|rework_compacted|farm_soil|wild_road|wild_silt)/.test(name)) return ["sand", [.54,.50],.88];
  if (/^(?:wild_thatch|wild_weave|rework_pale_reed|rework_golden_mats|wild_cloth)/.test(name)) return ["cloth", [.83,.91],.92];
  if (/^(?:wild_cotta|wild_jar|polish_jar)/.test(name)) return ["pot", [.94,1.06],.72];
  if (/^(mud_|plaster_recess|distant_brick|roof_|joint)/.test(name)) return ["clay", [0.285, 0.46], 0.91];
  if (/^(white_plaster|cream_|pale_quay|quay_|plinth_|stone_road)/.test(name)) return ["stone", [0.33, 0.43], name === "white_plaster" ? .52 : .86];
  if (/^(sand_|field_|soil_)/.test(name)) return ["sand", [0.38, 0.38], .91];
  if (/^(cloth_|cape_|robe_)/.test(name)) return ["cloth", [0.83, 0.91], .86];
  if (/^jar_/.test(name)) return ["pot", [1.28, 1.32], .70];
  return null;
}
