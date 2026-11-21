import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import JSZip from 'jszip';

const PORT = 3000;
const ROOT_DIR = process.cwd();

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'dev-dist',
  '.git',
  '.gradle',
  'build',
]);

function appendProjectFiles(zip: JSZip, currentDir: string, relBase = '') {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (relPath === 'android/app/build' || relPath === 'android/.gradle') continue;
      appendProjectFiles(zip, fullPath, relPath);
    } else if (entry.isFile()) {
      // Skip temporary chat reference screenshots to keep zip lean and fast
      if (relPath.startsWith('public/assets/aistudio/Screenshot_')) continue;
      const content = fs.readFileSync(fullPath);
      const isExecutable = entry.name === 'gradlew';
      zip.file(relPath, content, isExecutable ? { unixPermissions: '755' } : undefined);
    }
  }
}

async function startServer() {
  const app = express();

  app.get('/api/download-project-zip', async (_req: Request, res: Response) => {
    try {
      const zip = new JSZip();
      appendProjectFiles(zip, ROOT_DIR);
      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="bang-shiladze-project.zip"');
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to build zip';
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
