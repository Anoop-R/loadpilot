// MongoDB is no longer used — NeDB handles all persistence.
// This file is kept to avoid breaking any imports that haven't been updated yet.

export async function connectMongo() { return null; }
export function isMongoConfigured() { return false; }
