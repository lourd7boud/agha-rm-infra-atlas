/**
 * Create initial Super Admin user
 * Run this script to create the first Super Admin account
 * 
 * Usage: node scripts/create-super-admin.js
 */

const nano = require('nano');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const COUCHDB_URL = process.env.COUCHDB_URL || 'http://admin:password@localhost:5984';
const COUCHDB_DB = process.env.COUCHDB_DB_NAME || 'projet_gestion';

async function createSuperAdmin() {
  console.log('🚀 Creating Super Admin user...\n');

  try {
    const client = nano(COUCHDB_URL);
    const db = client.db.use(COUCHDB_DB);

    // Super Admin credentials
    const email = 'admin@agriculture.gov.ma';
    const password = 'Admin@2024'; // Should be changed after first login
    const firstName = 'Super';
    const lastName = 'Admin';

    // Check if user already exists
    try {
      const existingUser = await db.view('users', 'by_email', { key: email });
      if (existingUser.rows.length > 0) {
        console.log('❌ Super Admin user already exists!');
        console.log(`   Email: ${email}`);
        process.exit(1);
      }
    } catch (error) {
      // View might not exist yet, continue
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create Super Admin user
    const user = {
      _id: `user:${uuidv4()}`,
      type: 'user',
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: 'super_admin',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await db.insert(user);

    console.log('✅ Super Admin created successfully!\n');
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    console.log('👤 Name:', `${firstName} ${lastName}`);
    console.log('🔐 Role: super_admin');
    console.log('\n⚠️  IMPORTANT: Please change the password after first login!\n');
    console.log('User ID:', user._id);
    console.log('Revision:', result.rev);

  } catch (error) {
    console.error('❌ Error creating Super Admin:', error);
    process.exit(1);
  }
}

createSuperAdmin();
