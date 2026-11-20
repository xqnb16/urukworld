import * as THREE from "three";

const palette = [
  { zenith: "#1261bd", horizon: "#eadfcf", upperHaze: "#72bdef", litCloud: "#fff3dd", shadeCloud: "#a7b5d9", sun: "#fff0bd", skyBounce: "#b7d8ff", sandBounce: "#eed1da", key: "#ffe5bf", sprite: "#fff2e7", direction: [-.46, .72, .48], energy: 2.42, ambient: 1.34, mist: .00235 },
  { zenith: "#42549c", horizon: "#f4a271", upperHaze: "#d38a96", litCloud: "#ffcf9c", shadeCloud: "#92759a", sun: "#ffc578", skyBounce: "#b9b6f1", sandBounce: "#ecc0b5", key: "#ffc27d", sprite: "#ffd8b2", direction: [-.89, .25, .42], energy: 1.98, ambient: 1.10, mist: .00390 },
  { zenith: "#090e2b", horizon: "#46597c", upperHaze: "#293d71", litCloud: "#6d7ba3", shadeCloud: "#29385d", sun: "#b8c9fc", skyBounce: "#889ade", sandBounce: "#55476c", key: "#b3c6ff", sprite: "#aeb8df", direction: [.48, .72, -.49], energy: .67, ambient: .47, mist: .00535 },
];

const colors = ["zenith", "horizon", "upperHaze", "litCloud", "shadeCloud", "sun", "skyBounce", "sandBounce", "key", "sprite"];
for (const entry of palette) {
  for (const field of colors) entry[field] = new THREE.Color(entry[field]);
  entry.direction = new THREE.Vector3(...entry.direction).normalize();
}

export function createLightState() {
  const state = Object.fromEntries(colors.map((key) => [key, new THREE.Color()]));
  state.direction = new THREE.Vector3();
  return (phase) => {
    const index = Math.min(1, Math.floor(phase));
    const blend = phase - index;
    const first = palette[index], second = palette[index + 1];
    for (const color of colors) state[color].copy(first[color]).lerp(second[color], blend);
    state.direction.copy(first.direction).lerp(second.direction, blend).normalize();
    for (const number of ["energy", "ambient", "mist"]) state[number] = THREE.MathUtils.lerp(first[number], second[number], blend);
    state.night = THREE.MathUtils.smoothstep(phase, 1.14, 1.94);
    return state;
  };
}

const noise = `
  float hash(vec2 p) {
    vec3 a = fract(vec3(p.xyx)*.1031);
    a += dot(a, a.yzx+33.33);
    return fract((a.x+a.y)*a.z);
  }
  float noise2(vec2 p) {
    vec2 i=floor(p), f=fract(p);
    f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
  }
  float fbm(vec2 p) {
    return noise2(p)*.51 + noise2(p*2.05+4.17)*.25
      + noise2(p*4.17-7.01)*.13 + noise2(p*8.20+2.71)*.07 + noise2(p*17.03)*.04;
  }
`;

export function createSky() {
  const colorNames = ["zenith", "horizon", "upperHaze", "litCloud", "shadeCloud", "sun"];
  const uniforms = Object.fromEntries(colorNames.map((name) => [name, { value: new THREE.Color() }]));
  Object.assign(uniforms, { direction: { value: new THREE.Vector3() }, night: { value: 0 }, time: { value: 0 } });
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection=position;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
      }
    `,
    fragmentShader: `
      varying vec3 vDirection;
      uniform vec3 zenith,horizon,upperHaze,litCloud,shadeCloud,sun,direction;
      uniform float night,time;
      ${noise}
      float starLayer(vec2 uv, float density, float limit) {
        vec2 p=uv*density;
        vec2 tile=floor(p);
        vec2 pos=vec2(hash(tile+51.2),hash(tile-3.27))*.68+.16;
        float beam=1.-smoothstep(.035,.137,length(fract(p)-pos));
        return beam * smoothstep(limit,1.,hash(tile));
      }
      void main() {
        vec3 d=normalize(vDirection);
        float y=max(d.y,0.);
        vec3 color=mix(horizon,upperHaze,smoothstep(-.029,.28,d.y));
        color=mix(color,zenith,pow(smoothstep(.095,.98,y),.57));
        float sunDot=max(0.,dot(d,direction));
        color+=sun*pow(sunDot,13.)*.102;
        color+=sun*smoothstep(.99964,.99989,sunDot)*mix(2.12,.59,night);
        if(night>.003) {
          vec2 starUV=vec2(atan(d.z,d.x)*1.25,d.y*3.);
          float galactic=exp(-abs(dot(d,normalize(vec3(.39,.43,.81))))*8.6);
          float dust=pow(fbm(starUV*2.8+14.2),2.);
          color+=vec3(.20,.28,.59)*galactic*dust*.48*night*smoothstep(.02,.24,y);
          float stars=starLayer(starUV,135.,.94)*.45 + starLayer(starUV+7.1,62.,.965);
          stars+=starLayer(starUV-2.3,211.,.90)*.38*galactic;
          color+=vec3(.68,.77,1.)*stars*night*smoothstep(.015,.14,y);
        }
        // A stylized cloud volume. Two offsets expose the shaded lower face and a luminous rim.
        vec2 flow=vec2(time*.0096,-time*.003);
        vec2 cloud=d.xz*(3.7/(y+.31))+vec2(4.40,2.82)+flow;
        float swell=noise2(cloud*.47)*.18;
        float f=fbm(cloud)+swell;
        float behind=fbm(cloud+vec2(-.14,.20))+swell;
        float bank=smoothstep(.02,.085,y)*(1.-smoothstep(.67,.92,y));
        float shape=smoothstep(.612,.627,f)*bank;
        float weight=smoothstep(.637,.65,behind);
        float contour=smoothstep(.62,.646,f)*(1.-smoothstep(.67,.704,f));
        vec3 painted=mix(shadeCloud,litCloud,clamp(.29+weight*.71+contour*.24,0.,1.));
        painted+=sun*pow(sunDot,9.)*.12*(1.-night);
        color=mix(color,painted,shape*mix(.96,.42,night));
        // A softer bank hugs the horizon and shares the distant terrain's fog color.
        vec2 ribbon=d.xz*(7.0/(y+.18))+vec2(31.2,19.4)+flow*.4;
        float trail=smoothstep(.57,.63,fbm(ribbon))*smoothstep(-.01,.055,d.y)*(1.-smoothstep(.09,.24,y));
        color=mix(color,mix(horizon,litCloud,.48),trail*mix(.49,.16,night));
        gl_FragColor=vec4(color,0.);
        #include <colorspace_fragment>
      }
    `,
  });
  material.userData.outlineParameters = { visible: false };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1150, 32, 20), material);
  mesh.renderOrder = 20;
  mesh.frustumCulled = false;
  return {
    mesh,
    update(camera, light, seconds) {
      mesh.position.copy(camera.position);
      for (const name of colorNames) uniforms[name].value.copy(light[name]);
      uniforms.direction.value.copy(light.direction);
      uniforms.night.value = light.night;
      uniforms.time.value = seconds;
    },
  };
}

export function createWater(time, distant = false) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    time: { value: 0 }, night: { value: 0 }, sun: { value: new THREE.Color() },
    lightDirection: { value: new THREE.Vector3() }, farRiver: { value: Number(distant) },
    deep: { value: new THREE.Color("#126290") }, shallow: { value: new THREE.Color("#42bfac") },
    skyReflect: { value: new THREE.Color("#84c7ee") }, foam: { value: new THREE.Color("#c1f1e4") },
    boatHollows: { value: null }, boatBounds: { value: new THREE.Vector4(0,0,1,1) },
  }]);
  uniforms.time = time;
  const material = new THREE.ShaderMaterial({
    name: distant ? "Outlying water" : "Canal_Water",
    fog: true, side: THREE.DoubleSide, vertexColors: true, transparent: false, depthWrite: true, uniforms,
    vertexShader: `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      #include <color_pars_vertex>
      void main() {
        #include <color_vertex>
        vec4 local=modelMatrix*vec4(position,1.);
        vWorld=local.xyz;
        vec4 mvPosition=viewMatrix*local;
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      varying vec3 vWorld;
      uniform float time, night, farRiver;
      uniform vec3 sun, lightDirection, deep, shallow, skyReflect, foam;
      uniform sampler2D boatHollows;
      uniform vec4 boatBounds;
      #include <fog_pars_fragment>
      #include <color_pars_fragment>
      ${noise}
      void main() {
        vec2 p=vWorld.xz;
        vec2 hull=(p-boatBounds.xy)/boatBounds.zw;
        if (farRiver>.5 && all(greaterThanEqual(hull,vec2(0.))) && all(lessThan(hull,vec2(1.)))) {
          if (texture2D(boatHollows,hull).a>.46) discard;
        }
        vec3 v=normalize(cameraPosition-vWorld);
        float a=p.y*4.1+p.x*1.4-time*1.42+1.35*sin(p.x*.93+p.y*.47+time*.64);
        float b=p.y*7.3-p.x*2.5+time*1.55;
        float c=p.y*2.08+p.x*1.93-time*.90;
        vec3 normal=normalize(vec3(sin(a)*.11+sin(c)*.065,1.,cos(a)*.085+cos(b)*.051));
        float fresnel=pow(1.-max(0.,dot(v,normal)),2.30);
        float bank=.24;
        #ifdef USE_COLOR
          bank=smoothstep(.11,.47,vColor.g+(.15*vColor.r));
        #endif
        vec3 col=mix(deep,shallow,bank);
        #ifdef USE_COLOR
          col=mix(col,max(vColor.rgb,vec3(.012,.07,.09)),mix(.31,.49,farRiver));
        #endif
        col=mix(col,skyReflect,fresnel*.31);
        float ripple=sin(a)*.53+sin(b)*.29+sin(c)*.18;
        float aa=max(.018,fwidth(ripple));
        float shards=smoothstep(.70-aa,.81+aa,ripple)*smoothstep(.39,.65,noise2(p*vec2(1.08,.75)+vec2(.0,time*.44)));
        float spec=pow(max(0.,dot(reflect(-lightDirection,normal),v)),24.);
        float glints=shards*(.26+.20*sin(p.y*.64-time*.64))*(1.-night*.60)*(1.-smoothstep(.30,.78,aa));
        col*=mix(1.,.37,night);
        col+=foam*glints*mix(.91,.47,night);
        col+=sun*(spec*.66+shards*spec*.40)*(1.-night*.72);
        gl_FragColor=vec4(col,.25);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  material.userData.outlineParameters = { visible: false };
  return { material, setBoatMask(mask) {
    if (!mask) return;
    uniforms.boatHollows.value=mask.map;
    uniforms.boatBounds.value.copy(mask.bounds);
  }, update(light) {
    uniforms.sun.value.copy(light.sun);
    uniforms.lightDirection.value.copy(light.direction);
    uniforms.night.value = light.night;
  } };
}
