import * as THREE from "three";

const fragment = `
  uniform float time, seed, night;
  uniform vec3 ember, vermilion, amber, gold, ivory;
  varying vec2 vUv;

  float tongue(vec2 p, float base, float height, float size, float drift, float phase) {
    float y = (p.y - base) / height;
    float t = clamp(y, 0., 1.);
    float center = drift*t + pow(t, 1.4)*(.098*sin(phase + t*8.) + .045*sin(phase*1.33+t*15.));
    float width = size*pow(max(0., 1.-t), .65)*(1. + .14*sin(t*11. - phase));
    return min(min(y + .045, 1.-y), width - abs(p.x-center));
  }

  void main() {
    float t = time*4.15 + seed*6.17;
    vec2 p = vec2((vUv.x-.5)*1.64,(vUv.y-.045)*1.10);
    float sway = .08*sin(.64*t) + .056*cos(.99*t);
    p.x -= sway*p.y*p.y*2.;
    float mainHeight = .88 + .062*sin(t*.78) + .035*sin(t*1.31);
    float outer = tongue(p, .012, mainHeight, .30, .15, t);
    outer = max(outer, tongue(p+vec2(.15,0.), .04, .68+.10*sin(t+1.4), .151, -.24, t+1.1));
    outer = max(outer, tongue(p-vec2(.13,0.), .034, .57+.11*cos(t*.83), .17, .18, t+3.2));
    float middle = max(tongue(p, .015, mainHeight*.79, .249, .10, t+.36),
                       tongue(p+vec2(.098,0.), .055, .52+.08*sin(t*1.14), .12, -.21, t+1.8));
    float core = max(tongue(p, .021, .53+.059*sin(t*1.11), .179, .129, t+.8),
                     tongue(p+vec2(.071,0.), .018, .42+.06*cos(t*.9), .10, -.086, t+2.));
    float inner = tongue(p-vec2(.026,0.), .015, .397+.050*cos(t*1.41), .109, .054, t+.85);
    float aa = max(.0035, fwidth(outer)*.75);
    float alpha = smoothstep(-aa, aa, outer);
    if (alpha < .015) discard;
    vec3 color = mix(ember,vermilion,1.-smoothstep(.23,.9,p.y));
    color = mix(color,amber,smoothstep(-aa, aa,middle));
    color = mix(color,gold,smoothstep(-aa, aa,core));
    color = mix(color,ivory,smoothstep(-aa, aa,inner));
    gl_FragColor = vec4(color*mix(1.04,1.15,night),alpha);
    #include <colorspace_fragment>
  }
`;

export function createCityFire(scene, legacyFlames, gateLamps, supplemental = []) {
  const time = { value: 0 };
  const night = { value: 0 };
  const flames = [];
  const sparks = [];
  const torchWood = new THREE.MeshToonMaterial({ color: "#59341f" });
  const metal = new THREE.MeshToonMaterial({ color: "#bb8243", emissive: "#604125", emissiveIntensity: .14 });
  const coals = new THREE.MeshToonMaterial({ color: "#3f2928", emissive: "#b83723", emissiveIntensity: .34 });

  function flame(name, point, width, height) {
    const shape = new THREE.PlaneGeometry(width, height).translate(0, height*.454, 0);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        time, night, seed: { value: flames.length*.731 },
        ember: { value: new THREE.Color("#ad3026") }, vermilion: { value: new THREE.Color("#f6512b") },
        amber: { value: new THREE.Color("#ff981c") }, gold: { value: new THREE.Color("#ffd251").multiplyScalar(1.14) },
        ivory: { value: new THREE.Color("#fff3bd").multiplyScalar(1.56) },
      },
      vertexShader: `varying vec2 vUv;
        void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: fragment,
    });
    const mesh = new THREE.Mesh(shape, material);
    mesh.name = name;
    mesh.position.copy(point);
    mesh.renderOrder = 3;
    scene.add(mesh);
    flames.push(mesh);
    sparks.push(point.clone().add(new THREE.Vector3(0, height*.40, 0)));
  }

  for (const [name, bounds] of legacyFlames) {
    if (bounds.isEmpty()) continue;
    const point = bounds.getCenter(new THREE.Vector3());
    point.y = bounds.min.y;
    const altar = /brazier/i.test(name);
    const wick = name.startsWith("oil_lamp_");
    flame(altar ? "Brazier_Fire_" + name : "Torch_Fire_" + name, point, altar ? 1.08 : wick ? .27 : .67, altar ? 1.13 : wick ? .36 : .82);
  }
  for (const [name,x,y,z,width,height] of supplemental) {
    flame(name,new THREE.Vector3(x,y,z),width,height);
  }

  gateLamps.forEach((lamp, i) => {
    const p = lamp.position;
    const direction = p.x < 9 ? 1 : -1;
    const fixture = new THREE.Group();
    fixture.position.copy(p);
    const add = (geometry, material, x, y, z, roll = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.z = roll;
      mesh.castShadow = mesh.receiveShadow = true;
      fixture.add(mesh);
    };
    add(new THREE.BoxGeometry(.17,.54,.22), metal, -.20*direction,-.34,0);
    add(new THREE.CylinderGeometry(.064,.085,.66,12), torchWood, -.058*direction,-.28,0,-direction*.35);
    add(new THREE.LatheGeometry([new THREE.Vector2(.045,-.13), new THREE.Vector2(.18,-.043),
      new THREE.Vector2(.213,.03), new THREE.Vector2(.167,.06), new THREE.Vector2(.123,.001)],24), metal,.055*direction,-.033,0);
    add(new THREE.CylinderGeometry(.125,.094,.061,16), coals,.055*direction,-.025,0);
    scene.add(fixture);
    flame("Torch_Fire_" + (i+1), p.clone().add(new THREE.Vector3(.055*direction,0,0)), .65, .81);
  });

  return {
    sparks, count: flames.length,
    update(seconds, darkness, camera) {
      time.value = seconds;
      night.value = darkness;
      for (const mesh of flames) {
        mesh.rotation.y = Math.atan2(camera.position.x-mesh.position.x, camera.position.z-mesh.position.z);
      }
    },
  };
}
