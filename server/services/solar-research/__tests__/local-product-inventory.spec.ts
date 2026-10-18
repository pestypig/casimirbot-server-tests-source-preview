import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { inspectLocalSolarProducts, resolveLocalSolarResearchRoot } from '../local-product-inventory';
import { solarLocalProductInventorySchema } from '../../../../shared/solar-local-product-inventory';

describe('bounded local solar inventory', () => {
  it('checks actual source files without promoting them to a science result', async () => {
    const inventory = solarLocalProductInventorySchema.parse({ ...await inspectLocalSolarProducts(process.cwd()), workspaceRootLocated: true });
    const byId = Object.fromEntries(inventory.products.map(product => [product.id, product]));
    expect(inventory.localFilesOnly).toBe(true);
    expect(inventory.scientificAdmission).toBe(false);
    expect(inventory.scienceRunAllowed).toBe(false);
    expect(byId['g1.author.cdif'].state).toBe('frozen_hash_matched');
    expect(byId['g1.author.avker.bp04'].state).toBe('frozen_hash_matched');
    expect(byId['mesa.solar_reference.parser_fixture'].state).toBe('frozen_hash_matched');
    expect(byId['mesa.solar_reference.parser_fixture'].maturity).toBe('test_fixture');
    expect(byId['starsim.solar_product_registry'].state).toBe('present_unfrozen');
    expect(inventory.products.every(product => !product.scientificAdmission && !product.scienceRunAllowed)).toBe(true);
  });
  it('resolves only the ancestor checkout of a packaged private candidate', async () => {
    expect(await resolveLocalSolarResearchRoot(process.cwd())).toBe(process.cwd());
    expect(await resolveLocalSolarResearchRoot(path.join(process.cwd(), 'server/services/solar-research/__tests__')))
      .toBe(process.cwd());
  });
});
