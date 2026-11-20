import * as THREE from "three";

const voices = {
  farmer:["卢麦","大麦种植人","捏一粒试试，晒干的麦穗会在手里响。清早我们先巡田埂，再决定哪块地先放水。","这季收成怎样？","低处返了些盐。大麦比别的谷子耐得住，我们把种子从结得最密的那几束里挑出来。"],
  farmwife:["宁萨","城郊农妇","别踏断那条细埂呀。太阳偏西时，我才开水闸，让最远那垄也吃到水。","屋顶为什么铺苇席？","下过雨先把席子卷起来。热的时候一家人搬到棚下，夜里在屋顶听虫叫。"],
  porter:["卢迦","谷仓挑夫","篮子有些重。要是看见一道泥板摆在门口，那户人家今天正等着收麦。","你这趟往哪去？","先过城门，把两篓麦交给书吏记数。空着篮回来时，顺路替家里取一罐油。"],
  fisher:["伊卡","河岸渔夫","看那簇倒向水面的芦苇。鱼会躲在下面，晒网时我总把那几段细线另挑出来。","你是怎么补网的？","把绳捻紧，网眼就不容易跑形。破口太大时我会割掉半圈，重新接一片。"],
  boatman:["巴勒","沥青船工","新补的船底还热，别碰。我把黑沥青压进芦苇缝里，等冷透才下河。","为什么用沥青修船？","光把芦苇扎紧，只能防住大缝。黑沥青把细眼也堵住，船沉得深时才不渗水。"],
  tavernkeeper:["库拉","大麦啤酒屋店主","这瓮今早才揭开。坐矮桌边吧，吸管插下去一些，谷壳会留在上面。","为什么用芦苇吸管？","吸管伸到酒液里，嘴就碰不到浮在上面的谷渣。头一口总有点苦，慢慢喝才尝到麦香。"],
  marketvendor:["塔宁","染布摊主","摸一下这段没有上染的布边。舒展以后才看得清经线，我照这个来算布能裁多宽。","蓝布要染几次？","出缸见风才转色。浅蓝一两遍够了，深蓝得慢慢来。"],
  scribe:["恩梅","泥板书吏","等一等，这块泥板还是湿的。你看我把这一排粮数压在这里，交货的人名记在边上。","滚筒印章怎么用？","在湿泥上滚一圈，纹样会连起来。等板子变硬，下一批货到了也能分清是谁交的。"],
  priest:["伊鲁","高台观星人","今晚如果云散了，我会从这层台沿看第一颗星。你来时，山道上的石桥有风吗？","你怎么算星夜的时辰？","先记住星从哪块山脊升出来。隔几天再看，若同一颗星换了地方，我会在泥板边上另添一记。"],
  trader:["达甘","绿洲商队旅人","这包是织物，旁边那捆是外地来的雪松。夜里卸在帐外，松脂味能飘到取水栈道。","青金石从哪里来？","我只认识下一个换货的地方。石料在几个商队手里转过，越蓝的小块越会仔细包好。"],
};

const resident = (file) => {
  const [name,role,intro,question,answer] = voices[file];
  return { name,role,intro,questions:[[question,answer]] };
};

const exported = {
  npc_wild_herder_01:"farmer",
  npc_wild_boatman_01:"boatman",
  npc_wild_net_mender_01:"fisher",
  npc_wild_caravan_guide_01:"trader",
  npc_wild_observatory_keeper_01:"priest",
  npc_wild_ridge_wayfarer_01:"porter",
};

export function configureResident(anchor) {
  const identity=exported[anchor.name];
  if (!identity) return;
  anchor.file="sumer/"+identity;
  anchor.profile=resident(identity);
}

function put(scene,walk,identity,id,candidates,dimensions=[.95,1.76]) {
  for (const [x,y,z] of candidates) {
    const floor=walk.floor(x,z,y,.45,.63);
    if (!floor || walk.occupied(x,floor.point.y,z,.13)) continue;
    const [width,height]=dimensions;
    const geo=new THREE.PlaneGeometry(width,height);
    geo.translate(0,height*.5,0);
    const mesh=new THREE.Mesh(geo);
    mesh.name=id;
    mesh.position.copy(floor.point);
    scene.add(mesh);
    return {name:id,node:mesh,mesh,point:floor.point.clone(),aspect:width/height,flipY:true,
      file:identity.includes("/")?identity:"sumer/"+identity,profile:identity.includes("/")?undefined:resident(identity)};
  }
  return null;
}

export function addRiversideResidents(scene,walk) {
  const discovered=[
    ["tavernkeeper","tavern", [[-28.78,0,-20.32],[-28.96,0,-20.58],[-28.98,0,-21.50]], [.98,1.68]],
    ["scribe","scribe", [[39.3,0,-2.15],[38.48,0,-1.86],[39.6,0,-2.5]], [.90,1.71]],
    ["farmer","fields", [[13.42,0,47.55],[13.75,0,46.3],[12.52,0,49.02]], [1.08,1.77]],
    ["farmwife","east_farm", [[35.04,.04,47.35],[34.98,.05,45.92],[34.07,.05,42.75]], [1.03,1.68]],
    ["porter","west_farm", [[-23.95,0,45.0],[-25.65,0,54.3],[-24.3,0,45.13]], [1.07,1.81]],
    ["marketvendor","market", [[-15.95,0,-10.6],[-16.10,0,-10.20],[-16.75,0,-11.10]], [1.04,1.73]],
    ["fisher","marsh", [[100.99,1.02,126.10],[105.85,1.02,130.10],[102.0,1.02,125.40]], [1.12,1.77]],
    ["trader","oasis", [[-248.13,.86,71.7],[-245.0,1.15,70.3],[-251.4,1.06,72.8]], [1.12,1.81]],
    ["boatman","quay", [[-.98,.018,-11.8],[-1.04,.018,-12.3],[-.85,.018,-12.45]], [1.20,1.82]],
    ["porter","bridge", [[-13.92,1.1,-6.78],[-14.10,.95,-6.19],[-16.2,.42,-6.18]], [1.10,1.77]],
  ];
  const result=discovered.map(([role,id,locations,size])=>put(scene,walk,role,"npc_everyday_"+id,locations,size)).filter(Boolean);
  const older=[
    ["02",-15.92,-7.80,"埃莉","西岸织工","这块布刚从架上取下来。顺着光能看见织进去的八角星。","有染好的蓝布吗？","蓝布得浸染几回，昨天晒好的那匹就在架子下。"],
    ["04",-20.63,-8.98,"阿什","陶作坊学徒","刚烧好的壶碰在一起，最容易磕到壶口。","怎么挑不漏的陶壶？","装满水再放在干泥板上。有水印的壶就得重挑。"],
    ["07",-25.04,-6.84,"努里","西岸木匠","屋边那架木梯刚修好。新换的横档颜色浅，一眼就能认出来。","桥上的木梁要常修吗？","涨水过后先看两端的钉和绳，哪根松了便趁清早换掉。"],
    ["09",-16.80,-14.27,"玛雅","布商","早晨挂出来的橙布够裁一整件披肩。","怎么买布？","选一角放到太阳底下看。颜色差一点，做成披肩会看得更清楚。"],
  ];
  for (const [i,x,z,name,role,intro,question,answer] of older) {
    const npc=put(scene,walk,"west/resident_"+i,"npc_west_resident_"+i,[[x,0,z],[x-.7,0,z+.7],[x+.45,0,z-.55]]);
    if (!npc) continue;
    npc.profile={name,role,intro,questions:[[question,answer]]};
    result.push(npc);
  }
  return result;
}

