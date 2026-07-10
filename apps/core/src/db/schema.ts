// Barrel over ./schema/* — each ATLAS module owns its PostgreSQL schema
// (enterprise-architecture §3); one file per pg schema. Every name exported
// here is importable from '../../db/schema' exactly as before the split.
export * from './schema/audit';
export * from './schema/vault';
export * from './schema/tender';
export * from './schema/intel';
export * from './schema/project';
export * from './schema/supply';
export * from './schema/finance';
export * from './schema/watch';
export * from './schema/people';
export * from './schema/comms';
export * from './schema/portal';
export * from './schema/stock';
export * from './schema/sales';
export * from './schema/equipment';
export * from './schema/compta';
export * from './schema/bdc';
