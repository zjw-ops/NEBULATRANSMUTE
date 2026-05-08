import { Injectable } from '@angular/core';
import JSZip from 'jszip';
import * as pdfjsLibNamespace from 'pdfjs-dist';
import TurndownService from 'turndown';
import { jsPDF } from 'jspdf';

@Injectable({ providedIn: 'root' })
export class LocalConverterService {
  
  private pdfLib: any;

  constructor() {
    try {
      // Resolve the PDF.js library object correctly handling ESM/CJS interop
      const ns = pdfjsLibNamespace as any;
      this.pdfLib = ns.default || ns;

      if (this.pdfLib && this.pdfLib.GlobalWorkerOptions) {
        this.pdfLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      }
    } catch (error) {
      console.error('Failed to initialize PDF.js:', error);
    }
  }
  
  // Extracts text content regardless of input format
  async convert(fileData: { base64: string, type: string, name: string }, targetFormat: string): Promise<string> {
    const binaryString = atob(fileData.base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const arrayBuffer = bytes.buffer;

    let content = '';

    try {
      if (fileData.type === 'application/pdf') {
        content = await this.processPDF(arrayBuffer);
      } else if (fileData.type.includes('epub') || fileData.name.toLowerCase().endsWith('.epub')) {
        content = await this.processEPUB(arrayBuffer, targetFormat); // Extract text from epub
      } else {
        // Fallback for text/md
        content = new TextDecoder('utf-8').decode(bytes);
      }

      // If target is text/html/json, we format it. 
      // If target is PDF/EPUB, we still return the text for the PREVIEW window, 
      // but the actual download generation happens in generateFile().
      return this.formatOutput(content, targetFormat);

    } catch (err: any) {
      console.error('Local Conversion Error:', err);
      return `PROCESSING ERROR: ${err.message || 'Unknown error'}`;
    }
  }

  // Generates the final downloadable file (Binary or Text)
  async generateFile(content: string, format: string, title: string): Promise<{ blob: Blob, extension: string }> {
    const safeTitle = title.replace(/\.[^/.]+$/, ""); // remove extension

    if (format === 'PDF') {
      const doc = new jsPDF();
      
      // Basic text wrapping setup
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;
      const maxLineWidth = pageWidth - (margin * 2);
      
      doc.setFontSize(16);
      doc.text(safeTitle, margin, 20);
      
      doc.setFontSize(11);
      const splitText = doc.splitTextToSize(content, maxLineWidth);
      
      let cursorY = 30;
      
      for(let i=0; i<splitText.length; i++) {
        if(cursorY > pageHeight - margin) {
          doc.addPage();
          cursorY = 20;
        }
        doc.text(splitText[i], margin, cursorY);
        cursorY += 6;
      }
      
      return { blob: doc.output('blob'), extension: 'pdf' };
    }

    if (format === 'EPUB') {
      const blob = await this.createEPUB(safeTitle, content);
      return { blob, extension: 'epub' };
    }

    // Default Text Formats
    let extension = 'txt';
    let mime = 'text/plain';
    
    if (format === 'JSON') { extension = 'json'; mime = 'application/json'; }
    if (format === 'HTML') { extension = 'html'; mime = 'text/html'; }
    if (format === 'Markdown') { extension = 'md'; mime = 'text/markdown'; }

    return { 
      blob: new Blob([content], { type: mime }), 
      extension 
    };
  }

  private async createEPUB(title: string, content: string): Promise<Blob> {
    const zip = new JSZip();
    
    // 1. mimetype (must be first, no compression)
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    
    // 2. META-INF
    zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
   <rootfiles>
      <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
   </rootfiles>
</container>`);

    // 3. Content
    // Clean content for XML
    const cleanContent = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

    zip.file("OEBPS/content.xhtml", `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body>
<h1>${title}</h1>
<div style="white-space: pre-wrap;">${cleanContent}</div>
</body>
</html>`);

    // 4. Manifest (OPF)
    const opfContent = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>${title}</dc:title>
        <dc:language>en</dc:language>
        <dc:identifier id="BookId">urn:uuid:${Date.now()}</dc:identifier>
    </metadata>
    <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
    </manifest>
    <spine toc="ncx">
        <itemref idref="content"/>
    </spine>
</package>`;
    zip.file("OEBPS/content.opf", opfContent);

    // 5. TOC (NCX)
    zip.file("OEBPS/toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head><meta name="dtb:uid" content="urn:uuid:${Date.now()}"/></head>
    <docTitle><text>${title}</text></docTitle>
    <navMap>
        <navPoint id="navPoint-1" playOrder="1">
            <navLabel><text>Start</text></navLabel>
            <content src="content.xhtml"/>
        </navPoint>
    </navMap>
</ncx>`);

    return await zip.generateAsync({ type: "blob" });
  }

  // --- Input Parsers ---

  private async processPDF(data: ArrayBuffer): Promise<string> {
    if (!this.pdfLib || !this.pdfLib.getDocument) {
      throw new Error("PDF.js library not correctly initialized.");
    }

    const loadingTask = this.pdfLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
        
      fullText += `\n\n${pageText}`;
    }
    return fullText;
  }

  private async processEPUB(data: ArrayBuffer, targetFormat: string): Promise<string> {
    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(data);
    const Turndown = (TurndownService as any).default || TurndownService;
    const turndownService = new Turndown();
    
    let combinedText = '';
    const htmlFiles: {name: string, content: string}[] = [];
    
    await Promise.all(
      Object.keys(loadedZip.files).map(async (filename) => {
         if (filename.match(/\.(xhtml|html|htm)$/i) && !filename.startsWith('__') && !filename.includes('nav') && !filename.includes('toc')) {
            const str = await loadedZip.files[filename].async('string');
            htmlFiles.push({ name: filename, content: str });
         }
      })
    );
    htmlFiles.sort((a, b) => a.name.localeCompare(b.name));
    
    const parser = new DOMParser();
    for (const file of htmlFiles) {
      const doc = parser.parseFromString(file.content, 'text/html');
      // For Preview we use Markdown-like structure or plain text
      const md = turndownService.turndown(doc.body.innerHTML);
      combinedText += `\n\n` + md;
    }
    return combinedText || "Error: No text content extracted from EPUB.";
  }

  private formatOutput(text: string, format: string): string {
    if (format === 'JSON') {
      return JSON.stringify({ generatedAt: new Date().toISOString(), content: text }, null, 2);
    }
    // For PDF and EPUB, we return the plain text for the PREVIEW window
    if (format === 'PDF' || format === 'EPUB') {
        return text;
    }
    if (format === 'HTML') {
      return `<div class="converted-content">\n${text.split('\n').map(l => l.trim() ? `<p>${l}</p>` : '').join('')}\n</div>`;
    }
    return text;
  }
}