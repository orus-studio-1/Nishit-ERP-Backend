import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Tally is opt-in (ENABLE_TALLY=true). A deployment that does not use Tally must not expose any Tally
// endpoint, so every mount of a Tally router has to sit behind the switch.
const index = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');
const mounts = index.split(/\r?\n/).filter((line) => /app\.use\(.*[Tt]ally/.test(line));

describe('Tally is opt-in', () => {
  it('finds the Tally mounts it is meant to guard', () => {
    expect(mounts.length).toBe(4);
  });

  it('mounts every Tally router only when the ENABLE_TALLY switch is on', () => {
    const open = mounts.filter((line) => !/^\s*if \(tallyEnabled\) app\.use\(/.test(line));
    expect(open).toEqual([]);
  });

  it('turns the switch on only for ENABLE_TALLY=true (off by default)', () => {
    expect(index).toMatch(/const tallyEnabled = process\.env\.ENABLE_TALLY === 'true';/);
  });

  it('does not start the Tally cron outside the switch', () => {
    const startsCron = /initTallyJobs\(\)/.test(index);
    if (startsCron) expect(index).toMatch(/if \(tallyEnabled\)[^\n]*\n?[^\n]*initTallyJobs\(\)|if \(tallyEnabled\) \{[\s\S]*?initTallyJobs\(\)/);
  });
});
