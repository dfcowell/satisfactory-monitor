require('dotenv').config();
var compose = require('docker-compose');

const servicesToUpdate = (process.env.UPDATE_SERVICES || '').split(',');

const composeUpOptions = {commandOptions: ['--force-recreate']};
const serverAppId = process.env.SERVER_APP_ID || '1690800';

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

  console.log(state);
};

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

    switch (json.data.health === 'healthy') {
      case 'healthy':
        console.log('Health check passed');
        lastCheckSlow = false;
        return true;
      case 'slow':
        console.log('Health check slow');
        lastCheckSlow = true;
        return true;
      default:
        console.log('Health check failed');
        return false;
    }
  } catch (e) {
    console.log('Health check failed');
    console.log(e.message);
    return false;
  }
};

const versionCheck = async () => {
  const steamData = await fetch(`https://api.steamcmd.net/v1/info/${serverAppId}`);
  const json = await steamData.json();
  console.log(`Latest build ID: ${json.data[serverAppId].depots.branches.public.buildid}`);

  const result = await compose.exec(process.env.SERVER_SERVICE, `cat /home/steam/steamapps/appmanifest_${serverAppId}.acf`);
  const currentBuildId = result.stdout.match(/"buildid"\s+"(\d+)"/)[1];
  console.log(`Current build ID: ${currentBuildId}`);
}

(async () => {
  versionCheck();
})();
