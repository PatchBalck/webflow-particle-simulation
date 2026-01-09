import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Base CDN URL for assets
const ASSET_BASE = 'https://cdn.jsdelivr.net/gh/PatchBlack/patchblack-code@main';

// ===== DEVICE DETECTION =====
function isTouchDevice() {
  return (('ontouchstart' in window) ||
          (navigator.maxTouchPoints > 0) ||
          (navigator.msMaxTouchPoints > 0));
}

function shouldRotateBoombox() {
  const isTouch = isTouchDevice();
  const isPortrait = window.innerHeight > window.innerWidth;
  return isTouch && (isPortrait || window.innerWidth <= 768);
}

// ===== CHROMATIC ABERRATION SHADER =====
const ChromaticAberrationShader = {
  uniforms: {
    'tDiffuse': { value: null },
    'amount': { value: 0.002 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    
    void main() {
      vec2 offset = amount * (vUv - 0.5);
      vec4 cr = texture2D(tDiffuse, vUv + offset);
      vec4 cga = texture2D(tDiffuse, vUv);
      vec4 cb = texture2D(tDiffuse, vUv - offset);
      gl_FragColor = vec4(cr.r, cga.g, cb.b, cga.a);
    }
  `
};

// ===== SCENE SETUP =====
const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 0, 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// ===== POST-PROCESSING =====
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const chromaticPass = new ShaderPass(ChromaticAberrationShader);
chromaticPass.uniforms['amount'].value = 0.005;
composer.addPass(chromaticPass);

composer.addPass(new OutputPass());

// ===== HDR ENVIRONMENT =====
const rgbeLoader = new RGBELoader();
rgbeLoader.load(
  `${ASSET_BASE}/assets/textures/royal_esplanade_1k.hdr`,
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
  },
  undefined,
  () => console.warn('HDR texture not found - using fallback lighting')
);

// ===== LIGHTING =====
scene.add(new THREE.AmbientLight(0xb0bbcb, 0.6));

const keyLight = new THREE.DirectionalLight(0xb0bbcb, 5);
keyLight.position.set(5, 8, 5);
keyLight.castShadow = true;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xb0bbcb, 1.5);
rimLight.position.set(-5, 3, -5);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight(0xb0bbcb, 0.5);
fillLight.position.set(0, -3, 5);
scene.add(fillLight);

// ===== AUDIO SETUP =====
const audio = new Audio();
audio.crossOrigin = "anonymous";
audio.src = `${ASSET_BASE}/assets/audio/Boombox-audio.mp3`;
audio.preload = "auto";

let isPlaying = false;

const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const audioSource = audioContext.createMediaElementSource(audio);
const analyser = audioContext.createAnalyser();
analyser.fftSize = 64;

const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);

audioSource.connect(analyser);
analyser.connect(audioContext.destination);

audio.addEventListener("ended", () => {
  isPlaying = false;
  if (tapeAction) tapeAction.paused = true;
  animateButton(playButton, 0);
  updateCursorText();
});

// ===== CANVAS WAVEFORM =====
const canvas = document.createElement('canvas');
canvas.width = 512;
canvas.height = 512;
const ctx = canvas.getContext('2d', { alpha: true });

const canvasTexture = new THREE.CanvasTexture(canvas);
canvasTexture.minFilter = THREE.LinearFilter;
canvasTexture.magFilter = THREE.LinearFilter;

function drawWaveform() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!isPlaying) {
    canvasTexture.needsUpdate = true;
    return;
  }

  analyser.getByteFrequencyData(dataArray);

  const barCount = 28;
  const halfBars = Math.floor(barCount / 2);
  const barWidth = canvas.width / barCount;
  const barSpacing = 3;
  const segmentHeight = 12;
  const segmentGap = 3;

  ctx.shadowBlur = 1;
  ctx.shadowColor = '#ffd441';

  for (let i = 0; i < halfBars; i++) {
    const dataIndex = Math.floor(i * bufferLength / halfBars);
    const value = dataArray[dataIndex] / 255;
    const totalBarHeight = value * canvas.height * 0.85;
    const numSegments = Math.floor(totalBarHeight / (segmentHeight + segmentGap));
    const w = barWidth - barSpacing;

    const centerIndex = barCount / 2;
    const xLeft = (centerIndex - i - 1) * barWidth + barSpacing / 2;
    const xRight = (centerIndex + i) * barWidth + barSpacing / 2;

    for (let j = 0; j < numSegments; j++) {
      const y = canvas.height - (j + 1) * (segmentHeight + segmentGap);
      const intensity = 0.5 + (j / numSegments) * 0.5;

      const r = Math.floor(255 * intensity);
      const g = Math.floor(212 * intensity);
      const b = Math.floor(65 * intensity);

      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(xLeft, y, w, segmentHeight);
      ctx.fillRect(xRight, y, w, segmentHeight);
    }
  }

  ctx.shadowBlur = 0;
  canvasTexture.needsUpdate = true;
}

// ===== ANIMATION MIXER =====
let mixer = null;
let tapeAction = null;
const clock = new THREE.Clock();

// ===== BUTTON REFERENCES =====
let playButton = null;
let pauseButton = null;
const buttonInitialRotations = new Map();

function animateButton(button, targetRotation) {
  if (!button) return;

  const initialRotation = buttonInitialRotations.get(button);
  const targetRad = THREE.MathUtils.degToRad(targetRotation);

  gsap.to(button.rotation, {
    x: initialRotation.x + targetRad,
    duration: 0.3,
    ease: "power2.out"
  });
}

const gsap = {
  to: (target, props) => {
    const start = { x: target.x, y: target.y, z: target.z };
    const duration = props.duration * 1000;
    const startTime = Date.now();

    function animate() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      if (props.x !== undefined) target.x = start.x + (props.x - start.x) * eased;
      if (props.y !== undefined) target.y = start.y + (props.y - start.y) * eased;
      if (props.z !== undefined) target.z = start.z + (props.z - start.z) * eased;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else if (props.onComplete) {
        props.onComplete();
      }
    }
    animate();
  }
};

// ===== BUTTON POSITIONING (UPDATED) =====
function updateButtonPosition() {
  if (!boombox) return;
  
  // Calculate bounding box in world space
  const box = new THREE.Box3().setFromObject(boombox);
  const bottomY = box.min.y;
  const centerX = (box.min.x + box.max.x) / 2;
  const centerZ = (box.min.z + box.max.z) / 2;
  
  // Project to 2D screen space
  const screenPosition = new THREE.Vector3(centerX, bottomY, centerZ);
  screenPosition.project(camera);
  
  const x = (screenPosition.x * 0.5 + 0.5) * window.innerWidth;
  const y = (screenPosition.y * -0.5 + 0.5) * window.innerHeight;
  
  const button = document.getElementById('custom-cursor');
  if (button) {
    // Add some padding below the object (e.g., +40px)
    button.style.left = x + 'px';
    button.style.top = (y + 40) + 'px'; 
    button.style.transform = 'translate(-50%, 0)';
  }
}

// ===== MOUSE TRACKING =====
const mouse = { x: 0, y: 0 };
const targetRotation = { x: 0, y: 0 };
const currentRotation = { x: 0, y: 0 };
const clickMouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

window.addEventListener('mousemove', (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = (event.clientY / window.innerHeight) * 2 - 1;

  // Simple rotation logic based on mouse position
  targetRotation.y = mouse.x * THREE.MathUtils.degToRad(20);
  targetRotation.x = mouse.y * THREE.MathUtils.degToRad(10);
});

// ===== TEXT ANIMATION (UPDATED) =====
function updateCursorText() {
  const customCursor = document.getElementById('custom-cursor');
  const cursorText = document.getElementById('cursor-text');
  
  if (!customCursor || !cursorText) return;
  
  // Always active now
  customCursor.classList.add('active');
  const newText = isPlaying ? 'PAUSE' : 'PLAY';
  animateTextChange(cursorText, newText);
}

function animateTextChange(element, newText) {
  const currentText = element.textContent;
  if (currentText === newText) return;

  element.innerHTML = '';
  const letters = newText.split('');

  letters.forEach((letter, index) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'letter-wrapper';

    const span1 = document.createElement('span');
    span1.className = 'letter';
    span1.textContent = letter;
    wrapper.appendChild(span1);

    const span2 = document.createElement('span');
    span2.className = 'letter';
    span2.textContent = letter;
    wrapper.appendChild(span2);

    element.appendChild(wrapper);

    setTimeout(() => wrapper.classList.add('animate'), index * 50);
  });
}

// ===== LOAD MODEL =====
let boombox = null;

const loader = new GLTFLoader();
loader.load(
  `${ASSET_BASE}/assets/models/Boombox-01.glb`,
  (gltf) => {
    boombox = gltf.scene;

    const box = new THREE.Box3().setFromObject(boombox);
    const center = box.getCenter(new THREE.Vector3());
    boombox.position.sub(center);

    gltf.scene.traverse((child) => {
      if (child.name === 'play-button') {
        playButton = child;
        buttonInitialRotations.set(playButton, {
          x: child.rotation.x,
          y: child.rotation.y,
          z: child.rotation.z
        });
      }
      if (child.name === 'pause-button') {
        pauseButton = child;
        buttonInitialRotations.set(pauseButton, {
          x: child.rotation.x,
          y: child.rotation.y,
          z: child.rotation.z
        });
      }

      if (child.isMesh) {
        if (child.name === 'Speakers_001' || child.name === 'Speakers_002') {
          const originalMaterial = child.material.clone();
          originalMaterial.map = canvasTexture;
          originalMaterial.emissive = new THREE.Color(0xffd441);
          originalMaterial.emissiveMap = canvasTexture;
          originalMaterial.emissiveIntensity = 1.5;
          originalMaterial.transparent = true;

          canvasTexture.center.set(0.5, 0.5);
          canvasTexture.repeat.set(1.5, -1.5);
          canvasTexture.offset.set(0, -0.15);

          child.material = originalMaterial;
          child.material.needsUpdate = true;
        } else {
          if (child.material) {
            child.material.envMapIntensity = 1.5;
            child.material.needsUpdate = true;
          }
        }
      }
    });

    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(boombox);
      tapeAction = mixer.clipAction(gltf.animations[0]);
      tapeAction.loop = THREE.LoopRepeat;
      tapeAction.clampWhenFinished = false;
    }

    scene.add(boombox);
    handleResponsiveness(); // Initial positioning
    
    // Initialize UI state once model is ready
    updateCursorText();
    
    drawWaveform();
    console.log('Boombox loaded successfully!');
  },
  undefined,
  (error) => console.error('Error loading model:', error)
);

// ===== 3D CLICK HANDLER (Optional Fallback) =====
window.addEventListener('click', (event) => {
  if (!boombox) return;
  // Don't interfere if clicking the DOM button
  if (event.target.closest('#custom-cursor')) return;

  clickMouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  clickMouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(clickMouse, camera);
  const intersects = raycaster.intersectObject(boombox, true);

  if (intersects.length > 0) {
    toggleAudio();
  }
});

// ===== BUTTON INITIALIZATION (UPDATED) =====
function initButtonState() {
  const btn = document.getElementById('custom-cursor');
  const cursorText = document.getElementById('cursor-text');
  
  if (btn && cursorText) {
    // Force active state for everyone
    btn.classList.add('active');
    
    // Set initial text
    cursorText.innerHTML = '';
    const letters = 'PLAY'.split('');
    letters.forEach((letter) => {
      const wrapper = document.createElement('span');
      wrapper.className = 'letter-wrapper';
      const span1 = document.createElement('span');
      span1.className = 'letter';
      span1.textContent = letter;
      wrapper.appendChild(span1);
      const span2 = document.createElement('span');
      span2.className = 'letter';
      span2.textContent = letter;
      wrapper.appendChild(span2);
      cursorText.appendChild(wrapper);
    });
    
    // Universal Click Listener
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      // Resume context first (fix for mobile policies)
      if (audioContext.state === "suspended") {
        audioContext.resume().then(() => {
          if (boombox) toggleAudio();
        });
      } else {
        if (boombox) toggleAudio();
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', initButtonState);

// ===== AUDIO TOGGLE =====
function toggleAudio() {
  if (isPlaying) {
    audio.pause();
    if (tapeAction) tapeAction.paused = true;
    if (pauseButton) animateButton(pauseButton, 16);
    isPlaying = false;
  } else {
    // Double check context state
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    audio.play().then(() => {
      if (tapeAction) {
        if (!tapeAction.isRunning()) tapeAction.play();
        tapeAction.paused = false;
      }
      
      // Reset pause button if needed, animate play button
      if (pauseButton && buttonInitialRotations.has(pauseButton)) {
        const currentPauseRotation = pauseButton.rotation.x;
        const initialPauseRotation = buttonInitialRotations.get(pauseButton).x;
        
        if (Math.abs(currentPauseRotation - initialPauseRotation) > 0.1) {
          animateButton(pauseButton, 0);
        } else {
          animateButton(playButton, 16);
        }
      } else {
        animateButton(playButton, 16);
      }
      
      isPlaying = true;
      updateCursorText(); // Update text to 'PAUSE'
    }).catch(err => {
      console.warn("Audio failed to play:", err);
    });
  }
  updateCursorText();
}

// ===== ANIMATION LOOP =====
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  if (mixer && isPlaying) {
    mixer.update(delta);
  }

  drawWaveform();

  if (boombox) {
    // Rotation logic
    currentRotation.x += (targetRotation.x - currentRotation.x) * 0.05;
    currentRotation.y += (targetRotation.y - currentRotation.y) * 0.05;

    boombox.rotation.x = currentRotation.x;
    boombox.rotation.y = currentRotation.y;
    
    // Updates position for ALL devices now
    updateButtonPosition();
  }

  composer.render();
}

animate();

// ===== WINDOW RESIZE / RESPONSIVENESS =====
function handleResponsiveness() {
  if (!boombox) return;
  
  if (shouldRotateBoombox()) {
    boombox.rotation.z = THREE.MathUtils.degToRad(90);
    boombox.scale.set(0.6, 0.6, 0.6);
  } else if (isTouchDevice()) {
    boombox.rotation.z = 0;
    boombox.scale.set(0.8, 0.8, 0.8);
  } else {
    boombox.rotation.z = 0;
    boombox.scale.set(1, 1, 1);
  }

  // Recalculate center
  const box = new THREE.Box3().setFromObject(boombox);
  const center = box.getCenter(new THREE.Vector3());
  boombox.position.sub(center);
  
  updateButtonPosition();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  
  handleResponsiveness();
});

console.log('Boombox experience initialized');
