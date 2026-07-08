const http = require('http');

const data = JSON.stringify({
  email: 'admin@btpmaroc.ma',
  password: 'Admin@2025'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const result = JSON.parse(body);
    if (result.success && result.data && result.data.token) {
      // Now test sync/pull
      const syncOptions = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/sync/pull?lastSync=0&deviceId=test123',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + result.data.token
        }
      };
      
      const syncReq = http.request(syncOptions, syncRes => {
        let syncBody = '';
        syncRes.on('data', chunk => syncBody += chunk);
        syncRes.on('end', () => {
          console.log('SYNC RESULT:');
          console.log(syncBody);
        });
      });
      syncReq.end();
    } else {
      console.log('Login failed:', body);
    }
  });
});

req.write(data);
req.end();
