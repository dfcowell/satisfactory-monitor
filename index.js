require('dotenv').config();
var compose = require('docker-compose');

/*
 * Configuration
 *
 * The monitor is configured using environment variables. Where possible, sensible
 * defaults are provided. These defaults are designed to work together with the
 * wolveix/satisfactory-server Docker image. Other Satisfactory server images may
 * require different configuration.
 *
 * The following environment variables can be set to configure the monitor:
 * - SERVER_URL:          The URL of the server to check health, including protocol and
 *                        port. Defaults to 'satisfactory-server:7777'.
 * - MANAGE_SERVICES:     A comma-separated list of services to update or restart
 *                        when the game is out of date or the connection is unhealthy.
 *                        If not set, all services will be updated/restarted, including
 *                        this monitor service.
 * - SERVER_SERVICE:      The name of the service running the game server. Defaults to
 *                        'server'.
 * - STEAMAPPS_PATH:      The path to the SteamApps directory in the server container.
 *                        Defaults to '/config/gamefiles/steamapps'.
 * - DOCKER_COMPOSE_FILE: The name of the Docker Compose file to use. Defaults to
 *                        'docker-compose.yml'.
 * - DOCKER_COMPOSE_PATH: The path to the Docker Compose file. Your Compose file **must** be
 *                        mounted in the monitor container at the same absolute path as it is
 *                        on the host in order for volume mounts to be resolved correctly when
 *                        updating or restarting services.
 * - SERVER_APP_ID:       The Steam App ID of the game server. Defaults to '1690800'.
 * - HEADER_HOST:         The value of the Host header to send with the health check
 *                        request. If not set, the Host header will not be sent. This
 *                        is useful for reverse proxies that require the Host header to
 *                        be set, and can be used if you do not have public DNS records
 *                        for your server.
 * - RESTART_SCHEDULE:    A time in HH:MM format to schedule a daily restart of the
 *                        server. If not set, the server will not be restarted unless it
 *                        is unhealthy or out of date.
 * - RESTART_INTERVAL:    The interval in milliseconds to wait after restarting the server
 *                        before checking health again. Defaults to 5 minutes.
 * - CHECK_INTERVAL:      The interval in milliseconds to wait between health checks. Defaults
 *                        to 30 minutes.
 */
const serverUrl = process.env.SERVER_URL || 'https://satisfactory-server:7777';
const servicesToUpdate = (process.env.MANAGE_SERVICES || '').split(',');
const serverService = process.env.SERVER_SERVICE || 'server';
const steamappsPath = process.env.STEAMAPPS_PATH || '/config/gamefiles/steamapps';

const composeOptions = {
  config: process.env.DOCKER_COMPOSE_FILE || 'docker-compose.yml',
  cwd: process.env.DOCKER_COMPOSE_PATH || '.'
};
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

/*
 * Helpers to update and restart services
 */

const updateMany = async (services) => {
  console.log(`Updating & restarting services: ${services.join(', ')}`);
  await compose.pullMany(services, composeOptions);

  return compose.upMany(services, {...composeOptions, ...composeUpOptions });
};

const updateAll = async () => {
  console.log('Updating & restarting all services');
  await compose.pullAll();

  return compose.upAll({...composeOptions, ...composeUpOptions });
};

const update = async () => {
  const state = await (servicesToUpdate.length > 0 ? updateMany(servicesToUpdate) : updateAll());
};

const restartMany = async (services) => {
  console.log(`Restarting services: ${services.join(', ')}`);

  return compose.restartMany(services, composeOptions);
}

const restartAll = async () => {
  console.log('Restarting all services');

  return compose.restartAll(composeOptions);
}

const restart = async () => {
  const state = await (servicesToUpdate.length > 0 ? restartMany(servicesToUpdate) : restartAll());
}

/*
 * Health check
 * 
 * Check if the server is healthy by sending a request to the
 * server's health check endpoint.
 * 
 * If the server is slow, it will wait for two consecutive slow
 * checks before considering the server unhealthy. If the server is
 * reporting unhealthy, it will restart the system and wait for the
 * restart interval before checking again. If the server is healthy,
 * it will wait for the check interval before checking again.
 */

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
    const status = await fetch(`${serverUrl}/api/v1`, {
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

/*
 * Update check
 *
 * Check if the server needs an update by comparing the latest build ID in
 * the running container to the latest build ID from the SteamCmd API
 */

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

/*
 * Scheduled restart
 *
 * Set the RESTART_SCHEDULE environment variable to a time in HH:MM format
 * to schedule a daily restart regardless of server health
 */

let restartTimeout;

if (process.env.RESTART_SCHEDULE) {
  const [hour, minute] = process.env.RESTART_SCHEDULE.split(':');

  const scheduleRestart = () => {
    const restartAt = new Date();
    restartAt.setHours(hour);
    restartAt.setMinutes(minute);
    restartAt.setSeconds(0);

    const now = new Date();

    if (restartAt < now) {
      restartAt.setDate(restartAt.getDate() + 1);
    }

    const timeUntilRestart = restartAt - now;

    console.log(`Scheduled restart at ${restartAt}, waiting ${timeUntilRestart}ms`);

    restartTimeout = setTimeout(async () => {
      await restart();
      scheduleRestart();
    }, timeUntilRestart);
  };

  scheduleRestart();
}

/*
 * Main loop
 */

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
  if (restartTimeout) {
    clearTimeout(restartTimeout);
  }
  resolve();
});

(async () => {
  console.log('Monitor started, waiting for 5 minutes before starting checks');

  await wait(1000 * 60 * 5);
  
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
