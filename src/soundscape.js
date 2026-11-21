const sounds = {
  canal_water: { center: 910, q: 0.65, volume: 0.16, rate: 0.26 },
  market_crowd: { center: 390, q: 0.98, volume: 0.12, rate: 0.78 },
  wood_fire: { center: 2200, q: 0.55, volume: 0.05, rate: 2.15 },
  distant_city: { center: 240, q: 0.9, volume: 0.10, rate: 0.41 },
  high_wind: { center: 530, q: 0.53, volume: 0.15, rate: 0.22 },
  barley: {center:1760,q:.60,volume:.18,rate:.39},
  river: {center:760,q:.48,volume:.26,rate:.29},
  oasis: {center:1180,q:.64,volume:.19,rate:.20},
  mountain: {center:470,q:.62,volume:.22,rate:.26},
  indoor: {center:260,q:.64,volume:.11,rate:.17},
};

const westTracks = [
  { sound: "west_murmur", x: -18.8, z: -5.7, radius: 17, volume: .29 },
  { sound: "west_murmur", x: -20.8, z: -17.5, radius: 15, volume: .23 },
  { sound: "west_vendor", x: -17.1, z: -12.9, radius: 19, volume: .23 },
  { sound: "west_pottery", x: -18.4, z: -4.8, radius: 13, volume: .28 },
  { sound: "west_pottery", x: -24.6, z: -17.2, radius: 12, volume: .18 },
];

const smooth = (low, high, x) => {
  const t = Math.min(1, Math.max(0, (x-low)/(high-low)));
  return t*t*(3-2*t);
};

function marketBuffer(context, type) {
  const rate = 16000, duration = 16;
  const buffer = context.createBuffer(1, duration*rate, rate);
  const data = buffer.getChannelData(0);
  let seed = type === "west_vendor" ? 5413 : 81927;
  function random() {
    seed = (Math.imul(seed, 1664525)+1013904223) >>> 0;
    return seed/4294967296;
  }
  function write(start, span, sample) {
    const begin = Math.floor(start*rate), length = Math.floor(span*rate);
    for (let i=0;i<length;i++) data[(begin+i)%data.length] += sample(i/rate, i/length);
  }
  if (type === "west_pottery") {
    for (const start of [.39,1.1,2.42,6.03,6.28,8.76,11.1,13.8,14.05,15.35]) {
      const base = 350+random()*310;
      const strength = .14+random()*.23;
      write(start,.24,(t,u) =>
        strength*(1-Math.exp(-t*900))*Math.exp(-t*23)*(1-u)*
        (.34*Math.sin(t*base*6.283)+.32*Math.sin(t*base*15.238)+.19*Math.sin(t*base*27.112)));
    }
  } else {
    const vendor = type === "west_vendor";
    const utterances = vendor ? [1.6,7.7,13.05] : Array.from({length:43},(_,i)=>i*.362+random()*.33);
    for (const start of utterances) {
      const voice = (vendor ? 167 : 113) + random()*(vendor ? 41 : 124);
      const syllables=vendor ? 4 : 2+Math.floor(random()*4);
      let offset=0;
      for (let s=0;s<syllables;s++) {
        const span = (vendor ? .16 : .085) + random()*(vendor ? .18 : .14);
        const f1 = 330+random()*420, f2 = 830+random()*480;
        const fundamental = voice*(.79+random()*.38);
        const amps = Array.from({length:11},(_,i)=>{
          const hz = (i+1)*fundamental;
          return (.033+Math.exp(-(((hz-f1)/215)**2))*.29+Math.exp(-(((hz-f2)/300)**2))*.12)/(1+i*.139);
        });
        const accent=(vendor ? .53 : .22)*(.61+random()*.42);
        write(start+offset,span,(t,u)=>{
          const pitch=6.283*(fundamental*t+(vendor?41:18)*t*t*Math.sin(s*.77+.1));
          let sum=0;
          for(let k=0;k<amps.length;k++) sum+=amps[k]*Math.sin(pitch*(k+1));
          return sum*accent*Math.sin(Math.PI*u)**1.4;
        });
        offset+=span*.85+.012;
      }
    }
  }
  return buffer;
}

function makeLanding(context, wood) {
  const rate = 24000;
  const buffer = context.createBuffer(1, Math.round(.23*rate), rate);
  const data = buffer.getChannelData(0);
  let seed = 414133;
  let filtered = 0;
  for (let i=0;i<data.length;i++) {
    const t=i/rate, toe=Math.max(0,t-.041);
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const grit=seed/2147483648-1;
    filtered+=(grit-filtered)*.21;
    const heel = Math.sin(Math.PI*2*(wood ? 152 : 104)*t)*Math.exp(-t*36)*.54;
    const scuff = (.36*grit+.42*filtered)*Math.exp(-t*47);
    const close = t>.041 ? Math.min(1,toe*320)*Math.exp(-toe*38)*(.33*filtered+.10*grit) : 0;
    data[i]=(1-Math.exp(-t*650))*(heel+scuff+close);
  }
  return buffer;
}

function noiseLoop(context, type) {
  const seconds = 8;
  const sound = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const values = sound.getChannelData(0);
  const seed = Array.from(type).reduce((sum, char) => sum * 31 + char.charCodeAt(0), 13);
  let state = seed >>> 0;
  let slow = 0;
  let spark = 0;
  for (let i = 0; i < values.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const next = state / 4294967296 * 2 - 1;
    slow = 0.967 * slow + 0.033 * next;
    const time = i / context.sampleRate;
    const motion = 0.63 + 0.22 * Math.sin(time * 2 * Math.PI * sounds[type].rate + 0.7)
      + 0.14 * Math.sin(time * Math.PI * 3.13);
    if (type === "wood_fire" && next > 0.99993) spark = 1;
    spark *= 0.9982;
    const fade = Math.min(1, i / 256, (values.length - 1 - i) / 256);
    values[i] = (type === "wood_fire" ? next * (0.17 + spark * 0.83) : (next * 0.54 + slow * 2.3) * motion) * fade;
  }
  return sound;
}

export function createSoundscape(anchors,regions) {
  let context;
  let master;
  let outdoor, canopyFilter;
  const regionGains=new Map();
  let mix={};
  let muted = false;
  let lastUpdate = -Infinity;
  const trackGains = new Map();
  const westGains = [];
  let steps;
  let landings = 0;
  let westMix = 0;

  function panner(x, y, z, radius) {
    const node = context.createPanner();
    node.panningModel = "equalpower";
    node.distanceModel = "linear";
    node.refDistance = 2.4;
    node.maxDistance = radius;
    node.rolloffFactor = 1;
    node.positionX.value = x;
    node.positionY.value = y;
    node.positionZ.value = z;
    return node;
  }

  const buffers = new Map();
  function connectAnchors(items) {
    if (!context) return;
    for (const anchor of items) {
      const spec = sounds[anchor.sound];
      if (!spec) continue;
      if (!buffers.has(anchor.sound)) buffers.set(anchor.sound, noiseLoop(context, anchor.sound));
      const source = context.createBufferSource();
      source.buffer = buffers.get(anchor.sound);
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = spec.center;
      filter.Q.value = spec.q;
      const gain = context.createGain();
      gain.gain.value = spec.volume;
      if (!trackGains.has(anchor.sound)) trackGains.set(anchor.sound, []);
      trackGains.get(anchor.sound).push(gain);
      const pan = panner(anchor.position.x, anchor.position.y, anchor.position.z, anchor.radius_m ?? 12);
      source.connect(filter).connect(gain).connect(pan).connect(anchor.sound==='wood_fire'?master:outdoor);
      source.start(0, ((anchor.position.x*17+anchor.position.z*7)%source.buffer.duration+source.buffer.duration)%source.buffer.duration);
    }
  }

  function setup() {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    context = new Context();
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    outdoor=context.createGain();
    canopyFilter=context.createBiquadFilter();
    canopyFilter.type='lowpass';
    canopyFilter.frequency.value=8500;
    outdoor.connect(canopyFilter).connect(master);
    connectAnchors(anchors);
    for (const [index, track] of westTracks.entries()) {
      if (!buffers.has(track.sound)) buffers.set(track.sound, marketBuffer(context, track.sound));
      const source = context.createBufferSource();
      source.buffer = buffers.get(track.sound);
      source.loop = true;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(panner(track.x, 1.18, track.z, track.radius)).connect(outdoor);
      source.start(0, index*2.389);
      westGains.push({ gain, volume: track.volume });
    }
    for (const name of ["barley","river","oasis","mountain","indoor"]) {
      const source=context.createBufferSource(),gain=context.createGain(),color=context.createBiquadFilter();
      const spec=sounds[name];
      source.buffer=noiseLoop(context,name);
      source.loop=true;
      color.type="bandpass";
      color.frequency.value=spec.center;
      color.Q.value=spec.q;
      gain.gain.value=0;
      source.connect(color).connect(gain).connect(name==="indoor"?master:outdoor);
      source.start();
      regionGains.set(name,gain);
    }
    steps = { wood: makeLanding(context,true), stone: makeLanding(context,false) };
  }

  async function unlock() {
    if (!context) setup();
    if (!context) return;
    if (context.state !== "running") await context.resume();
    master.gain.setTargetAtTime(muted ? 0 : 0.50, context.currentTime, 0.22);
  }

  function toggle() {
    muted = !muted;
    if (context) master.gain.setTargetAtTime(muted ? 0 : 0.50, context.currentTime, 0.12);
    return muted;
  }

  function update(position, yaw, night, time) {
    if (!context || time - lastUpdate < 60) return;
    lastUpdate = time;
    const now = context.currentTime;
    mix=regions.sense(position);
    const shelter=mix.indoor;
    outdoor.gain.setTargetAtTime(1-.79*shelter,now,.34);
    canopyFilter.frequency.setTargetAtTime(8500-7480*shelter,now,.40);
    for (const [name,gain] of regionGains) {
      const level=(mix[name]??0)*sounds[name].volume;
      gain.gain.setTargetAtTime(level*(name==="river"||name==="indoor"?1:night ? .76 : 1),now,.52);
    }
    const listener = context.listener;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(position.x, now, 0.045);
      listener.positionY.setTargetAtTime(position.y + 1.66, now, 0.045);
      listener.positionZ.setTargetAtTime(position.z, now, 0.045);
      listener.forwardX.setTargetAtTime(-Math.sin(yaw), now, 0.045);
      listener.forwardZ.setTargetAtTime(-Math.cos(yaw), now, 0.045);
    }
    for (const gain of trackGains.get("market_crowd") ?? []) {
      gain.gain.setTargetAtTime(sounds.market_crowd.volume * (night ? 0.35 : 1), now, 0.3);
    }
    westMix = (1-smooth(-15,-8.5,position.x))*smooth(-35,-20,position.z)*(1-smooth(8,14,position.z));
    for (const {gain,volume} of westGains) gain.gain.setTargetAtTime(volume*westMix*(night ? .44 : 1),now,.38);
  }

  function land(speed, surface) {
    if (speed < .55 || muted || context?.state !== "running") return;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = /bridge|dock/.test(surface) ? steps.wood : steps.stone;
    source.playbackRate.value = .96+(landings%3)*.035;
    gain.gain.value = Math.min(.29,.082+speed*.031);
    source.connect(gain).connect(master);
    source.start();
    landings++;
  }

  return { unlock, toggle, update, land, addAnchors: connectAnchors, get running() { return context?.state === "running"; },
    get landings() { return landings; }, get westMix() { return westMix; }, get mix(){return mix.room?{...mix,room:mix.room.cn}:mix;} };
}
