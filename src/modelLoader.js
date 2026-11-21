import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const base = import.meta.env.BASE_URL;

export async function loadModel(file, progress) {
  const controller = new AbortController();
  const size = __URUK_MODEL_BYTES__[file];
  let idle;
  let timedOut = false;
  const expire = () => {
    timedOut = true;
    controller.abort();
  };
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(expire, 25_000);
  };
  const deadline = setTimeout(expire, 150_000);
  const bytes = new Uint8Array(size);
  let loaded = 0;
  progress({ loaded, size });
  try {
    resetIdle();
    const response = await fetch(`${base}models/${file}?v=${size}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`资源服务器返回 HTTP ${response.status}`);
    if (!response.body) throw new Error("浏览器未收到资源内容");
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (loaded + value.length > size) throw new Error("资源版本不一致，请刷新页面重试");
      bytes.set(value, loaded);
      loaded += value.length;
      resetIdle();
      progress({ loaded, size });
    }
    if (loaded !== size) throw new Error("下载中断，未收到完整的模型文件");
  } catch (error) {
    if (timedOut) throw new Error("网络超时，模型下载未完成");
    if (error instanceof TypeError) throw new Error("网络连接中断，无法下载模型");
    throw error;
  } finally {
    clearTimeout(idle);
    clearTimeout(deadline);
    controller.abort();
  }
  progress({ loaded, size, preparing: true });
  // Let the browser paint the decoding status before starting the CPU work.
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    return (await loader.parseAsync(bytes.buffer, base + "models/")).scene;
  } catch (error) {
    console.error("Model decoding failed", file, error);
    throw new Error("模型解码失败，文件可能损坏或浏览器不支持压缩格式");
  }
}
