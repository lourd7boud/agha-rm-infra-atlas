/**
 * Create initial Super Admin user for PostgreSQL
 * Run this script to create the first Super Admin account
 * 
 * Usage: node scripts/create-super-admin-pg.js
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'btpdb',
  user: process.env.POSTGRES_USER || 'btpuser',
  password: process.env.POSTGRES_PASSWORD || 'BtpSecure2025!',
});

async function createSuperAdmin() {
  console.log('🚀 Creating Super Admin user...\n');

  const client = await pool.connect();
  
  try {
    // Super Admin credentials
    const email = 'admin@btpmaroc.ma';
    const password = 'Admin@2025'; // Should be changed after first login
    const firstName = 'Super';
    const lastName = 'Admin';

    // Check if user already exists
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      console.log('❌ Super Admin user already exists!');
      console.log(`   Email: ${email}`);
      process.exit(1);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create Super Admin user
    const userId = uuidv4();
    const result = await client.query(
      `INSERT INTO users (id, email, password, first_name, last_name, role, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, created_at`,
      [userId, email, hashedPassword, firstName, lastName, 'super_admin', true]
    );

    console.log('✅ Super Admin created successfully!\n');
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    console.log('👤 Name:', `${firstName} ${lastName}`);
    console.log('🔐 Role: super_admin');
    console.log('\n⚠️  IMPORTANT: Please change the password after first login!\n');
    console.log('User ID:', result.rows[0].id);
    console.log('Created At:', result.rows[0].created_at);

  } catch (error) {
    console.error('❌ Error creating Super Admin:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

createSuperAdmin();
