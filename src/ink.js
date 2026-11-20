import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";

// Opaque ink surfaces write alpha 1. The sky, water, fine foliage and sprite cutouts write
// an exclusion tag in alpha. The final pass restores opaque alpha after reading those tags.
export function excludeFromInk(shaderSource) {
  return shaderSource.replace("#include <opaque_fragment>", "#include <opaque_fragment>\n gl_FragColor.a = 0.25;");
}

export class InkContours extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.needsSwap = false;
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        sceneColor: { value: null },
        sceneDepth: { value: null },
        texel: { value: new THREE.Vector2() },
        inverseFocal: { value: new THREE.Vector2() },
        cameraNear: { value: camera.near },
        cameraFar: { value: camera.far },
        ink: { value: new THREE.Color("#2E1A10") },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0., 1.);
        }
      `,
      fragmentShader: `
        #include <packing>
        varying vec2 vUv;
        uniform sampler2D sceneColor, sceneDepth;
        uniform vec2 texel, inverseFocal;
        uniform float cameraNear, cameraFar;
        uniform vec3 ink;

        float rawAt(vec2 uv) { return texture2D(sceneDepth, uv).r; }
        float metres(float raw) { return -perspectiveDepthToViewZ(raw, cameraNear, cameraFar); }

        vec3 viewRay(vec2 uv) { return vec3((uv * 2. - 1.) * inverseFocal, -1.); }
        vec3 viewNormal(vec3 ray, vec2 stepSize, float r, float sx, float sy) {
          // Reciprocal view depth is affine over a triangle, so the two depth slopes
          // and the view ray give the normal without a second render of the scene.
          float v = (cameraFar / (cameraFar - cameraNear)) - r;
          vec3 normal = vec3(sx / stepSize.x, sy / stepSize.y, 0.);
          normal.z = dot(normal.xy, ray.xy) - v;
          return normalize(normal);
        }
        void main() {
          vec4 color = texture2D(sceneColor, vUv);
          vec3 composed = color.rgb;
          if (color.a > .92) {
            float raw = rawAt(vUv), distance = metres(raw);
            float fade = clamp((80. - distance) / 35., 0., 1.);
            if (fade > 0.) {
              vec2 dx = vec2(texel.x, 0.), dy = vec2(0., texel.y);
              float x0 = rawAt(vUv - dx), x1 = rawAt(vUv + dx);
              float y0 = rawAt(vUv - dy), y1 = rawAt(vUv + dy);
              float sx0 = raw - x0, sx1 = x1 - raw, sy0 = raw - y0, sy1 = y1 - raw;
              vec2 stepSize = 2. * texel * inverseFocal;
              vec3 ray = viewRay(vUv);
              float sx = abs(sx0) < abs(sx1) ? sx0 : sx1;
              float sy = abs(sy0) < abs(sy1) ? sy0 : sy1;
              vec3 n = viewNormal(ray, stepSize, raw, sx, sy);
              float precisionFloor = 2.1e-7;
              float curvatureX = max(0., abs(sx1 - sx0) - precisionFloor);
              float curvatureY = max(0., abs(sy1 - sy0) - precisionFloor);
              vec3 nx = viewNormal(ray, stepSize, raw, abs(sx0) < abs(sx1) ? sx1 : sx0, sy);
              vec3 ny = viewNormal(ray, stepSize, raw, sx, abs(sy0) < abs(sy1) ? sy1 : sy0);
              float normalEdge = max((1. - dot(n, nx)) * step(precisionFloor, curvatureX),
                                     (1. - dot(n, ny)) * step(precisionFloor, curvatureY));
              float residual = max(0., max(sx1 - sx0, sy1 - sy0) - precisionFloor);
              float stepDepth = residual * distance * distance / cameraNear;
              float breakThreshold = max(.042, distance * .0087);
              float foreground = smoothstep(breakThreshold, breakThreshold * 2.6, stepDepth);
              float crease = smoothstep(.24, .76, normalEdge);
              // Favour the nearer side of a discontinuity and suppress lines on near-flat slabs.
              float grazing = smoothstep(.012, .096, abs(dot(n, normalize(ray))));
              float coverage = max(foreground * .61, crease * .43 * grazing);
              composed = mix(composed, ink, coverage * fade);
            }
          }
          gl_FragColor = vec4(composed, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(width, height) {
    this.material.uniforms.texel.value.set(1 / Math.max(1,width), 1 / Math.max(1,height));
  }

  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.sceneColor.value = readBuffer.texture;
    this.material.uniforms.sceneDepth.value = readBuffer.depthTexture;
    const projection = this.camera.projectionMatrix.elements;
    this.material.uniforms.inverseFocal.value.set(1 / projection[0], 1 / projection[5]);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
