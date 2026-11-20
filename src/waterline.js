import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";

export const waterName = /^(?:canal_water_surface|geo_two_rivers_and_oasis_water|geo_farm_gravity_irrigation_branches)/;
export const wildBoatName = /^wild_boat_(?:reed_hulls|cargo_bundles)_\d{2}$/;

const level = -1.24;
const coast = /^(?:terrain_mesopotamia_continuous|quay_revetment_|quay_inlet_|geo_oasis_asymmetric_shoals)/;
const piers = /^(?:wild_village_wood_pier_|prop_marsh_additional_timber_moorings|bridge_north_mudbrick_stone_three_arches|quay_pedestrian_bridge_)/;

function waterSurvey(city,wild) {
  const surfaces=[];
  for (const root of [city,wild]) {
    root.traverse(object => {
      if (!object.isMesh || !waterName.test(object.name)) return;
      object.geometry.boundsTree ??= new MeshBVH(object.geometry);
      object.raycast=acceleratedRaycast;
      surfaces.push(object);
    });
  }
  const origin=new THREE.Vector3(), down=new THREE.Vector3(0,-1,0);
  const ray=new THREE.Raycaster(), hits=[];
  ray.firstHitOnly=true;
  ray.far=13;
  return (x,z) => {
    ray.set(origin.set(x,8,z),down);
    hits.length=0;
    return ray.intersectObjects(surfaces,false,hits)[0]?.point.y;
  };
}

function settleBoats(wild, waterHeight) {
  const lifts=[];
  const bounds=new THREE.Box3(), center=new THREE.Vector3();
  const hulls=[];
  wild.traverse(node=>{
    if (/^wild_boat_reed_hulls_\d{2}$/.test(node.name)) hulls.push(node);
  });
  for (const hull of hulls) {
    const deck=hull.children.find(child=>child.material?.name === "wild_wood_warm");
    if (!deck) continue;
    const cargo=wild.getObjectByName(hull.name.replace("reed_hulls","cargo_bundles"));
    bounds.setFromObject(hull).getCenter(center);
    const surface=waterHeight(center.x,center.z);
    if (surface===undefined) continue;
    const keel=bounds.min.y;
    const deckBottom=bounds.setFromObject(deck).min.y;
    const lift=Math.max(0,Math.min(surface+.11-deckBottom,surface-.08-keel));
    if (lift>0) {
      for (const node of [hull,cargo].filter(Boolean)) {
        node.getWorldPosition(center).y+=lift;
        node.position.copy(node.parent.worldToLocal(center));
        node.updateWorldMatrix(false,true);
      }
    }
    lifts.push({name:hull.name,water:surface,lift,deckClearance:deckBottom+lift-surface,draft:surface-keel-lift});
  }
  return lifts;
}

function worldTriangles(mesh, callback) {
  const positions=mesh.geometry.attributes.position;
  const world=new Float32Array(positions.count*3);
  const position=new THREE.Vector3();
  for (let i=0;i<positions.count;i++) {
    position.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).toArray(world,i*3);
  }
  const index=mesh.geometry.index?.array;
  const count=index?.length??positions.count;
  for (let i=0;i<count;i+=3) {
    const a=(index?index[i]:i)*3,b=(index?index[i+1]:i+1)*3,c=(index?index[i+2]:i+2)*3;
    callback(world,a,b,c);
  }
}

function section(mesh, level, callback) {
  const ends=new Float32Array(4);
  worldTriangles(mesh,(world,a,b,c)=>{
    const ya=world[a+1]-level,yb=world[b+1]-level,yc=world[c+1]-level;
    if ((ya<0 && yb<0 && yc<0) || (ya>=0 && yb>=0 && yc>=0)) return;
    let k=0;
    if ((ya<0)!==(yb<0)) {
      const t=ya/(ya-yb);
      ends[k++]=THREE.MathUtils.lerp(world[a],world[b],t);
      ends[k++]=THREE.MathUtils.lerp(world[a+2],world[b+2],t);
    }
    if ((yb<0)!==(yc<0)) {
      const t=yb/(yb-yc);
      ends[k++]=THREE.MathUtils.lerp(world[b],world[c],t);
      ends[k++]=THREE.MathUtils.lerp(world[b+2],world[c+2],t);
    }
    if ((yc<0)!==(ya<0)) {
      const t=yc/(yc-ya);
      ends[k++]=THREE.MathUtils.lerp(world[c],world[a],t);
      ends[k++]=THREE.MathUtils.lerp(world[c+2],world[a+2],t);
    }
    if(k===4) callback(ends[0],ends[1],ends[2],ends[3]);
  });
}

function boatHollows(wild) {
  const hulls=[];
  const area=new THREE.Box3();
  wild.traverse(object=>{
    if (object.isMesh && /^wild_boat_reed_hulls_/.test(object.parent.name) && object.material.name==="history_bitumen_hull") {
      hulls.push(object);
      area.expandByObject(object);
    }
  });
  if (!hulls.length) return null;
  area.expandByScalar(.15);
  const {min,max}=area;
  const bounds=new THREE.Vector4(min.x,min.z,max.x-min.x,max.z-min.z);
  const canvas=document.createElement("canvas");
  canvas.width=Math.ceil(bounds.z*14);
  canvas.height=Math.ceil(bounds.w*14);
  const ctx=canvas.getContext("2d");
  ctx.setTransform(canvas.width/bounds.z,0,0,canvas.height/bounds.w,
    -min.x*canvas.width/bounds.z,-min.z*canvas.height/bounds.w);
  ctx.fillStyle="#fff";
  const below=level-.005;
  for(const hull of hulls) {
    worldTriangles(hull,(vertices,a,b,c)=>{
      if (vertices[a+1]>=below && vertices[b+1]>=below && vertices[c+1]>=below) return;
      const polygon=[];
      for (const [from,to] of [[a,b],[b,c],[c,a]]) {
        const top=vertices[from+1],bottom=vertices[to+1];
        if (top<below) polygon.push([vertices[from],vertices[from+2]]);
        if ((top<below)===(bottom<below)) continue;
        const t=(below-top)/(bottom-top);
        polygon.push([THREE.MathUtils.lerp(vertices[from],vertices[to],t),THREE.MathUtils.lerp(vertices[from+2],vertices[to+2],t)]);
      }
      if(polygon.length<3) return;
      ctx.beginPath();
      ctx.moveTo(...polygon[0]);
      for(let i=1;i<polygon.length;i++) ctx.lineTo(...polygon[i]);
      ctx.closePath();
      ctx.fill();
    });
  }
  const map=new THREE.CanvasTexture(canvas);
  map.flipY=false;
  map.generateMipmaps=false;
  map.minFilter=THREE.LinearFilter;
  return {map,bounds};
}

export function createWaterline(city,wild,scene,time) {
  const waterHeight=waterSurvey(city,wild);
  const boatLifts=settleBoats(wild,waterHeight);
  const sectors=new Map(), samples=new Map();
  function strip(x1,z1,x2,z2,width,opacity) {
    const dx=x2-x1,dz=z2-z1, len=Math.hypot(dx,dz);
    if(len<.018) return;
    const x=(x1+x2)*.5,z=(z1+z2)*.5;
    const key=Math.round(x*7)+":"+Math.round(z*7);
    if (samples.has(key)) return;
    const y=waterHeight(x,z);
    if (y===undefined) return;
    samples.set(key,true);
    const cell=Math.floor(x/60)+":"+Math.floor(z/60);
    if(!sectors.has(cell)) sectors.set(cell,{xyz:[],uv:[],strength:[]});
    const {xyz,uv,strength}=sectors.get(cell);
    const u=dz/len*width,v=-dx/len*width;
    const a=[x1-u,y+.022,z1-v],b=[x1+u,y+.022,z1+v];
    const c=[x2-u,y+.022,z2-v],d=[x2+u,y+.022,z2+v];
    xyz.push(...a,...c,...b,...b,...c,...d);
    uv.push(0,0,0,1,1,0,1,0,0,1,1,1);
    for(let i=0;i<6;i++) strength.push(opacity);
  }
  for(const root of [city,wild]) {
    root.traverse(mesh=>{
      if (!mesh.isMesh) return;
      const name=mesh.parent.isGroup?mesh.parent.name:mesh.name;
      const hull=mesh.material.name==="history_bitumen_hull";
      const shore=coast.test(name)||coast.test(mesh.name);
      if (!hull && !shore && !piers.test(name) && !piers.test(mesh.name)) return;
      // Follow the actual contour of the land and the wetted cross-section of each piling.
      section(mesh, level+.018, (x1,z1,x2,z2)=>strip(x1,z1,x2,z2,shore?.29:hull?.19:.24,shore?.68:.92));
    });
  }
  const night={value:0};
  const material=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{time,night},
    vertexShader:`
      attribute float strength;
      varying vec2 vUv,vGround;
      varying float vStrength,vDistance;
      void main() {
        vUv=uv; vStrength=strength; vGround=position.xz;
        vec4 view=viewMatrix*vec4(position,1.);
        vDistance=-view.z;
        gl_Position=projectionMatrix*view;
      }
    `,
    fragmentShader:`
      uniform float time,night;
      varying vec2 vUv,vGround;
      varying float vStrength,vDistance;
      void main() {
        float phase=dot(vGround,vec2(2.84,1.95))-time*1.26;
        float crease=abs(vUv.x-(.56+.13*sin(phase)));
        float aa=max(fwidth(crease),.02);
        float wave=1.-smoothstep(.063,.18+aa,crease);
        float breaks=.25+.75*smoothstep(-.38,.52,sin(phase)+.40*cos(dot(vGround,vec2(-1.7,3.2))+time*1.83));
        float end=smoothstep(0.,.095,vUv.y)*smoothstep(0.,.095,1.-vUv.y);
        float visibleRange=1.-smoothstep(49.,110.,vDistance);
        float alpha=wave*breaks*end*vStrength*visibleRange*(1.-.37*night);
        if(alpha<.025) discard;
        gl_FragColor=vec4(mix(vec3(.77,.96,.92),vec3(.22,.43,.60),night),alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const patches=[];
  for(const {xyz,uv,strength} of sectors.values()) {
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(xyz,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
    geometry.setAttribute("strength",new THREE.Float32BufferAttribute(strength,1));
    const foam=new THREE.Mesh(geometry,material);
    foam.name="painted_waterline_foam";
    geometry.computeBoundingSphere();
    patches.push(foam);
    scene.add(foam);
  }
  return {boatLifts,boatMask:boatHollows(wild),update(darkness,camera){
    night.value=darkness;
    for(const foam of patches) {
      const sphere=foam.geometry.boundingSphere;
      foam.visible=sphere.center.distanceToSquared(camera.position)<(sphere.radius+112)**2;
    }
  }};
}
