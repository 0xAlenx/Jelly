import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { config } from './config.js';
export const pool = new Pool({ connectionString: config.databaseUrl });
export async function migrate() {
    for (const migration of ['001_initial.sql', '002_model_providers.sql', '003_model_failover_priority.sql', '004_single_customer_license.sql']) {
        const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
        await pool.query(sql);
    }
}
export async function query(text, values = []) {
    const result = await pool.query(text, values);
    return result.rows;
}
export async function transaction(run) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await run(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
