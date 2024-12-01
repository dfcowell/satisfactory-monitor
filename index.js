require('dotenv').config();
var compose = require('docker-compose');

const servicesToUpdate = (process.env.UPDATE_SERVICES || '').split(',');
const serverService = process.env.SERVER_SERVICE || 'server';
const steamappsPath = process.env.STEAMAPPS_PATH || '/config/gamefiles/steamapps';

const composeUpOptions = {commandOptions: ['--force-recreate']};
const serverAppId = process.env.SERVER_APP_ID || '1690800';

// Satisfactory may use self-signed certificates, so we need to disable certificate validation
const { Agent, setGlobalDispatcher } = require('undici');

const agent = new Agent({
  connect: {
    rejectUnauthorized: false
  }
})

setGlobalDispatcher(agent);

const updateMany = async (services) => {
  console.log(`Updating & restarting services: ${services.join(', ')}`);
  await compose.pullMany(services);

  return compose.upMany(services, composeUpOptions);
};

const updateAll = async () => {
  console.log('Updating & restarting all services');
  await compose.pullAll();

  return compose.upAll(composeUpOptions);
};

const update = async () => {
  const state = await (servicesToUpdate.length > 0 ? updateMany(servicesToUpdate) : updateAll());
};

const restartMany = async (services) => {
  console.log(`Restarting services: ${services.join(', ')}`);

  return compose.upMany(services, composeUpOptions);
}

const restartAll = async () => {
  console.log('Restarting all services');

  return compose.upAll(composeUpOptions);
}

const restart = async () => {
  const state = await (servicesToUpdate.length > 0 ? restartMany(servicesToUpdate) : restartAll());
}

let lastCheckSlow = false;

const healthCheck = async () => {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (process.env.HEADER_HOST) {
    headers.Host = process.env.HEADER_HOST;
  }

  try {
    const status = await fetch(`${process.env.SERVER_URL}/api/v1`, {
      agent,
      headers,
      method: 'POST',
      body: JSON.stringify({
        function: 'HealthCheck',
        data: {
          clientCustomData: ''
        }
      }),
    });

    const json = await status.json();

    switch (json.data.health) {
      case 'healthy':
        console.log('Health check passed');
        lastCheckSlow = false;
        return true;
      case 'slow':
        console.log('Health check slow');
        if (lastCheckSlow) {
          console.log('Too many slow health checks, restarting');
          return false;
        }
        lastCheckSlow = true;
        return true;
      default:
        console.log('Health check failed');
        console.log(json);
        return false;
    }
  } catch (e) {
    console.log('Health check failed');
    console.log(e);
    return false;
  }
};

const needsUpdate = async () => {
  const steamData = await fetch(`https://api.steamcmd.net/v1/info/${serverAppId}`);
  const json = await steamData.json();
  const latestBuildId = parseInt(json.data[serverAppId].depots.branches.public.buildid, 10);
  console.log(`Latest build ID: ${latestBuildId}`);

  const result = await compose.exec(serverService, `cat ${steamappsPath}/appmanifest_${serverAppId}.acf`);
  const currentBuildId = parseInt(result.out.match(/"buildid"\s+"(\d+)"/)[1], 10);
  console.log(`Current build ID: ${currentBuildId}`);

  if (latestBuildId > currentBuildId) {
    console.log('Update needed');
    
    return true;
  }

  console.log('No update needed');

  return false;
}

let run = true;
let timeout;
let resolve;

const wait = async (ms) => new Promise(r => {
  timeout = setTimeout(r, ms);
  resolve = r;
});

process.on('SIGINT', () => {
  run = false;
  clearTimeout(timeout);
  resolve();
});

(async () => {
  while (run) {
    try {
      const healthy = await healthCheck();

      if (!healthy) {
        await restart();
        console.log('Restarted services, waiting for 5 minutes before checking again');
        await wait(process.env.RESTART_INTERVAL || 1000*60*5);
        continue;
      }

      const shouldUpdate = await needsUpdate();

      if (shouldUpdate) {
        await update();
      }
    } catch (e) {
      console.log(e.err);
    }

    await wait(process.env.CHECK_INTERVAL || 1000*60*30);
  }
})();
