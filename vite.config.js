import { defineConfig } from "vite";
import { statSync } from "node:fs";

const modelFiles = ["uruk_city.glb", "mesopotamia_wilds.glb"];

export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/urukworld/" : "/",
  define: {
    __URUK_MODEL_BYTES__: JSON.stringify(Object.fromEntries(modelFiles.map((file) => [
      file, statSync(new URL(`./public/models/${file}`, import.meta.url)).size,
    ]))),
  },
}));
