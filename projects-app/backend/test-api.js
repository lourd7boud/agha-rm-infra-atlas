#!/usr/bin/env node
/**
 * Test Script for WebSocket and Sync API
 * 
 * Tests:
 * 1. Health check
 * 2. Login authentication
 * 3. Sync push operation
 * 4. Sync pull operation
 * 5. WebSocket connection and real-time updates
 */

const fetch = require('node-fetch');
const io = require('socket.io-client');

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_USER = {
  email: 'test@example.com',
  password: 'test123'
};

let authToken = '';
let socket = null;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// Test 1: Health Check
async function testHealthCheck() {
  logInfo('Test 1: Health Check');
  try {
    const response = await fetch(`${BASE_URL}/health`);
    const contentType = response.headers.get('content-type');
    
    if (!contentType || !contentType.includes('application/json')) {
      logError(`Health check returned non-JSON: ${contentType}`);
      return false;
    }
    
    const data = await response.json();
    
    if (data.status === 'OK') {
      logSuccess('Health check passed');
      return true;
    } else {
      logError('Health check failed');
      return false;
    }
  } catch (error) {
    logError(`Health check error: ${error.message}`);
    return false;
  }
}

// Test 2: Login
async function testLogin() {
  logInfo('Test 2: Login Authentication');
  try {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(TEST_USER),
    });
    
    const contentType = response.headers.get('content-type');
    
    if (!contentType || !contentType.includes('application/json')) {
      logError(`Login returned non-JSON: ${contentType}`);
      const text = await response.text();
      logError(`Response: ${text.substring(0, 200)}`);
      return false;
    }
    
    const data = await response.json();
    
    if (data.success && data.data && data.data.token) {
      authToken = data.data.token;
      logSuccess('Login successful');
      return true;
    } else {
      logError(`Login failed: ${data.error?.message || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    logError(`Login error: ${error.message}`);
    return false;
  }
}

// Test 3: Sync Push
async function testSyncPush() {
  logInfo('Test 3: Sync Push');
  
  if (!authToken) {
    logWarning('Skipping sync push test - no auth token');
    return false;
  }
  
  try {
    const testOperation = {
      id: `test-op-${Date.now()}`,
      type: 'CREATE',
      entity: 'project',
      entityId: `test-project-${Date.now()}`,
      data: {
        objet: 'Test Project from API Test',
        marcheNo: 'TEST-001',
        annee: 2024,
      },
      timestamp: Date.now(),
    };
    
    const response = await fetch(`${BASE_URL}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        operations: [testOperation],
        deviceId: 'test-device',
      }),
    });
    
    const contentType = response.headers.get('content-type');
    
    if (!contentType || !contentType.includes('application/json')) {
      logError(`Sync push returned non-JSON: ${contentType}`);
      const text = await response.text();
      logError(`Response: ${text.substring(0, 200)}`);
      return false;
    }
    
    const data = await response.json();
    
    if (data.success) {
      logSuccess(`Sync push successful - ${data.data.ackOps?.length || 0} ops acknowledged`);
      return true;
    } else {
      logError(`Sync push failed: ${data.error?.message || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    logError(`Sync push error: ${error.message}`);
    return false;
  }
}

// Test 4: Sync Pull
async function testSyncPull() {
  logInfo('Test 4: Sync Pull');
  
  if (!authToken) {
    logWarning('Skipping sync pull test - no auth token');
    return false;
  }
  
  try {
    const response = await fetch(`${BASE_URL}/api/sync/pull?since=0&deviceId=test-device`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });
    
    const contentType = response.headers.get('content-type');
    
    if (!contentType || !contentType.includes('application/json')) {
      logError(`Sync pull returned non-JSON: ${contentType}`);
      const text = await response.text();
      logError(`Response: ${text.substring(0, 200)}`);
      return false;
    }
    
    const data = await response.json();
    
    if (data.success) {
      logSuccess(`Sync pull successful - ${data.data.operations?.length || 0} operations received`);
      return true;
    } else {
      logError(`Sync pull failed: ${data.error?.message || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    logError(`Sync pull error: ${error.message}`);
    return false;
  }
}

// Test 5: WebSocket Connection
async function testWebSocket() {
  logInfo('Test 5: WebSocket Connection');
  
  if (!authToken) {
    logWarning('Skipping WebSocket test - no auth token');
    return false;
  }
  
  return new Promise((resolve) => {
    try {
      socket = io(BASE_URL, {
        path: '/socket.io/',
        transports: ['websocket', 'polling'],
        auth: {
          token: authToken,
          deviceId: 'test-device',
        },
      });
      
      const timeout = setTimeout(() => {
        logError('WebSocket connection timeout');
        socket?.disconnect();
        resolve(false);
      }, 10000);
      
      socket.on('connect', () => {
        clearTimeout(timeout);
        logSuccess(`WebSocket connected: ${socket.id}`);
        
        // Test subscribe
        socket.emit('subscribe', ['project', 'bordereau']);
        
        // Wait a bit then disconnect
        setTimeout(() => {
          socket.disconnect();
          resolve(true);
        }, 2000);
      });
      
      socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        logError(`WebSocket connection error: ${error.message}`);
        resolve(false);
      });
      
      socket.on('sync:operation', (data) => {
        logInfo(`Received sync operation: ${data.entity}/${data.entityId}`);
      });
      
    } catch (error) {
      logError(`WebSocket test error: ${error.message}`);
      resolve(false);
    }
  });
}

// Main test runner
async function runTests() {
  console.log('');
  log('========================================', 'blue');
  log('=== BTP SYNC & WEBSOCKET TEST SUITE ===', 'blue');
  log('========================================', 'blue');
  log(`Base URL: ${BASE_URL}`, 'blue');
  console.log('');
  
  const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
  };
  
  // Run tests sequentially
  const tests = [
    { name: 'Health Check', fn: testHealthCheck },
    { name: 'Login', fn: testLogin },
    { name: 'Sync Push', fn: testSyncPush },
    { name: 'Sync Pull', fn: testSyncPull },
    { name: 'WebSocket', fn: testWebSocket },
  ];
  
  for (const test of tests) {
    console.log('');
    const result = await test.fn();
    
    if (result === true) {
      results.passed++;
    } else if (result === false) {
      results.failed++;
    } else {
      results.skipped++;
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Print summary
  console.log('');
  log('========================================', 'blue');
  log('=== TEST SUMMARY ===', 'blue');
  log('========================================', 'blue');
  logSuccess(`Passed: ${results.passed}`);
  logError(`Failed: ${results.failed}`);
  if (results.skipped > 0) {
    logWarning(`Skipped: ${results.skipped}`);
  }
  console.log('');
  
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run the tests
runTests().catch((error) => {
  logError(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
