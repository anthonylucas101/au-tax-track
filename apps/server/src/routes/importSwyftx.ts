import { Hono } from 'hono';
import { buildSwyftxPreview, commitSwyftxImport, type InputFile } from '../importers/swyftx.js';

export const importSwyftxRoute = new Hono();

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

importSwyftxRoute.post('/preview', async (c) => {
  const files = await readUploadedFiles(c.req.raw);
  if (files.length === 0) return c.json({ error: 'No files uploaded' }, 400);
  if (files.length > 5) return c.json({ error: 'Too many files (max 5)' }, 400);
  return c.json(buildSwyftxPreview(files));
});

importSwyftxRoute.post('/commit', async (c) => {
  const files = await readUploadedFiles(c.req.raw);
  if (files.length === 0) return c.json({ error: 'No files uploaded' }, 400);
  const previews = buildSwyftxPreview(files);
  const result = commitSwyftxImport(previews);
  return c.json({ result, previews });
});
