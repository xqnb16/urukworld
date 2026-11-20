import * as THREE from "three";
import { seeded } from "./pigments.js";

const CENTER = new THREE.Vector3();
const chimneyHouses = [
  "house_courtyard_04", "house_courtyard_08", "house_workshop_15", "house_courtyard_24",
  "house_workshop_27", "house_terraced_29", "house_workshop_31", "house_courtyard_36",
];

function findHearths(root, scene, materials) {
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const color = new THREE.MeshStandardMaterial({ name: "mud_toast", color: "#bb845c" });
  const rims = new THREE.MeshStandardMaterial({ name: "mud_pale", color: "#dcaa7c" });
  const recess = new THREE.MeshStandardMaterial({ name: "deep_slot", color: "#393039" });
  const chimneyMaterial = materials(color);
  const rimMaterial = materials(rims);
  const recessMaterial = materials(recess);
  const flames = [];
  chimneyHouses.forEach((name, i) => {
    const house = root.getObjectByName(name);
    if (!house) return;
    const p = house.getWorldPosition(new THREE.Vector3());
    p.x += .99;
    p.z += i % 2 ? -.79 : .57;
    p.y += 17;
    ray.set(p, down);
    ray.far = 19;
    const roof = ray.intersectObject(house, true)[0];
    if (!roof || roof.point.y < 2) return;
    const group = new THREE.Group();
    group.position.copy(roof.point);
    group.name = `hearth_chimney_${i + 1}`;
    const box = (w, h, l, y, material) => {
      const geometry = new THREE.BoxGeometry(w, h, l);
      geometry.translate(0, y, 0);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    };
    box(.69, .62, .65, .3, chimneyMaterial);
    box(.81, .13, .77, .66, rimMaterial);
    box(.44, .012, .41, .732, recessMaterial);
    scene.add(group);
    flames.push(group.position.clone().add(new THREE.Vector3(0, .77, 0)));
  });
  return flames;
}

function layer(positions, mode, number, seed) {
  const rand = seeded(seed);
  const origin = [], variants = [];
  positions.forEach((center) => {
    for (let i = 0; i < number; i++) {
      origin.push(center.x, center.y, center.z);
      variants.push(rand(), rand(), rand(), rand());
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(origin, 3));
  geometry.setAttribute("seed", new THREE.Float32BufferAttribute(variants, 4));
  const uniforms = {
    time: { value: 0 }, resolutionY: { value: 1 }, dim: { value: 0 }, mode: { value: mode },
    smokeColor: { value: new THREE.Color("#b4b5ce") }, sparkColor: { value: new THREE.Color("#ffc580") },
  };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: mode === 2 ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms,
    vertexShader: `
      attribute vec4 seed;
      uniform float time,resolutionY,dim,mode;
      varying float vAlpha,vSeed,vAge;
      void main() {
        vec3 p=position;
        float age=fract(time*mix(.09,.19,seed.y)+seed.x);
        float size=.025;
        if (mode<.5) {
          float phase=time*mix(.28,.63,seed.y)+seed.x*6.283;
          p.x+=(seed.z-.5)*13.+cos(phase)*.65;
          p.z+=(seed.w-.5)*10.+sin(phase)*.42;
          p.y+=seed.y*4.7+sin(phase*.58)*.65;
          size=mix(.017,.045,seed.x);
          vAlpha=mix(.09,.41,seed.z)*(sin(phase*1.2)*.42+.58)*(1.-dim*.89);
        } else if (mode<1.5) {
          age=fract(time*mix(.31,.62,seed.y)+seed.x);
          p.y+=age*mix(1.40,2.42,seed.w);
          p.x+=(seed.z-.46)*age*.91 + age*age*.26;
          p.z+=(seed.w-.48)*age*.59;
          size=mix(.017,.049,seed.z)*(1.-age*.31);
          vAlpha=sin(age*3.14159)*mix(.29,.65,dim);
        } else {
          p.y+=age*mix(3.45,5.85,seed.w);
          p.x+=age*age*mix(1.6,4.0,seed.z) + sin(age*7.0+seed.x*5.)*.25*age;
          p.z+=(seed.y-.5)*age*1.46+age*.72;
          size=mix(.28,1.30,age)*mix(.73,1.16,seed.z);
          vAlpha=smoothstep(.0,.19,age)*(1.-smoothstep(.46,1.0,age))*mix(.145,.116, dim);
        }
        vec4 mv=modelViewMatrix*vec4(p,1.0);
        gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(size*resolutionY/max(-mv.z,.7),1.1,114.0);
        vSeed=seed.x+seed.w;
        vAge=age;
        vAlpha*=1.-smoothstep(59.,148.,-mv.z);
      }
    `,
    fragmentShader: `
      uniform float mode,dim;
      uniform vec3 smokeColor,sparkColor;
      varying float vAlpha,vSeed,vAge;
      void main() {
        vec2 uv=(gl_PointCoord-.5)*2.;
        float len=length(uv);
        if (mode>1.5) {
          float lobe=cos(atan(uv.y,uv.x)*5.+vSeed*8.0)*.11+sin(atan(uv.y,uv.x)*3.-vAge*4.)*.087;
          float puff=(1.-smoothstep(.14,.94,len+lobe))*vAlpha;
          vec3 shade=mix(smokeColor, vec3(.22,.25,.39), smoothstep(-.2,.74,uv.y)*.58+dim*.17);
          gl_FragColor=vec4(shade,puff);
        } else {
          float soft=(1.-smoothstep(.03,.96,len))*vAlpha;
          float center=(1.-smoothstep(.02,.33,len))*vAlpha;
          gl_FragColor=vec4(sparkColor*mix(1.1,2.20,center),soft);
        }
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, uniforms };
}

export function animateCity(root, scene, soundAnchors, materials, sparks) {
  const boats = [];
  root.traverse((node) => {
    if (/^boat_reed_cargo_\d+$/.test(node.name)) boats.push({ node, home: node.position.clone(), rotation: node.rotation.clone() });
  });
  const chimneys = findHearths(root, scene, materials);
  const fire = soundAnchors.filter((anchor) => anchor.sound === "wood_fire").map((anchor) => anchor.position);
  const dustPockets = [
    [10, .4, 21], [-17, .3, 20], [2.6, .4, 7], [15, .4, 3], [25, 1.3, -2], [5.8, .9, -3],
    [-18, .7, -17], [-31, .7, -18], [28, 8.44, -20], [28, 4.5, -8],
  ].map((values) => new THREE.Vector3(...values));
  const layers = [layer(dustPockets, 0, 21, 551), layer(sparks, 1, 20, 14410), layer([...chimneys, ...fire], 2, 15, 6881)];
  for (const { points } of layers) scene.add(points);
  return (seconds, night, height) => {
    for (const [i, { node, home, rotation }] of boats.entries()) {
      const phase = seconds * 1.29 + i * 1.81;
      node.position.y = home.y + Math.sin(phase) * .067 + Math.sin(phase * .51) * .026;
      node.rotation.x = rotation.x + Math.cos(phase * .80 + .96) * .017;
      node.rotation.z = rotation.z + Math.sin(phase * .64) * .011;
    }
    for (const { uniforms } of layers) {
      uniforms.time.value = seconds;
      uniforms.dim.value = night;
      uniforms.resolutionY.value = Math.max(200, height) * .86;
    }
    return boats.length;
  };
}

export function placeContactShadows(npcs, scene) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const ink = ctx.createRadialGradient(64, 64, 4, 64, 64, 63);
  ink.addColorStop(0, "rgba(255,255,255,.95)");
  ink.addColorStop(.32, "rgba(255,255,255,.70)");
  ink.addColorStop(.67, "rgba(255,255,255,.28)");
  ink.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map, color: "#32223c", transparent: true, opacity: .42, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  material.userData.outlineParameters = { visible: false };
  const plane = new THREE.PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);
  return npcs.map((npc) => {
    const contact = new THREE.Mesh(plane, material);
    contact.position.copy(npc.point).add(CENTER.set(0, npc.name.startsWith("npc_west_") ? .026 : .008, 0));
    const stair = npc.name === "npc_citizen_09" || npc.name === "npc_citizen_10";
    contact.scale.set(npc.name === "npc_gilgamesh_01" ? .95 : .68, 1, stair ? .30 : .64);
    contact.name = npc.name + "_contact";
    contact.renderOrder = 2;
    scene.add(contact);
    return contact;
  });
}
