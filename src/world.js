import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { makePigments, pigmentFor } from "./pigments.js";
import { createLightState, createSky, createWater } from "./atmosphere.js";
import { animateCity, placeContactShadows } from "./ambience.js";
import { excludeFromInk, InkContours } from "./ink.js";
import { createCityFire } from "./fire.js";
import { createRegions, createWalkWorld } from "./navigation.js";
import { addRiversideResidents, configureResident } from "./residents.js";
import { fineScenery, makeBatches } from "./worldAssets.js";
import { createWaterline } from "./waterline.js";

const base = import.meta.env.BASE_URL;
export const spriteURL = (file) => `${base}sprites/${file}.png`;
const up = new THREE.Vector3(0, 1, 0);

function gradient(colors) {
  const bytes = new Uint8Array(12 * 4);
  for (let i = 0; i < 12; i++) {
    const band = colors[Math.floor(i / 4)];
    bytes.set([...band, 255], i * 4);
  }
  const texture = new THREE.DataTexture(bytes, 12, 1);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const shaderGradient = THREE.ShaderChunk.gradientmap_pars_fragment.replace(
  "vec3( texture2D( gradientMap, coord ).r )",
  "texture2D( gradientMap, coord ).rgb",
);

function makeMaterials(pigments) {
  const earth = gradient([[88, 79, 122], [154, 132, 176], [255, 244, 224]]);
  const stone = gradient([[76, 91, 142], [145, 162, 205], [255, 250, 239]]);
  const clayware = gradient([[43, 28, 22], [145, 106, 79], [255, 243, 216]]);
  return (source, watercraft = false) => {
    const name = source.name;
    const inkExempt = fineScenery.test(name) || /^(?:wild_palm_|palm_scales|leaf_)/.test(name);
    const isPale = /white_plaster|cream_trim|cream_course|pale_quay/.test(name);
    const isPot = /^(?:jar_|polish_jar|wild_jar|wild_cotta)/.test(name);
    const terrain = /^wild_terrain_/.test(name);
    const pigment = pigmentFor(name);
    const groundRelief = /^(stone_road|sand_floor|pale_quay|quay_(?:rose|sun|dark))/.test(name);
    const color = source.color?.clone() ?? new THREE.Color("white");
    if (name === "white_plaster") color.set("#f3ebdd");
    if (name.startsWith("leaf_")) color.lerp(new THREE.Color("#4e8059"), 0.15);
    const material = new THREE.MeshToonMaterial({
      name: source.name,
      color,
      vertexColors: source.vertexColors,
      map: pigment ? pigments[pigment[0]] : source.map,
      alphaMap: source.alphaMap,
      alphaTest: source.alphaTest,
      side: watercraft ? THREE.DoubleSide : source.side,
      gradientMap: isPot ? clayware : isPale ? stone : earth,
      emissive: color,
      emissiveIntensity: isPot ? (name === "jar_dark" ? .038 : .13) : .018,
    });
    material.defaultAttributeValues = { foundation: [0, 0] };
    if (/^(mud_|plinth_|white_plaster|cream_|roof_|quay_)/.test(name)) material.shadowSide = THREE.BackSide;
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <gradientmap_pars_fragment>", shaderGradient);
      if (inkExempt) shader.fragmentShader = excludeFromInk(shader.fragmentShader);
      if (!pigment) return;
      shader.uniforms.pigmentScale = { value: new THREE.Vector2(...pigment[1]) };
      shader.uniforms.pigmentStrength = { value: pigment[2] };
      shader.uniforms.fineGrain = { value: pigments.micro };
      if (terrain) shader.uniforms.marshInk = { value: pigments.marsh };
      shader.uniforms.fineWeight = { value: pigment[0] === "sand" ? .49 : pigment[0] === "stone" ? .33 : .08 };
      shader.uniforms.dirtColor = { value: new THREE.Color(isPale ? "#aa8163" : "#a37450") };
      const worldVaryings = "varying vec3 vPigmentPoint, vPigmentNormal; varying vec2 vFoundation;";
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 foundation; " + worldVaryings)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vec4 pigmentPoint=vec4(position,1.);
          vec3 pigmentNormal=normal;
          #ifdef USE_INSTANCING
            pigmentPoint=instanceMatrix*pigmentPoint;
            pigmentNormal=mat3(instanceMatrix)*pigmentNormal;
          #endif
          vPigmentPoint=(modelMatrix*pigmentPoint).xyz;
          vPigmentNormal=mat3(modelMatrix)*pigmentNormal;
          vFoundation=foundation;`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + worldVaryings +
          (terrain ? "\nuniform sampler2D marshInk;" : "") + "\nuniform vec2 pigmentScale; uniform float pigmentStrength,fineWeight; uniform sampler2D fineGrain; uniform vec3 dirtColor;")
        .replace("#include <map_fragment>", `
          vec3 axes=pow(abs(normalize(vPigmentNormal)),vec3(8.0));
          axes/=max(dot(axes,vec3(1.)),.0001);
          vec3 surfaceInk=${terrain ? "texture2D(map,vPigmentPoint.xz*pigmentScale).rgb;" : `texture2D(map,vPigmentPoint.zy*pigmentScale).rgb*axes.x
            +texture2D(map,vPigmentPoint.xz*pigmentScale).rgb*axes.y
            +texture2D(map,vPigmentPoint.xy*pigmentScale).rgb*axes.z;`}
          ${terrain ? "float greenMargin=smoothstep(-.20,-.01,vColor.g-vColor.r); surfaceInk=mix(surfaceInk,texture2D(marshInk,vPigmentPoint.xz*pigmentScale).rgb,greenMargin);" : ""}
          diffuseColor.rgb*=mix(vec3(1.),surfaceInk,pigmentStrength);
          float micro=mix(.83,texture2D(fineGrain,vPigmentPoint.xz*6.39).r,
                          axes.y*(1.-smoothstep(9.,35.,length(vViewPosition))));
          diffuseColor.rgb*=1.+(micro-.83)*fineWeight;
          float height=max(0.,vPigmentPoint.y-vFoundation.x);
          float wear=1.-smoothstep(.055,1.20,height);
          float dabs=clamp(.72+(surfaceInk.r-.66)*1.22+(micro-.83)*1.42,.38,.98);
          float dust=pow(wear,1.24)*vFoundation.y*dabs*(1.-axes.y*.38);
          diffuseColor.rgb=mix(diffuseColor.rgb,dirtColor,dust*.33);`);
      if (groundRelief) shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `
        #include <normal_fragment_maps>
        float surfaceHeight=(surfaceInk.r*.017+micro*.0045)
          *smoothstep(.56,.96,axes.y)*(1.-smoothstep(7.,22.,length(vViewPosition)));
        vec3 alongX=dFdx(-vViewPosition),alongY=dFdy(-vViewPosition);
        vec3 sideX=cross(alongY,normal),sideY=cross(normal,alongX);
        float determinant=dot(alongX,sideX)*faceDirection;
        vec3 heightGradient=sign(determinant)*(dFdx(surfaceHeight)*sideX+dFdy(surfaceHeight)*sideY);
        normal=normalize(max(abs(determinant),1.e-8)*normal-heightGradient);`);
    };
    material.customProgramCacheKey = () => `uruk-toon:${Boolean(pigment)}:${groundRelief}:${terrain}:${inkExempt}`;
    return material;
  };
}

function fitSprite(image, aspect) {
  const sample = document.createElement("canvas");
  const cap = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
  sample.width = Math.max(1, Math.round(image.naturalWidth * cap));
  sample.height = Math.max(1, Math.round(image.naturalHeight * cap));
  const scan = sample.getContext("2d", { willReadFrequently: true });
  if (!scan) return image;
  scan.drawImage(image, 0, 0, sample.width, sample.height);
  const alpha = scan.getImageData(0, 0, sample.width, sample.height).data;
  let left = sample.width;
  let right = -1;
  let top = sample.height;
  let bottom = -1;
  for (let y = 0; y < sample.height; y++) {
    for (let x = 0; x < sample.width; x++) {
      if (alpha[(y * sample.width + x) * 4 + 3] < 87) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = y;
    }
  }
  if (right < left || bottom < top) return image;
  const regionWidth = right - left + 1;
  const regionHeight = bottom - top + 1;
  const texture = document.createElement("canvas");
  texture.height = THREE.MathUtils.clamp(Math.round(image.naturalHeight * regionHeight / sample.height), 16, 1536);
  texture.width = Math.round(texture.height * aspect);
  const scale = Math.min((texture.width - 6) / regionWidth, (texture.height - 5) / regionHeight);
  const width = regionWidth * scale;
  const height = regionHeight * scale;
  texture.getContext("2d").drawImage(image, left * image.naturalWidth / sample.width, top * image.naturalHeight / sample.height,
    regionWidth * image.naturalWidth / sample.width, regionHeight * image.naturalHeight / sample.height,
    (texture.width - width) / 2, texture.height - height - 1, width, height);
  return texture;
}

function loadSprites(npcs, scene) {
  const loader = new THREE.TextureLoader();
  const textures = new Map();
  const missing = new Set();
  function texture(file, aspect, flipY = false) {
    const key = file+":"+aspect+":"+flipY;
    if (!textures.has(key)) {
      textures.set(key, loader.loadAsync(spriteURL(file)).catch((error) => {
        if (!file.startsWith("sumer/")) throw error;
        missing.add(file);
        return loader.loadAsync(spriteURL("citizen_01"));
      }).then((asset) => {
        asset.image = fitSprite(asset.image, aspect);
        asset.colorSpace = THREE.SRGBColorSpace;
        asset.flipY = flipY;
        asset.minFilter = THREE.LinearMipmapLinearFilter;
        asset.magFilter = THREE.LinearFilter;
        asset.needsUpdate = true;
        return asset;
      }));
    }
    return textures.get(key);
  }
  function material(map) {
    const value = new THREE.MeshBasicMaterial({
      map,
      side: THREE.DoubleSide,
      alphaTest: 0.34,
      toneMapped: false,
    });
    value.userData.outlineParameters = { visible: false };
    value.onBeforeCompile = (shader) => {
      shader.fragmentShader = excludeFromInk(shader.fragmentShader).replace("#include <map_fragment>",
        THREE.ShaderChunk.map_fragment.replace("texture2D( map, vMapUv )", "texture2D( map, vMapUv, -0.38 )"));
    };
    return value;
  }
  const poses = [
    { file:"traveler_back", width:.84, height:1.74, lift:0 },
    { file:"traveler_jump", width:1.18, height:1.51, lift:.16 },
  ];
  return Promise.all([
    ...npcs.map(async (npc) => {
      const index = Number(npc.name.split("_").at(-1));
      const king = npc.name === "npc_gilgamesh_01";
      npc.file ??= king ? "gilgamesh" : `citizen_0${(index - 1) % 4 + 1}`;
      npc.mesh.material = material(await texture(npc.file, npc.aspect ?? (king ? 1.1 / 1.9 : 0.9 / 1.75),npc.flipY??false));
    }),
    Promise.all(poses.map(async ({file,width,height,lift}) => {
      const geometry = new THREE.PlaneGeometry(width, height);
      geometry.translate(0, height*.5+lift, 0);
      const avatar = new THREE.Mesh(geometry, material(await texture(file,width/height,true)));
      avatar.visible = false;
      avatar.name = file + "_shoulder_view";
      scene.add(avatar);
      return avatar;
    })),
  ]).then((result) => ({avatars:result.at(-1), missing}));
}

function filterTextures(scene, pigments, anisotropy) {
  const maps = new Set(Object.values(pigments));
  scene.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || material.userData.filtersConfigured) continue;
      Object.values(material).forEach(value => { if (value?.isTexture) maps.add(value); });
      Object.values(material.uniforms ?? {}).forEach(({ value }) => { if (value?.isTexture) maps.add(value); });
      material.userData.filtersConfigured = true;
    }
  });
  for (const map of maps) {
    map.anisotropy = anisotropy;
    map.needsUpdate = true;
  }
}

export async function createWorld(canvas, onProgress) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  const compact = matchMedia("(pointer: coarse)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.info.autoReset=false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2("#e8cfad", 0.0061);
  const sky = createSky();
  scene.add(sky.mesh);

  const camera = new THREE.PerspectiveCamera(67, 1, 0.115, 1380);
  const gl = renderer.getContext();
  const hdr = renderer.extensions.has("EXT_color_buffer_float");
  const format = hdr ? gl.RGBA16F : gl.RGBA8;
  const colorSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES);
  const depthSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES);
  const samples = [4, 2].find(value => colorSamples.includes(value) && depthSamples.includes(value)) ?? 0;
  const mainTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    samples,
  });
  const composer = new EffectComposer(renderer, mainTarget);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new InkContours(camera));
  const light = new THREE.DirectionalLight("#fff2dc", 1.92);
  light.castShadow = true;
  const shadowSize = Math.min(renderer.capabilities.maxTextureSize, compact ? 1536 : 2048);
  light.shadow.mapSize.set(shadowSize, shadowSize);
  light.shadow.camera.left = light.shadow.camera.bottom = -53;
  light.shadow.camera.right = light.shadow.camera.top = 53;
  light.shadow.camera.near = 2;
  light.shadow.camera.far = 231;
  light.shadow.bias = -0.00022;
  light.shadow.normalBias = 0.054;
  light.shadow.intensity = 0.83;
  light.shadow.autoUpdate = false;
  scene.add(light, light.target);
  const ambient = new THREE.HemisphereLight("#dae6ff", "#ad81ae", 0.80);
  scene.add(ambient);
  const pointLights = Array.from({ length: 3 }, (_, index) => {
    const point = new THREE.PointLight("#ffb56a", 0, 9, 2);
    if (index === 0) {
      point.castShadow = true;
      point.shadow.autoUpdate = false;
      point.shadow.mapSize.set(256, 256);
      point.shadow.camera.near = .12;
      point.shadow.camera.far = 11.5;
      point.shadow.bias = -.0014;
      point.shadow.normalBias = .025;
      point.shadow.intensity = .68;
    }
    scene.add(point);
    return point;
  });

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const files = ["uruk_city.glb", "mesopotamia_wilds.glb"];
  const downloads = files.map(file => ({ file, loaded: 0, size: __URUK_MODEL_BYTES__[file] }));
  const allBytes = downloads.reduce((sum, item) => sum + item.size, 0);
  const reportDownloads = () => {
    const completedBytes = downloads.reduce((sum, item) => sum + item.loaded, 0);
    onProgress(Math.round(completedBytes * 88 / allBytes));
  };
  const [city, wild] = await Promise.all(downloads.map(item =>
    loader.loadAsync(`${base}models/${item.file}`, ({ loaded }) => {
      item.loaded = Math.min(item.size, loaded);
      reportDownloads();
    }).then(model => {
      item.loaded = item.size;
      reportDownloads();
      return model.scene;
    })));
  onProgress(90);
  scene.add(city,wild);
  city.updateMatrixWorld(true);
  wild.updateMatrixWorld(true);
  const walkMeshes=[],solidMeshes=[],npcs=[],soundAnchors=[],nightAnchors=[];
  const time={value:0};
  const water=createWater(time), distantWater=createWater(time,true);
  for (const root of [city,wild]) root.traverse(node=>{
    const {name}=node;
    if (name.startsWith("col_walk_")||name.startsWith("col_solid_")) {
      node.visible=false;
      node.traverse(mesh=>{
        if (!mesh.isMesh) return;
        if (name.startsWith("col_walk_")) walkMeshes.push({name,mesh});
        else solidMeshes.push(mesh);
      });
    } else if (name.startsWith("npc_") && node.userData.role==="billboard_sprite_anchor") {
      const mesh=node.isMesh?node:node.children.find(child=>child.isMesh);
      if (!mesh) throw Error("Missing NPC face "+name);
      const point=node.getWorldPosition(new THREE.Vector3());
      const npc={name,node,mesh,point};
      configureResident(npc);
      npcs.push(npc);
    } else if (name.startsWith("snd_")) {
      soundAnchors.push({...node.userData,position:node.getWorldPosition(new THREE.Vector3())});
    } else if (name.startsWith("light_") && node.userData.kind==="point") {
      nightAnchors.push({...node.userData,name,position:node.getWorldPosition(new THREE.Vector3())});
    }
  });
  const walkCount=new Set(walkMeshes.map(({name})=>name)).size;
  if (walkCount!==142) throw Error("Expected 142 authored walkable meshes, found "+walkCount);
  const walk=createWalkWorld(walkMeshes,solidMeshes);
  const {floor,occupied,blockers}=walk;
  const regions=createRegions(walk.boxes,walk.floorPlan);
  const spawn=city.getObjectByName("spawn_exterior_gate_01");
  if (!spawn) throw Error("Uruk spawn point missing.");
  const maxAnisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);
  const textures=makePigments(maxAnisotropy);
  const pigment=makeMaterials(textures);
  const waterline=createWaterline(city,wild,scene,time);
  distantWater.setBoatMask(waterline.boatMask);
  const batch=await makeBatches(city,wild,scene,pigment,water.material,distantWater.material);
  const supplementalFires=[
    ["oven_east",29,.25,48.91,.44,.38],["oven_west",-28,.25,60.92,.44,.38],["oven_pen",-42,.27,54.90,.44,.38],
    ["oven_courtyard",-39.31,.25,-10.35,.30,.31],
    ...[0,1,2,3].map(i=>["ziggurat_brazier_"+i,-24+2.93*Math.cos(i*Math.PI/2),131.31,-356.6-2.93*Math.sin(i*Math.PI/2),.68,.70]),
  ];
  for (const [name,bounds] of batch.flames) {
    if (!name.startsWith("oil_lamp_")||bounds.isEmpty()) continue;
    const center=bounds.getCenter(new THREE.Vector3());
    nightAnchors.push({name,position:center,radius_m:4.2,luminous_candela:12,color_hex:"#ffbd79"});
  }
  for (const [name,x,y,z] of supplementalFires) {
    const position=new THREE.Vector3(x,y,z);
    nightAnchors.push({name,position:position.add(new THREE.Vector3(0,.38,0)),radius_m:6,luminous_candela:17});
  }
  const fire=createCityFire(scene,batch.flames,nightAnchors.filter(a=>a.name.startsWith("light_gate_oil_lamp_")),supplementalFires);
  const updateMotion=animateCity(city,scene,soundAnchors,pigment,fire.sparks);
  npcs.push(...addRiversideResidents(scene,walk));
  const {avatars,missing}=await loadSprites(npcs,scene);
  const [playerContact]=placeContactShadows([{name:"traveler_ground",point:new THREE.Vector3()},...npcs],scene);
  filterTextures(scene,textures,maxAnisotropy);
  batch.detachSourceMeshes();
  playerContact.visible=false;
  const toCamera=new THREE.Vector3();
  const lightState=createLightState();
  const shadowCenter=new THREE.Vector3(Infinity,0,0);
  const lightCenter=new THREE.Vector3();
  const shadowForward=new THREE.Vector3();
  let wantedPhase=0,phase=0,lastShadowPhase=-1,lastRender=0,lastLampNight=-1,previewStart=null;
  const lastLampPosition=new THREE.Vector3(Infinity,0,0);
  let frameMean=1/60;

  function updateLight(look,position) {
    light.color.copy(look.key);
    light.intensity = look.energy;
    light.shadow.intensity = THREE.MathUtils.lerp(.66, .62, look.night);
    ambient.intensity = look.ambient;
    ambient.color.copy(look.skyBounce);
    ambient.groundColor.copy(look.sandBounce);
    scene.fog.color.copy(look.horizon);
    scene.fog.density = look.mist;
    camera.getWorldDirection(shadowForward);
    lightCenter.copy(position).addScaledVector(shadowForward,9);
    lightCenter.y=position.y+1.5;
    if (shadowCenter.distanceToSquared(lightCenter)>.64 || Math.abs(lastShadowPhase-phase)>.012) {
      shadowCenter.copy(lightCenter);
      light.target.position.copy(lightCenter);
      light.position.copy(lightCenter).addScaledVector(look.direction,105);
      light.target.updateMatrixWorld();
      light.shadow.needsUpdate=true;
      lastShadowPhase=phase;
    }
  }

  function updateLamps(position, night) {
    if (night < .02) {
      if (lastLampNight !== 0) for (const lamp of pointLights) { lamp.intensity = 0; lamp.visible = false; }
      lastLampPosition.set(Infinity, 0, 0);
      lastLampNight = 0;
      return;
    }
    if (position.distanceToSquared(lastLampPosition) < 3.0 && Math.abs(night - lastLampNight) < .045) return;
    lastLampNight = night;
    lastLampPosition.copy(position);
    const nearby = nightAnchors.map((anchor) => [anchor.position.distanceToSquared(position), anchor])
      .sort((a, b) => a[0] - b[0]);
    for (const [i, lamp] of pointLights.entries()) {
      const [distance, anchor] = nearby[i] ?? [Infinity, null];
      lamp.visible = true;
      lamp.intensity = distance < 484 ? (anchor.luminous_candela ?? 15) * .52 * night : 0;
      if (lamp.intensity) {
        if (lamp.castShadow && !lamp.position.equals(anchor.position)) lamp.shadow.needsUpdate = true;
        lamp.position.copy(anchor.position);
        lamp.color.set(anchor.color_hex ?? "#ffb56a");
        lamp.distance = anchor.radius_m ?? 8;
      }
    }
  }

  function render(position, milliseconds, heading, shoulder, airborne = false) {
    time.value = milliseconds / 1000;
    const delta = Math.min(.12, (milliseconds - (lastRender || milliseconds)) / 1000);
    lastRender = milliseconds;
    phase = THREE.MathUtils.damp(phase, wantedPhase, 4.3, delta);
    if (Math.abs(phase - wantedPhase) < .003) phase = wantedPhase;
    const look = lightState(phase);
    sky.update(camera, look, time.value);
    water.update(look);
    distantWater.update(look);
    waterline.update(look.night,camera);
    updateMotion(time.value, look.night, canvas.clientHeight);
    fire.update(time.value, look.night, camera);
    batch.update(camera);
    for (const npc of npcs) {
      toCamera.copy(camera.position).sub(npc.point);
      // Blender's +Y front becomes -Z in glTF. The origin stays at the feet.
      npc.node.quaternion.setFromAxisAngle(up, npc.flipY ? Math.atan2(toCamera.x,toCamera.z) : Math.atan2(-toCamera.x,-toCamera.z));
      npc.mesh.material.color.copy(look.sprite);
      npc.mesh.castShadow=toCamera.lengthSq()<38**2;
    }
    const avatar = avatars[Number(airborne)];
    avatars[0].visible = shoulder && !airborne;
    avatars[1].visible = shoulder && airborne;
    playerContact.visible = shoulder;
    if (shoulder) {
      avatar.position.copy(position);
      avatar.rotation.y = heading;
      avatar.material.color.copy(look.sprite);
      const support = floor(position.x,position.z,position.y,.08,2.7);
      if (support) playerContact.position.copy(support.point).y += .028;
      else playerContact.visible = false;
    }
    updateLight(look,position);
    updateLamps(position, look.night);
    if (delta>.001&&delta<.24) frameMean=THREE.MathUtils.lerp(frameMean,delta,.08);
    renderer.info.reset();
    composer.render(delta);
  }

  function preview(milliseconds, reduced) {
    previewStart ??= milliseconds;
    const time = reduced ? 0 : (milliseconds - previewStart) / 1000;
    const angle = .53 + time * .071;
    camera.position.set(5 + Math.sin(angle) * 94, 26.5 + Math.sin(angle * 1.6) * 8.2, -12 + Math.cos(angle) * 98);
    const target = new THREE.Vector3(1.5 + Math.sin(angle) * 8.7, 8.1, -13 - Math.sin(angle) * 5.4);
    if (camera.fov !== 51) {
      camera.fov = 51;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(target);
    camera.updateMatrixWorld();
    render(camera.position, milliseconds, 0, false);
  }

  function endPreview() {
    camera.fov = 67;
    camera.updateProjectionMatrix();
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const pixelRatio=Math.min(window.devicePixelRatio,2);
    if (renderer.getPixelRatio()!==pixelRatio) {
      renderer.setPixelRatio(pixelRatio);
      composer.setPixelRatio(pixelRatio);
    }
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize",resize);
  onProgress(100);
  return {
    camera,npcs,soundAnchors,regions,floor,occupied,blockers,render,scene,preview,endPreview,
    spawn:spawn.getWorldPosition(new THREE.Vector3()),
    setTime(value){wantedPhase=THREE.MathUtils.clamp(value,0,2);},
    get timePhase(){return phase;},
    get collisionCandidates(){return walk.candidates;},
    get frameStats(){return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      pixelRatio:renderer.getPixelRatio(),resolution:[canvas.width,canvas.height],samples,anisotropy:maxAnisotropy,frameMs:frameMean*1000};},
    counts:{walkSurfaces:walkCount,npcs:npcs.length,sounds:soundAnchors.length,
      lights:nightAnchors.length,flames:fire.count,drawGroups:batch.drawGroups,missingSprites:[...missing],
      boatLifts:waterline.boatLifts},
  };
}
