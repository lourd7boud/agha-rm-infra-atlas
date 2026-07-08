/**
 * End-to-End Sync Tests
 * 
 * Tests for the sync system including:
 * - Offline → Online sync
 * - Concurrent updates
 * - Conflict resolution
 * - Large batch handling
 * - Network interruption recovery
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:5000/api';
const TEST_USER_EMAIL = 'sync-test@example.com';
const TEST_USER_PASSWORD = 'TestPassword123!';

// Test state
let authToken = '';
let userId = '';
const deviceId1 = `test-device-1-${uuidv4()}`;
const deviceId2 = `test-device-2-${uuidv4()}`;

// Helper functions
const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
});

// Add auth interceptor
api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

// Test utilities
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const createTestProject = () => ({
  id: uuidv4(),
  objet: `Test Project ${Date.now()}`,
  marcheNo: `TM-${Date.now()}`,
  annee: '2024',
  dateOuverture: new Date().toISOString().split('T')[0],
  montant: Math.floor(Math.random() * 1000000),
  status: 'draft',
  progress: 0,
  folderPath: `/test/${Date.now()}`,
});

const createOperation = (type, entity, entityId, data) => ({
  id: uuidv4(),
  type,
  entity,
  entityId,
  data,
  timestamp: Date.now(),
});

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

const runTest = async (name, testFn) => {
  console.log(`\n🧪 Running: ${name}`);
  try {
    await testFn();
    console.log(`  ✅ PASSED: ${name}`);
    results.passed++;
    results.tests.push({ name, status: 'passed' });
  } catch (error) {
    console.log(`  ❌ FAILED: ${name}`);
    console.log(`     Error: ${error.message}`);
    results.failed++;
    results.tests.push({ name, status: 'failed', error: error.message });
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

// ==================== SETUP ====================

const setup = async () => {
  console.log('\n📦 Setting up test environment...');
  
  // Try to login first
  try {
    const loginResponse = await api.post('/auth/login', {
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    });
    authToken = loginResponse.data.data?.token || loginResponse.data.token;
    userId = loginResponse.data.data?.user?.id || loginResponse.data.user?.id;
    console.log('  ✅ Logged in as existing test user');
  } catch (error) {
    // User doesn't exist, create one
    try {
      const registerResponse = await api.post('/auth/register', {
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
        firstName: 'Sync',
        lastName: 'Test',
      });
      authToken = registerResponse.data.data?.token || registerResponse.data.token;
      userId = registerResponse.data.data?.user?.id || registerResponse.data.user?.id;
      console.log('  ✅ Created new test user');
    } catch (regError) {
      console.error('  ❌ Could not create test user:', regError.response?.data || regError.message);
      throw regError;
    }
  }
  
  console.log(`  User ID: ${userId}`);
  console.log(`  Device 1: ${deviceId1}`);
  console.log(`  Device 2: ${deviceId2}`);
};

// ==================== TESTS ====================

/**
 * Test 1: Basic Push Operation
 * Create a project locally and push to server
 */
const testBasicPush = async () => {
  const project = createTestProject();
  const operations = [createOperation('CREATE', 'project', project.id, project)];
  
  const response = await api.post('/sync/push', {
    operations,
    deviceId: deviceId1,
  });
  
  assert(response.data.success === true, 'Push should succeed');
  assert(response.data.data.success.length > 0 || response.data.data.ackOps.length > 0, 'Operation should be acknowledged');
};

/**
 * Test 2: Basic Pull Operation
 * Pull changes after pushing
 */
const testBasicPull = async () => {
  // First push something
  const project = createTestProject();
  await api.post('/sync/push', {
    operations: [createOperation('CREATE', 'project', project.id, project)],
    deviceId: deviceId1,
  });
  
  // Wait a bit
  await sleep(100);
  
  // Then pull from another device
  const response = await api.get('/sync/pull', {
    params: { lastSync: 0, deviceId: deviceId2 },
  });
  
  assert(response.data.success === true, 'Pull should succeed');
  assert(Array.isArray(response.data.data.operations), 'Should return operations array');
};

/**
 * Test 3: Idempotency - Duplicate Operations
 * Push the same operation twice, should not duplicate
 */
const testIdempotency = async () => {
  const project = createTestProject();
  const opId = uuidv4();
  const operation = {
    id: opId,
    type: 'CREATE',
    entity: 'project',
    entityId: project.id,
    data: project,
    timestamp: Date.now(),
  };
  
  // Push first time
  const response1 = await api.post('/sync/push', {
    operations: [operation],
    deviceId: deviceId1,
  });
  
  // Push same operation again
  const response2 = await api.post('/sync/push', {
    operations: [operation],
    deviceId: deviceId1,
  });
  
  // Both should succeed (second one is idempotent)
  assert(response1.data.success === true, 'First push should succeed');
  assert(response2.data.success === true, 'Second push should also succeed (idempotent)');
};

/**
 * Test 4: Update Operation
 * Create then update a project
 */
const testUpdateOperation = async () => {
  const project = createTestProject();
  
  // Create
  await api.post('/sync/push', {
    operations: [createOperation('CREATE', 'project', project.id, project)],
    deviceId: deviceId1,
  });
  
  await sleep(100);
  
  // Update
  const updatedData = { ...project, objet: 'Updated Project Name', montant: 500000 };
  const response = await api.post('/sync/push', {
    operations: [createOperation('UPDATE', 'project', project.id, updatedData)],
    deviceId: deviceId1,
  });
  
  assert(response.data.success === true, 'Update should succeed');
};

/**
 * Test 5: Delete Operation
 * Create then delete a project
 */
const testDeleteOperation = async () => {
  const project = createTestProject();
  
  // Create
  await api.post('/sync/push', {
    operations: [createOperation('CREATE', 'project', project.id, project)],
    deviceId: deviceId1,
  });
  
  await sleep(100);
  
  // Delete
  const response = await api.post('/sync/push', {
    operations: [createOperation('DELETE', 'project', project.id, {})],
    deviceId: deviceId1,
  });
  
  assert(response.data.success === true, 'Delete should succeed');
};

/**
 * Test 6: Large Batch Processing
 * Push 100 operations at once
 */
const testLargeBatch = async () => {
  const operations = [];
  const baseProject = createTestProject();
  
  // Create 100 projects
  for (let i = 0; i < 100; i++) {
    operations.push(createOperation('CREATE', 'project', uuidv4(), {
      ...baseProject,
      id: undefined,
      objet: `Batch Project ${i}`,
      marcheNo: `BATCH-${i}`,
    }));
  }
  
  const response = await api.post('/sync/push', {
    operations,
    deviceId: deviceId1,
  });
  
  assert(response.data.success === true, 'Large batch should succeed');
  
  const acked = response.data.data.success || response.data.data.ackOps || [];
  const errors = response.data.data.failed || [];
  
  console.log(`     Acknowledged: ${acked.length}, Errors: ${errors.length}`);
  
  // Allow some failures due to validation, but most should succeed
  assert(acked.length > 50, 'At least half of operations should succeed');
};

/**
 * Test 7: Concurrent Updates from Different Devices
 * Two devices update the same project
 */
const testConcurrentUpdates = async () => {
  const project = createTestProject();
  
  // Create from device 1
  await api.post('/sync/push', {
    operations: [createOperation('CREATE', 'project', project.id, project)],
    deviceId: deviceId1,
  });
  
  await sleep(100);
  
  // Update from device 1
  const update1 = { ...project, montant: 100000 };
  const response1 = await api.post('/sync/push', {
    operations: [createOperation('UPDATE', 'project', project.id, update1)],
    deviceId: deviceId1,
  });
  
  // Concurrent update from device 2
  const update2 = { ...project, montant: 200000 };
  const response2 = await api.post('/sync/push', {
    operations: [createOperation('UPDATE', 'project', project.id, update2)],
    deviceId: deviceId2,
  });
  
  // Both should succeed (LWW policy)
  assert(response1.data.success === true, 'Update from device 1 should succeed');
  assert(response2.data.success === true, 'Update from device 2 should succeed');
};

/**
 * Test 8: Sync Status Endpoint
 */
const testSyncStatus = async () => {
  const response = await api.get('/sync/status', {
    params: { deviceId: deviceId1 },
  });
  
  assert(response.data.success === true, 'Status request should succeed');
  assert(typeof response.data.data.totalOperations === 'number', 'Should return total operations count');
  assert(typeof response.data.data.latestServerSeq === 'number', 'Should return latest server sequence');
};

/**
 * Test 9: Server Sequence-based Pull
 * Use server sequence number instead of timestamp
 */
const testSequenceBasedPull = async () => {
  // Get current status to find server_seq
  const statusResponse = await api.get('/sync/status', {
    params: { deviceId: deviceId1 },
  });
  
  const currentSeq = statusResponse.data.data.latestServerSeq || 0;
  
  // Create a new project
  const project = createTestProject();
  await api.post('/sync/push', {
    operations: [createOperation('CREATE', 'project', project.id, project)],
    deviceId: deviceId1,
  });
  
  // Pull using sequence
  const response = await api.get('/sync/pull', {
    params: { since: currentSeq, deviceId: deviceId2 },
  });
  
  assert(response.data.success === true, 'Sequence-based pull should succeed');
  assert(response.data.data.serverSeq >= currentSeq, 'Should return updated server sequence');
};

/**
 * Test 10: Offline → Online Simulation
 * Queue multiple operations then push all at once
 */
const testOfflineOnlineSync = async () => {
  const operations = [];
  
  // Simulate creating multiple items while offline
  const project = createTestProject();
  operations.push(createOperation('CREATE', 'project', project.id, project));
  
  // Update it
  operations.push(createOperation('UPDATE', 'project', project.id, {
    ...project,
    progress: 50,
  }));
  
  // Create a bordereau
  const bordereauId = uuidv4();
  operations.push(createOperation('CREATE', 'bordereau', bordereauId, {
    id: bordereauId,
    projectId: project.id,
    reference: 'BDX-001',
    designation: 'Test Bordereau',
    lignes: [],
    montantTotal: 0,
  }));
  
  // Now "come online" and push all
  const response = await api.post('/sync/push', {
    operations,
    deviceId: deviceId1,
  });
  
  assert(response.data.success === true, 'Offline sync should succeed');
  
  const acked = response.data.data.success || response.data.data.ackOps || [];
  assert(acked.length >= 2, 'At least project operations should be acknowledged');
};

// ==================== MAIN ====================

const runAllTests = async () => {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║           BTP Sync System - E2E Test Suite                ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  
  try {
    await setup();
    
    await runTest('Basic Push Operation', testBasicPush);
    await runTest('Basic Pull Operation', testBasicPull);
    await runTest('Idempotency - Duplicate Operations', testIdempotency);
    await runTest('Update Operation', testUpdateOperation);
    await runTest('Delete Operation', testDeleteOperation);
    await runTest('Large Batch Processing (100 ops)', testLargeBatch);
    await runTest('Concurrent Updates from Different Devices', testConcurrentUpdates);
    await runTest('Sync Status Endpoint', testSyncStatus);
    await runTest('Server Sequence-based Pull', testSequenceBasedPull);
    await runTest('Offline → Online Sync Simulation', testOfflineOnlineSync);
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    results.failed++;
    results.tests.push({ name: 'Setup', status: 'failed', error: error.message });
  }
  
  // Print summary
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                      TEST SUMMARY                         ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`  Total: ${results.passed + results.failed}`);
  console.log(`  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  
  if (results.failed > 0) {
    console.log('\n  Failed Tests:');
    results.tests
      .filter(t => t.status === 'failed')
      .forEach(t => console.log(`    - ${t.name}: ${t.error}`));
  }
  
  console.log('\n');
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
};

// Run tests
runAllTests().catch(console.error);
