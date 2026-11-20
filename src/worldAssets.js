import * as THREE from "three";
import { MeshoptSimplifier } from "meshoptimizer";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { waterName, wildBoatName } from "./waterline.js";

const p=new THREE.Vector3(), normal=new THREE.Vector3();
const box=new THREE.Box3();
const protectedName=/^(?:col_|npc_)/;
const terrainName=/^terrain_mesopotamia_continuous/;
const fireName=/^(?:fire_|polish_flame_)/;
export const fineScenery=/(?:^farm_barley|^wild_reed_|^leaf_reed|^sand_pebble|^sand_dust|^polish_flower|^wild_shrub|wild_rushes|wallfoot_planters|high_reed|low_grass|hand_tied_nets|fishing_net|shell_scree|small_scree)/i;
const noSmallShadow=/(?:ground|soil|ripples|net_frame|fishnet|rope|reed_rim|debris|flower|pebble|grass|brush|talus|scree|straw|fringe|quay_pavers)/i;
const smallProps=/^(?:prop_|house_rooftop_drying_clothes_|market_guild_|farmhouse_cedar_rafters_joinery_mats_jars_|veg_wild_tamarisk)/;

function owner(mesh,root) {
  return mesh.parent?.isGroup && mesh.parent!==root && mesh.parent.name ? mesh.parent : mesh;
}

function dataSlice(source,indexes) {
  const geometry=new THREE.BufferGeometry();
  const points=[],normals=[],colors=[],uv=[],index=[],map=new Map();
  const color=source.attributes.color, uvSource=source.attributes.uv;
  for (const i of indexes) {
    if (!map.has(i)) {
      map.set(i,points.length/3);
      p.fromBufferAttribute(source.attributes.position,i);
      points.push(p.x,p.y,p.z);
      normal.fromBufferAttribute(source.attributes.normal,i);
      normals.push(normal.x,normal.y,normal.z);
      if (color) {
        colors.push(color.getX(i),color.getY(i),color.getZ(i));
        if (color.itemSize===4) colors.push(color.getW(i));
      }
      if (uvSource) uv.push(uvSource.getX(i),uvSource.getY(i));
    }
    index.push(map.get(i));
  }
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(points,3));
  geometry.setAttribute("normal",new THREE.Float32BufferAttribute(normals,3));
  if (color) geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,color.itemSize));
  if (uvSource) geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(index);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function spatialPieces(mesh, span) {
  const source=mesh.geometry;
  const positions=source.attributes.position;
  const index=source.index.array;
  const groups=new Map();
  for (let i=0;i<index.length;i+=3) {
    p.fromBufferAttribute(positions,index[i]).applyMatrix4(mesh.matrixWorld);
    const key=Math.floor(p.x/span)*4096+Math.floor(p.z/span);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(index[i],index[i+1],index[i+2]);
  }
  return Array.from(groups.values(),indices=>dataSlice(source,indices).applyMatrix4(mesh.matrixWorld));
}

function collectFire(mesh,name,flames) {
  const source=mesh.geometry;
  const group=name.endsWith("_flame");
  const xyz=source.attributes.position;
  for (let i=0;i<xyz.count;i++) {
    p.fromBufferAttribute(xyz,i).applyMatrix4(mesh.matrixWorld);
    const key=group ? name : "oil_lamp_"+(Math.round(p.x*2)/2)+"_"+(Math.round(p.z*2)/2)+"_"+Math.round(p.y*2);
    if (!flames.has(key)) flames.set(key,new THREE.Box3());
    flames.get(key).expandByPoint(p);
  }
}

function attributeDefaults(geometry,height=0,foundation=0) {
  const count=geometry.attributes.position.count;
  const base=new Float32Array(2*count);
  if (foundation) for (let i=0;i<base.length;i+=2) {base[i]=height;base[i+1]=foundation;}
  geometry.setAttribute("foundation",new THREE.BufferAttribute(base,2));
}

function cityGeometry(mesh,name) {
  const source=mesh.geometry;
  const geometry=new THREE.BufferGeometry();
  for (const key of ["position","color","uv"]) {
    if (source.hasAttribute(key)) geometry.setAttribute(key,source.attributes[key].clone());
  }
  const sourceNormal=source.getAttribute("normal");
  if (sourceNormal && (sourceNormal.normalized || sourceNormal.isInterleavedBufferAttribute)) {
    const normals=new THREE.Float32BufferAttribute(sourceNormal.count*3,3);
    for (let i=0;i<sourceNormal.count;i++) {
      normals.setXYZ(i,sourceNormal.getX(i),sourceNormal.getY(i),sourceNormal.getZ(i));
    }
    geometry.setAttribute("normal",normals);
  } else if (sourceNormal) {
    geometry.setAttribute("normal",sourceNormal.clone());
  }
  const count=geometry.attributes.position.count;
  if (!geometry.hasAttribute("uv")) geometry.setAttribute("uv",new THREE.BufferAttribute(new Float32Array(count*2),2));
  geometry.setIndex(source.index?.clone()??new THREE.BufferAttribute(Uint32Array.from({length:count},(_,i)=>i),1));
  if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
  geometry.applyMatrix4(mesh.matrixWorld);
  const plaster=/^(?:wall_|gate_|house_(?:courtyard|terraced|alley|workshop)|temple_(?:plaster|base))/.test(name);
  attributeDefaults(geometry,name.startsWith("temple_")?8.2:0,Number(plaster));
  return geometry;
}

const detailGeometry=new WeakMap();
function reducedGeometry(source, lighterLOD = false) {
  if (!MeshoptSimplifier.supported||!source.index||source.index.count<(lighterLOD?3200:5200)) return source;
  if (detailGeometry.has(source))return detailGeometry.get(source);
  const count=source.index.count;
  const indices=new Uint32Array(source.index.array);
  const [lighter]=MeshoptSimplifier.simplify(indices,source.attributes.position.array,3,
    Math.floor(count*(lighterLOD?.29:.43)/3)*3,lighterLOD?.032:.015,["LockBorder","Prune"]);
  if (lighter.length>=count*.91 || !lighter.length) {detailGeometry.set(source,source);return source;}
  const out=new THREE.BufferGeometry();
  for (const [key,value] of Object.entries(source.attributes)) out.setAttribute(key,value);
  out.setIndex(new THREE.BufferAttribute(lighter,1));
  out.boundingBox=source.boundingBox;
  out.boundingSphere=source.boundingSphere;
  detailGeometry.set(source,out);
  return out;
}
export async function makeBatches(city,wild,scene,materialFor,water,distantWater) {
  await MeshoptSimplifier.ready;
  const materialCache=new Map(),hullMaterials=new Map(),groups=new Map(),flames=new Map(),sectors=new Map();
  const sourceMeshes=[];
  const layer=new THREE.Group();
  layer.name="uruk_merged_world_visuals";
  scene.add(layer);
  function toon(source, hull = false) {
    const cache=hull?hullMaterials:materialCache;
    if (!cache.has(source)) cache.set(source,materialFor(source,hull));
    return cache.get(source);
  }
  function enqueue(geometry, descriptor, cell) {
    const color=geometry.getAttribute("color");
    const key=[descriptor.material.id,cell,descriptor.cast,descriptor.detailDistance,descriptor.lodDistance,
      color?.itemSize??0,color?.array.constructor.name??"",color?.normalized??false].join(":");
    if (!groups.has(key)) groups.set(key,{...descriptor,geometries:[]});
    groups.get(key).geometries.push(geometry);
  }

  for (const [root,inWild] of [[city,false],[wild,true]]) {
    root.traverse(mesh=>{
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const parent=owner(mesh,root), id=parent.name||mesh.name;
      if (protectedName.test(mesh.name) || protectedName.test(id)) return;
      const name=mesh.material.name;
      if (/^(?:canal_painted_ripples|geo_wild_water_broken_reflection_strokes|wild_boat_broken_water_highlights)/.test(id)) {
        mesh.visible=false;
        sourceMeshes.push(mesh);
        return;
      }
      if (waterName.test(id)||waterName.test(mesh.name)) {
        mesh.material=inWild?distantWater:water;
        return;
      }
      if (fireName.test(name)) {
        collectFire(mesh,id,flames);
        mesh.visible=false;
        sourceMeshes.push(mesh);
        return;
      }
      const hull=wildBoatName.test(id) || /^boat_reed_cargo_\d{2}$/.test(mesh.parent?.name) ||
          /^boat_reed_cargo_\d{2}$/.test(mesh.parent?.parent?.name);
      const material=toon(mesh.material,hull);
      const geometry=mesh.geometry;
      if (terrainName.test(id)) {
        for (const piece of spatialPieces(mesh,108)) {
          register(new THREE.Mesh(piece,material),{id:"alluvial_terrain_sector",cast:false,detailDistance:1200,lodDistance:72,lighterLOD:true});
        }
        mesh.visible=false;
        sourceMeshes.push(mesh);
        return;
      }
      if (hull) {
        mesh.material=material;
        mesh.receiveShadow=true;
        return;
      }
      box.copy(geometry.boundingBox??(geometry.computeBoundingBox(),geometry.boundingBox)).applyMatrix4(mesh.matrixWorld);
      const size=box.getSize(new THREE.Vector3());
      const plantDetail=fineScenery.test(id)||(/^(?:veg_|prop_)/.test(id)&&fineScenery.test(name));
      const streetDetail=smallProps.test(id)&&Math.max(size.x,size.z,size.y)<6.5;
      const palmDetail=/palm_scales|wild_palm_bark|palm_bark/.test(name);
      const wovenRibs=id.startsWith("marsh_longhouse_bundled_arch_ribs_");
      const detailDistance=plantDetail ? (/barley|rushes|high_reed/.test(id)?65:43) : streetDetail?72:palmDetail?96:
        /cliff_|wild_rock|rock_module/.test(id)?370:inWild?510:400;
      const cast=!plantDetail&&!noSmallShadow.test(id)&&!noSmallShadow.test(name)&&size.y>.64&&Math.max(size.x,size.z)>.47;
      const cellSize=plantDetail?16:streetDetail?24:inWild?47:42;
      const lighterLOD=plantDetail||wovenRibs||/reed|palm|fronds/.test(id);
      const descriptor={id,material,cast,detailDistance,lighterLOD,lodDistance:plantDetail?17:lighterLOD?24:39};
      const pieces=plantDetail && geometry.index && geometry.index.count>7500 && Math.max(size.x,size.z)>24
        ? spatialPieces(mesh,cellSize) : [cityGeometry(mesh,id)];
      for (const piece of pieces) {
        piece.computeBoundingBox();
        piece.boundingBox.getCenter(p);
        if (!piece.hasAttribute("uv")) piece.setAttribute("uv",new THREE.Float32BufferAttribute(piece.attributes.position.count*2,2));
        if (!piece.hasAttribute("foundation")) attributeDefaults(piece);
        enqueue(piece,descriptor,Math.floor(p.x/cellSize)+"|"+Math.floor(p.z/cellSize));
      }
      mesh.visible=false;
      sourceMeshes.push(mesh);
    });
  }

  function register(mesh,descriptor) {
    mesh.name=descriptor.id;
    mesh.castShadow=descriptor.cast;
    mesh.receiveShadow=true;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const sphere=mesh.geometry.boundingSphere;
    const key=Math.floor(sphere.center.x/54)*4096+Math.floor(sphere.center.z/54);
    if (!sectors.has(key)) {
      const group=new THREE.Group();
      layer.add(group);
      sectors.set(key,{group,bounds:new THREE.Box3(),items:[]});
    }
    const sector=sectors.get(key);
    sector.group.add(mesh);
    sector.bounds.union(sphere.getBoundingBox(new THREE.Box3()));
    sector.items.push({mesh,sphere,distance:descriptor.detailDistance,lodDistance:descriptor.lodDistance,castsShadow:descriptor.cast,
      detail:mesh.geometry,low:reducedGeometry(mesh.geometry,descriptor.lighterLOD)});
  }
  for (const batch of groups.values()) {
    const geometry=batch.geometries.length===1?batch.geometries[0]:mergeGeometries(batch.geometries);
    if (batch.geometries.length!==1) for (const part of batch.geometries) part.dispose();
    register(new THREE.Mesh(geometry,batch.material),batch);
  }
  const frustum=new THREE.Frustum(), matrix=new THREE.Matrix4();
  function update(camera) {
    frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    for (const {group,bounds,items} of sectors.values()) {
      group.visible=bounds.distanceToPoint(camera.position)<65 || frustum.intersectsBox(bounds);
      if (!group.visible) continue;
      for (const {mesh,sphere,distance,lodDistance,castsShadow,detail,low} of items) {
        const range=Math.max(0,sphere.center.distanceTo(camera.position)-sphere.radius*.82);
        mesh.visible=range<distance&&(castsShadow&&range<70||frustum.intersectsSphere(sphere));
        if (mesh.visible) {
          mesh.geometry=range>lodDistance?low:detail;
          mesh.castShadow=castsShadow&&range<91;
        }
      }
    }
  }
  function detachSourceMeshes() {
    for (const mesh of sourceMeshes) {
      const parent=mesh.parent;
      mesh.removeFromParent();
      if (parent.isGroup && parent.children.length===0) parent.removeFromParent();
    }
    sourceMeshes.length=0;
  }
  return {flames,update,detachSourceMeshes,drawGroups:groups.size};
}

