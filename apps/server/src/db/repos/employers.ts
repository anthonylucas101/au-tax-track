import { db } from '../index.js';

export interface Employer {
  id: number;
  name: string;
  abn: string | null;
  created_at: string;
}

const listStmt = db.prepare<[], Employer>(
  `SELECT id, name, abn, created_at FROM employers ORDER BY name ASC`,
);

const insertStmt = db.prepare(
  `INSERT INTO employers (name, abn) VALUES (?, ?)`,
);

const findByIdStmt = db.prepare<[number], Employer>(
  `SELECT id, name, abn, created_at FROM employers WHERE id = ?`,
);

const deleteStmt = db.prepare(`DELETE FROM employers WHERE id = ?`);

export const employersRepo = {
  list(): Employer[] {
    return listStmt.all();
  },
  findById(id: number): Employer | undefined {
    return findByIdStmt.get(id);
  },
  create(input: { name: string; abn: string | null }): Employer {
    const result = insertStmt.run(input.name, input.abn);
    const id = Number(result.lastInsertRowid);
    const row = findByIdStmt.get(id);
    if (!row) throw new Error('Insert succeeded but row not found');
    return row;
  },
  delete(id: number): boolean {
    const info = deleteStmt.run(id);
    return info.changes > 0;
  },
};
