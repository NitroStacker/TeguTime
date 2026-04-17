import { createDb } from '@tegutime/db';
import { config } from './config';

// Single DB instance per process. Imported by everything that needs to read or write.
export const db = createDb(config.databasePath);
