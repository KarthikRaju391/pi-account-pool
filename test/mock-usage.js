#!/usr/bin/env node
const id = process.argv[2];
const usageById = {
  one: { limits: { allowed: true, short: { used_percent: 80, reset_after_seconds: 300 }, weekly: { used_percent: 20, reset_after_seconds: 1000 } } },
  two: { limits: { allowed: true, short: { used_percent: 10, reset_after_seconds: 300 }, weekly: { used_percent: 10, reset_after_seconds: 1000 } } },
  exhausted: { limits: { allowed: false, short: { used_percent: 100, reset_after_seconds: 60 }, weekly: { used_percent: 10, reset_after_seconds: 1000 }, reason: 'test_limit' } },
};
console.log(JSON.stringify(usageById[id] || usageById.exhausted));
