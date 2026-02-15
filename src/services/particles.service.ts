import { Injectable } from '@angular/core';
import * as THREE from 'three';

@Injectable({
  providedIn: 'root'
})
export class ParticleService {
  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  
  private particlesMesh: THREE.Points | null = null;
  private animationFrameId: number = 0;
  
  // State
  private progress: number = 0;
  private mouseX: number = 0;
  private mouseY: number = 0;
  
  // Settings
  private readonly particleCount = 4500;
  
  // Physics for smooth transition
  private currentRotationSpeed = 0.001;
  private targetRotationSpeed = 0.001;
  
  // --- Performance Optimizations ---
  private resizeTimeout: any = null;
  private readonly MAX_WIDTH = 1920;  // Max render width
  private readonly MAX_HEIGHT = 1080; // Max render height
  private readonly debouncedOnResize = () => {
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => this.onResize(), 150);
  };
  
  // Throttling for mouse movement to reduce GPU load
  private lastMouseMoveTime = 0;
  private readonly MOUSE_MOVE_THROTTLE_MS = 16; // ~60 updates per second max

  // FPS Limiter Logic
  private fps = 60;
  private fpsInterval = 1000 / this.fps;
  private then = 0;

  init(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    
    // 1. Setup Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true, 
      antialias: true,
      powerPreference: 'high-performance'
    });
    // PERFORMANCE: Cap pixel ratio for high DPI displays
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    // 2. Setup Scene
    this.scene = new THREE.Scene();
    
    // 3. Setup Camera (aspect ratio will be set by onResize)
    this.camera = new THREE.PerspectiveCamera(
      60, 
      window.innerWidth / window.innerHeight, 
      0.1, 
      1000
    );
    this.camera.position.z = 400;
    this.camera.position.y = 100;
    this.camera.lookAt(0, 0, 0);

    // 4. Create Particles
    this.createGalaxySystem();

    // 5. Listeners
    // PERFORMANCE: Use a debounced resize handler
    window.addEventListener('resize', this.debouncedOnResize);
    window.addEventListener('mousemove', this.onMouseMove.bind(this));

    // Set initial size correctly using the capped resolution logic
    this.onResize();

    // 6. Start Loop
    this.then = Date.now(); // Initialize timer
    this.animate();
  }

  setProgress(p: number) {
    this.progress = p;
  }

  private getTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    
    const context = canvas.getContext('2d');
    if (!context) return new THREE.Texture();

    const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  private createGalaxySystem() {
    if (!this.scene) return;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    const colors = new Float32Array(this.particleCount * 3);
    const sizes = new Float32Array(this.particleCount);

    const colorInside = new THREE.Color(0xffbf00);
    const colorOutside = new THREE.Color(0xffffff);

    for (let i = 0; i < this.particleCount; i++) {
      const radius = Math.random() * 200; 
      const spinAngle = radius * 0.05;
      const branchAngle = (i % 3) * ((2 * Math.PI) / 3);

      const randomX = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 30;
      const randomY = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 30;
      const randomZ = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 30;

      const x = Math.cos(branchAngle + spinAngle) * radius + randomX;
      const y = (Math.random() - 0.5) * (radius * 0.2) + randomY;
      const z = Math.sin(branchAngle + spinAngle) * radius + randomZ;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const mixedColor = colorInside.clone().lerp(colorOutside, radius / 200);
      colors[i * 3] = mixedColor.r;
      colors[i * 3 + 1] = mixedColor.g;
      colors[i * 3 + 2] = mixedColor.b;

      sizes[i] = Math.random() * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 5,
      vertexColors: true,
      map: this.getTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true
    });

    this.particlesMesh = new THREE.Points(geometry, material);
    this.scene.add(this.particlesMesh);
  }

  private onResize() {
    if (!this.camera || !this.renderer) return;

    // PERFORMANCE: Cap the resolution to 1080p
    const newWidth = Math.min(window.innerWidth, this.MAX_WIDTH);
    const newHeight = Math.min(window.innerHeight, this.MAX_HEIGHT);

    this.camera.aspect = newWidth / newHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(newWidth, newHeight);
  }

  private onMouseMove(event: MouseEvent) {
    // PERFORMANCE: Throttle mouse move updates to avoid spiking GPU.
    const now = performance.now();
    if (now - this.lastMouseMoveTime < this.MOUSE_MOVE_THROTTLE_MS) {
      return;
    }
    this.lastMouseMoveTime = now;

    this.mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  private animate() {
    this.animationFrameId = requestAnimationFrame(this.animate.bind(this));

    // PERFORMANCE: FPS Limiter logic (Cap at 60 FPS)
    const now = Date.now();
    const elapsed = now - this.then;

    if (elapsed > this.fpsInterval) {
      // Get ready for next frame by setting then=now, but also adjust for your 
      // specified fpsInterval not being a multiple of RAF's interval (16.7ms)
      this.then = now - (elapsed % this.fpsInterval);

      // --- RENDER LOGIC START ---
      if (!this.scene || !this.camera || !this.renderer || !this.particlesMesh) return;

      const isProcessing = this.progress > 0 && this.progress < 100;
      const targetSpeed = isProcessing ? 0.05 : 0.001; 
      this.currentRotationSpeed += (targetSpeed - this.currentRotationSpeed) * 0.05;

      this.particlesMesh.rotation.y += this.currentRotationSpeed;

      const targetTiltX = this.mouseY * 0.2;
      const targetTiltZ = this.mouseX * 0.1;
      this.particlesMesh.rotation.x += (targetTiltX - this.particlesMesh.rotation.x) * 0.05;
      this.particlesMesh.rotation.z += (targetTiltZ - this.particlesMesh.rotation.z) * 0.05;

      const time = Date.now() * 0.0005;
      this.camera.position.y = 100 + Math.sin(time) * 10;
      this.camera.lookAt(0, 0, 0);

      this.renderer.render(this.scene, this.camera);
      // --- RENDER LOGIC END ---
    }
  }

  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    // Clean up debounced listener
    window.removeEventListener('resize', this.debouncedOnResize);
    clearTimeout(this.resizeTimeout);

    window.removeEventListener('mousemove', this.onMouseMove);
    
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}