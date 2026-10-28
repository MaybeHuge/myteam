import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const app = await createApp();
await app.listen(config.API_PORT, config.API_HOST);
