import { Hono } from 'hono';
import { buildPreview, commitImport, type InputFile } from '../importers/stake.js';

export const importStakeRoute = new Hono();

async function readUploadedFiles(req: Request): Promise<InputFile[]> {
  const form = await req.formData();
  const files: InputFile[] = [];
  for (const value of form.getAll('files')) {
    if (value instanceof File) {
      const buf = Buffer.from(await value.arrayBuffer());
      files.push({ filename: value.name, buffer: buf });
    }
  }
  // Some clients use single-file fields named "file"
  for (const value of form.getAll('file')) {
    if (value instanceof File) {
      const buf = Buffer.from(await value.arrayBuffer());
      files.push({ filename: value.name, buffer: buf });
    }
  }
  return files;
}

importStakeRoute.post('/preview', async (c) => {
  const files = await readUploadedFiles(c.req.raw);
  if (files.length === 0) return c.json({ error: 'No files uploaded (field "files")' }, 400);
  if (files.length > 10) return c.json({ error: 'Too many files (max 10)' }, 400);
  const preview = buildPreview(files);
  return c.json(preview);
});

importStakeRoute.post('/commit', async (c) => {
  const files = await readUploadedFiles(c.req.raw);
  if (files.length === 0) return c.json({ error: 'No files uploaded (field "files")' }, 400);
  const preview = buildPreview(files);
  // We commit even if there are row-level errors - they're already excluded
  // from the trades/dividends/cashTransactions arrays. Caller can inspect errors via /preview first.
  const result = commitImport(preview);
  return c.json({ result, preview });
});