import * as THREE from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";

const CELL = 24;
const down = new THREE.Vector3(0, -1, 0);
const footOrigin = new THREE.Vector3();
const solidHit = new THREE.Vector3();

function spatialIndex(items) {
  const cells = new Map();
  for (const item of items) {
    const { min, max } = item.box;
    for (let x = Math.floor(min.x / CELL); x <= Math.floor(max.x / CELL); x++) {
      for (let z = Math.floor(min.z / CELL); z <= Math.floor(max.z / CELL); z++) {
        const key = x * 1024 + z;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(item);
      }
    }
  }
  const empty = [];
  return (x, z) => cells.get(Math.floor(x / CELL) * 1024 + Math.floor(z / CELL)) ?? empty;
}

function footprint(mesh) {
  const positions = mesh.geometry.attributes.position;
  const points = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
    if (!points.some(([x, z]) => Math.abs(p.x - x) + Math.abs(p.z - z) < .0001)) points.push([p.x, p.z]);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (a, b, c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  function half(source) {
    const hull = [];
    for (const point of source) {
      while (hull.length > 1 && turn(hull.at(-2), hull.at(-1), point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  }
  return half(points).concat(half(points.reverse()));
}

function overlapsFootprint(hull, x, z, radius) {
  if (hull.length < 3) return true;
  let inside = true;
  for (let i = 0; i < hull.length; i++) {
    const [a, b] = hull[i], [c, d] = hull[(i + 1) % hull.length];
    const dx = c-a, dz = d-b;
    if (dx*(z-b)-dz*(x-a) < 0) inside = false;
    const t = THREE.MathUtils.clamp(((x-a)*dx+(z-b)*dz)/(dx*dx+dz*dz),0,1);
    if ((x-a-t*dx)**2+(z-b-t*dz)**2 < radius*radius) return true;
  }
  return inside;
}

export function createWalkWorld(walkMeshes, solidMeshes) {
  const walks = walkMeshes.map(({ name, mesh }) => {
    const geometry=mesh.geometry;
    if ((geometry.index?.count??geometry.attributes.position.count)>3000) {
      geometry.boundsTree??=new MeshBVH(geometry,{maxLeafSize:12});
      mesh.raycast=acceleratedRaycast;
    }
    return { name,mesh,box:new THREE.Box3().setFromObject(mesh) };
  });
  const solids = solidMeshes.map(mesh => ({ mesh, box: new THREE.Box3().setFromObject(mesh), hull: footprint(mesh) }));
  const walkAt = spatialIndex(walks);
  const solidAt = spatialIndex(solids);
  const terrainRay = new THREE.Raycaster();
  terrainRay.firstHitOnly=true;
  const wallRay = new THREE.Raycaster();
  const hits = [];
  const boxes = new Map(walks.map(({ name, box }) => [name, box]));
  let inspected = 0;

  function floor(x, z, y, rise = .35, drop = .59) {
    terrainRay.set(footOrigin.set(x,y+1.2,z),down);
    terrainRay.near = Math.max(0,1.2-rise);
    terrainRay.far = 1.2+drop;
    const minY=y-drop, maxY=y+rise;
    let best=null;
    inspected=0;
    for (const { mesh, box } of walkAt(x,z)) {
      if (x < box.min.x-.00002 || x > box.max.x+.00002 ||
          z < box.min.z-.00002 || z > box.max.z+.00002 ||
          maxY < box.min.y-.00002 || minY > box.max.y+.00002) continue;
      inspected++;
      hits.length=0;
      terrainRay.intersectObject(mesh,false,hits);
      if (hits.length && (!best || hits[0].distance < best.distance)) best=hits[0];
    }
    return best;
  }

  function occupied(x,y,z,radius=.22) {
    const items = solidAt(x,z);
    for (const { box,hull } of items) {
      if (y+1.51 > box.min.y+.01 && y+.075 < box.max.y &&
          x+radius > box.min.x && x-radius < box.max.x &&
          z+radius > box.min.z && z-radius < box.max.z && overlapsFootprint(hull,x,z,radius)) return true;
    }
    // A capsule may straddle a bucket boundary even when its centre is outside it.
    for (const side of [solidAt(x-radius,z),solidAt(x+radius,z),solidAt(x,z-radius),solidAt(x,z+radius)]) {
      if (side===items) continue;
      for (const { box,hull } of side) {
        if (y+1.51 > box.min.y+.01 && y+.075 < box.max.y &&
            x+radius > box.min.x && x-radius < box.max.x &&
            z+radius > box.min.z && z-radius < box.max.z && overlapsFootprint(hull,x,z,radius)) return true;
      }
    }
    return false;
  }

  function blockers(from,to) {
    const delta=to.clone().sub(from);
    const distance=delta.length();
    if (distance < .001) return distance;
    wallRay.set(from,delta.divideScalar(distance));
    wallRay.far=distance;
    const candidates=new Set([...solidAt(from.x,from.z),...solidAt(to.x,to.z)]);
    let closest=distance;
    for (const { mesh,box } of candidates) {
      if (!wallRay.ray.intersectBox(box,solidHit) || solidHit.distanceToSquared(from)>distance**2) continue;
      hits.length=0;
      wallRay.intersectObject(mesh,false,hits);
      if (hits.length) closest=Math.min(closest,hits[0].distance);
    }
    return closest;
  }

  function floorPlan(name) {
    const entry=walks.find(walk=>walk.name===name);
    return entry ? footprint(entry.mesh) : [];
  }

  return { floor,occupied,blockers,boxes,floorPlan,get candidates(){return inspected;} };
}

export const travelStops = {
  gate:       { name:"城门集市", point:[9.1,0,32.5], look:[8,3,12] },
  bridge:     { name:"高拱桥 · 西岸市集", point:[-.35,.018,-8.65], look:[-14,1.1,-5.3] },
  quay:       { name:"运河码头", point:[-3.89,.018,4.65], look:[-8,1,-6] },
  beerhouse:  { name:"西岸大麦啤酒屋", point:[-28.94,0,-24.85], look:[-28.94,1.25,-20.7] },
  scribe:     { name:"泥板书吏工坊", point:[35.72,0,-1.60], look:[40,1.4,-1.60] },
  courtyard:  { name:"西岸庭院屋", point:[-37.22,0,-15.92], look:[-37.22,1.2,-12] },
  temple:     { name:"白神庙露台", point:[26.51,8.2,-18.87], look:[27,10,-28] },
  farm:       { name:"城郊大麦村落", point:[10.35,0,48.6], look:[25,1.48,44.6] },
  farmhouse:  { name:"城郊农舍", point:[33.8,.03,47.20], look:[33.4,1.30,44.2] },
  fishing:    { name:"幼发拉底芦苇渔村", point:[104,1.02,129.5], look:[96,2.3,127.2] },
  oasis:      { name:"西侧商路绿洲", point:[-249,1.15,71.7], look:[-251,.3,53] },
  northbridge:{ name:"北侧三拱石桥", point:[24.51,12.92,-156.7], look:[-10,17,-165] },
  ziggurat:   { name:"北麓古神塔", point:[-24,130.1,-353.56], look:[-25,130,-345] },
};

const rooms = [
  ["col_walk_temple_sanctuary_nave","白神庙正殿","WHITE TEMPLE · NAVE"],
  ["col_walk_beerhouse_room","西岸大麦啤酒屋","BARLEY BEER HOUSE"],
  ["col_walk_scribe_room","泥板书吏工坊","TABLET WORKSHOP"],
  ["col_walk_courtyard_room","西岸庭院屋","COURTYARD HOME"],
  ["col_walk_wilds_farmhouse_02_interior","城郊农舍","WEST FARMSTEAD"],
  ["col_walk_wilds_farmhouse_06_interior","城郊农舍","EAST FARMSTEAD"],
];

export function createRegions(boxes, floorPlan = () => []) {
  const interiors=rooms.map(([key,cn,en])=>({cn,en,box:boxes.get(key),hull:floorPlan(key)})).filter(room=>room.box);
  function sense({x,y,z}) {
    let inside=0, room=null;
    for (const candidate of interiors) {
      const { min,max }=candidate.box;
      if (y < min.y-.18 || y > max.y+1.48) continue;
      let margin=Math.min(x-min.x,max.x-x,z-min.z,max.z-z);
      if (margin <= -.37) continue;
      const {hull}=candidate;
      for (let i=0;i<hull.length;i++) {
        const [a,b]=hull[i], [c,d]=hull[(i+1)%hull.length];
        margin=Math.min(margin,((c-a)*(z-b)-(d-b)*(x-a))/Math.hypot(c-a,d-b));
      }
      if (margin <= -.37) continue;
      const amount=THREE.MathUtils.smoothstep(margin,-.37,.65);
      if (amount > inside) { inside=amount; room=candidate; }
    }
    const bath = THREE.MathUtils.smoothstep;
    return { room:inside>.38?room:null, indoor:inside,
      barley:(1-bath(Math.abs(x-2),55,93))*bath(z,31,48)*(1-bath(z,84,110)),
      river:(1-bath(Math.abs(x-107),49,93))*bath(z,98,119)*(1-bath(z,162,205)),
      oasis:1-bath(Math.hypot(x+254,z-55),23,76),
      mountain:Math.max(bath(-z,88,190),bath(-z,60,115)*bath(y,5,29)),
    };
  }
  function label(p) {
    const area=sense(p);
    const {x,y,z}=p;
    if (area.room) return [area.room.cn,area.room.en];
    if (y>=109 && z < -289) return ["北麓古神塔","NORTHERN ZIGGURAT"];
    if (z < -90) {
      if (z < -132 && z > -172 && x > -10 && x < 53 && y > 8.9) return ["北侧三拱石桥","NORTHERN STONE BRIDGE"];
      return ["北麓山道","FOOTHILL ROAD"];
    }
    if (area.oasis > .20) return ["西侧商路绿洲","WESTERN CARAVAN OASIS"];
    if (area.river > .22) return ["幼发拉底芦苇渔村","EUPHRATES REED VILLAGE"];
    if (z>110) return ["幼发拉底河谷","EUPHRATES LOWLANDS"];
    if (area.barley>.28) return ["城郊大麦村落","BARLEY FARMSTEADS"];
    if (z>61) return ["城郊商道","ALLUVIAL TRADE ROAD"];
    if (x < -54) return ["西侧商道","WESTERN TRADE ROAD"];
    if (x > 53 || z < -60) return ["城外平原","ALLUVIAL PLAIN"];
    if (y > 7.8 && x > 10 && z < -17.6) return ["白神庙露台","WHITE TEMPLE"];
    if (x>20 && x<33 && z<2.7 && z>-17.8) return ["白神庙长阶","TEMPLE APPROACH"];
    if (z > 18) return ["城门集市","OUTER MARKET"];
    if (z > 10.55 && x>5.5 && x<12.5) return ["双塔城门","TWIN GATE"];
    if (x < -13 && x >= -21.1) return ["西岸市集","WEST BANK MARKET"];
    if (x < -21 || (z < -21 && x > 1 && x < 9)) return ["泥砖民居","OLD QUARTER"];
    if (x < 1.6) return ["运河码头","CANAL QUAY"];
    return ["石板主干道","STONE AVENUE"];
  }
  return { sense,label };
}

