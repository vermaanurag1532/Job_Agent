import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

// Database connection pool
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'email_automation',
    user: process.env.DB_USER || 'email_user',
    password: process.env.DB_PASSWORD,
    max: 20, // Maximum number of connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Database connection error:', err);
    process.exit(-1);
});

// Helper function to execute queries
export const query = async (text, params) => {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log('🔍 Executed query', { text, duration, rows: res.rowCount });
        return res;
    } catch (error) {
        console.error('❌ Query error:', error);
        throw error;
    }
};

// Helper function to get a client from pool
export const getClient = async () => {
    return await pool.connect();
};

// Helper function to end pool
export const end = async () => {
    await pool.end();
};

export default pool;