import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { writeDatasetsToDisk } from './dataset-authoring.js';

const rootDir = fileURLToPath(new URL('../../../../', import.meta.url));
console.log(`Writing Phase 6 retrieval dataset to ${rootDir}datasets/retrieval/...`);
writeDatasetsToDisk(rootDir);
console.log('Successfully wrote 12 cases, 12 gold sidecars, and manifest.json.');
