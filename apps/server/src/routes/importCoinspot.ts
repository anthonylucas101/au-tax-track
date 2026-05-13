import { Hono } from 'hono';
import { buildCoinspotPreview, commitCoinspotImport, type InputFile } from '../importers/coinspot.js';

export const importCoinspotRoute = new Hono();

async function readUploadedFiles(req: Request): Promise<InputFile[]> {
  const form = await req.formData();
  const files: InputFile[] = [];
  for (const field of ['files', 'file']) {
    for (const value of form.getAll(field)) {
      if (value instanceof File) {
        files.push({ filename: value.name, buffer: Buffer.from(await value.arrayBuffer()) });
      }
    }
  }
  return files;
}

importCoinspotRoute.post('/preview', async (c) => {
  const files = await readUploadedFiles(c.req.raw);
  if (files.length === 0) return c.json({ error: 'No files uploaded' }, 400);
  if (files.length > 5) return c.json({ error: 'Too many files (max 5)' }, 400);
  return c.json(buildCoinspotPreview(files));
});

importCoinspotRoute.post('/commit', async (c) => {
  const files = await readUploadedFiles(c.req.raw);
  if (files.length === 0) return c.json({ error: 'No files uploaded' }, 400);
  const previews = buildCoinspotPreview(files);
  const result = commitCoinspotImport(previews);
  return c.json({ result, previews });
});
