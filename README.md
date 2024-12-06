# Satisfactory Monitor

This is a monitoring script for the Satisfactory dedicated server running in Docker. It checks the health and game version of the server periodically and updates or restarts services as needed. It can also be used to restart the server at a specified time each day.

The monitoring script is designed to work out-of-the-box with minimal configuration targeting the wolveix/satisfactory-server Docker image. See the `docker-compose.yml` file for an example of how to use it with that container. All you need to do to get started with a monitored server on your local machine is clone this repo and run `docker compose up`.

The script should work with other Satisfactory server container images, however you may need to change some of the default configuration.

## Configuration

The monitor can be configured using the following environment variables:

- `SERVER_URL`: The URL of the server to check health, including protocol and port. Defaults to 'satisfactory-server:7777'.
- `MANAGE_SERVICES`: A comma-separated list of services to update or restart when the game is out of date or the connection is unhealthy. If not set, all services will be updated/restarted, including this monitor service.
- `SERVER_SERVICE`: The name of the service running the game server. Defaults to 'server'.
- `STEAMAPPS_PATH`: The path to the SteamApps directory in the server container. Defaults to '/config/gamefiles/steamapps'.
- `DOCKER_COMPOSE_FILE`: The name of the Docker Compose file to use. Defaults to 'docker-compose.yml'.
- `DOCKER_COMPOSE_PATH`: The path to the Docker Compose file. Your Compose file **must** be mounted in the monitor container at the same absolute path as it is on the host in order for volume mounts to be resolved correctly when updating or restarting services.
- `SERVER_APP_ID`: The Steam App ID of the game server. Defaults to '1690800'.
- `HEADER_HOST`: The value of the Host header to send with the health check request. If not set, the Host header will not be sent. This is useful for reverse proxies that require the Host header to be set, and can be used if you do not have public DNS records for your server.
- `RESTART_SCHEDULE`: A time in HH:MM format to schedule a daily restart of the server. If not set, the server will not be restarted unless it is unhealthy or out of date.
- `RESTART_INTERVAL`: The interval in milliseconds to wait after restarting the server before checking health again. Defaults to 5 minutes.
- `CHECK_INTERVAL`: The interval in milliseconds to wait between health checks. Defaults to 30 minutes.

## License

This project is licensed under the MIT License.