import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, signal, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ParticleService } from './services/particles.service';
import { LocalConverterService } from './services/local-converter.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: []
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('particleCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  
  // Services
  private particleService = inject(ParticleService);
  private localConverter = inject(LocalConverterService);

  // Signals
  isDragOver = signal(false);
  isProcessing = signal(false);
  progress = signal(0);
  
  uploadedFile = signal<{ name: string; type: string; base64: string } | null>(null);
  convertedContent = signal<string>('');
  
  targetFormat = signal<string>('Markdown');
  // Extended format list
  formats = ['Markdown', 'TXT', 'HTML', 'JSON', 'PDF', 'EPUB'];

  // Computed
  hasResult = computed(() => this.convertedContent().length > 0);
  
  downloadLabel = computed(() => {
    const f = this.targetFormat();
    switch(f) {
      case 'Markdown': return '下载 .MD';
      case 'TXT': return '下载 .TXT';
      case 'HTML': return '下载 .HTML';
      case 'JSON': return '下载 .JSON';
      case 'PDF': return '下载 .PDF';
      case 'EPUB': return '下载 .EPUB';
      default: return '下载文件';
    }
  });

  constructor() {
    effect(() => {
      this.particleService.setProgress(this.progress());
    });
  }

  ngAfterViewInit() {
    this.particleService.init(this.canvasRef.nativeElement);
  }

  ngOnDestroy() {
    this.particleService.destroy();
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
  }

  private handleFile(file: File) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64Raw = e.target?.result as string;
      const base64Data = base64Raw.split(',')[1];
      
      this.uploadedFile.set({
        name: file.name,
        type: file.type,
        base64: base64Data
      });
      
      this.convertedContent.set('');
      this.progress.set(0);
    };
    reader.readAsDataURL(file);
  }

  async startConversion() {
    const file = this.uploadedFile();
    if (!file) return;

    this.isProcessing.set(true);
    this.simulateProgress();

    try {
      // 1. Extract content and get preview text
      // Even for PDF/EPUB targets, this returns the extracted text for the UI preview
      const result = await this.localConverter.convert(
        file,
        this.targetFormat()
      );
      this.convertedContent.set(result);
      this.progress.set(100);
    } catch (error) {
      alert('本地处理出错。');
      console.error(error);
      this.progress.set(0);
    } finally {
      this.isProcessing.set(false);
    }
  }

  simulateProgress() {
    this.progress.set(1);
    const interval = setInterval(() => {
      if (!this.isProcessing()) {
        clearInterval(interval);
        if (this.hasResult()) this.progress.set(100);
        else this.progress.set(0);
        return;
      }
      
      this.progress.update(p => {
        if (p >= 98) return p;
        const inc = Math.max(2, Math.floor(Math.random() * 5));
        return p + inc;
      });
    }, 50);
  }

  async downloadResult() {
    const content = this.convertedContent();
    const format = this.targetFormat();
    const originalName = this.uploadedFile()?.name || 'nebula_doc';
    
    // Generate the specific file type (PDF, EPUB, etc)
    const result = await this.localConverter.generateFile(content, format, originalName);

    const filename = `nebula_output_${Date.now()}.${result.extension}`;
    const url = window.URL.createObjectURL(result.blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  reset() {
    this.uploadedFile.set(null);
    this.convertedContent.set('');
    this.progress.set(0);
    this.isProcessing.set(false);
  }
}