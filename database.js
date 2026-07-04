import fs from 'fs/promises';
import path from 'path';

const dbPath = path.join(process.cwd(), 'database.json');
let db = null;

const readData = async () => {
  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { users: {} };
  }
};

const writeData = async (data) => {
  await fs.writeFile(dbPath, JSON.stringify(data, null, 2));
};

export const initDb = async () => {
  if (db) return db;

  const data = await readData();
  if (!data.users.user_1) {
    data.users.user_1 = { id: 'user_1', credits: 0 };
    await writeData(data);
  }

  db = {
    async get(query, params) {
      if (query.includes('FROM users WHERE id = ?')) {
        const current = await readData();
        return current.users[params[0]] || null;
      }
      return null;
    },

    async run(query, params) {
      const current = await readData();

      if (query.startsWith('INSERT INTO users')) {
        const [id, credits] = params;
        current.users[id] = { id, credits };
        await writeData(current);
        return;
      }

      if (query.startsWith('UPDATE users SET credits = credits + ?')) {
        const [credits, id] = params;
        const user = current.users[id] || { id, credits: 0 };
        user.credits += Number(credits);
        current.users[id] = user;
        await writeData(current);
        return;
      }

      if (query.startsWith('UPDATE users SET credits = credits - 1')) {
        const [id] = params;
        const user = current.users[id] || { id, credits: 0 };
        user.credits = Math.max(0, user.credits - 1);
        current.users[id] = user;
        await writeData(current);
      }
    },
  };

  return db;
};

export const getDb = () => {
  if (!db) throw new Error('Database not initialized');
  return db;
};