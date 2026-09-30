import { describe, it, expect } from 'vitest';
import { parseGumroadCatalogHtml, dedupe, parseProductCsv } from '../src/services/gumroad';

const HTML = `<html><body><div id="app" data-page="{&quot;props&quot;:{&quot;sections&quot;:[{&quot;search_results&quot;:{&quot;products&quot;:[{&quot;id&quot;:&quot;abc&quot;,&quot;permalink&quot;:&quot;test-prod&quot;,&quot;name&quot;:&quot;Test Product&quot;,&quot;url&quot;:&quot;https://zoubire.gumroad.com/l/test-prod?layout=profile&quot;,&quot;thumbnail_url&quot;:&quot;https://img&quot;,&quot;price_cents&quot;:999,&quot;currency_code&quot;:&quot;usd&quot;}]}}]}}"></div></body></html>`;

describe('gumroad catalog parser', () => {
  it('parses Inertia data-page products', () => {
    const products = parseGumroadCatalogHtml(HTML, 'https://zoubire.gumroad.com');
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('Test Product');
    expect(products[0].url).toBe('https://zoubire.gumroad.com/l/test-prod');
    expect(products[0].permalink).toBe('test-prod');
    expect(products[0].priceCents).toBe(999);
  });

  it('returns empty with clear fallback path when no catalog', () => {
    const products = parseGumroadCatalogHtml('<html><body>no products here</body></html>', 'https://zoubire.gumroad.com');
    expect(products).toEqual([]);
  });

  it('dedupes by url/permalink/id', () => {
    const dupes = dedupe([
      { name: 'A', url: 'https://x.com/l/a' },
      { name: 'A', url: 'https://x.com/l/a/' },
      { name: 'A', url: 'https://x.com/l/a?layout=profile' },
    ]);
    expect(dupes).toHaveLength(1);
  });

  it('parses CSV import', () => {
    const products = parseProductCsv('name,url,description\n"My Guide",https://zoubire.gumroad.com/l/g,"A nice guide"');
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('My Guide');
  });

  it('rejects CSV without required columns', () => {
    expect(() => parseProductCsv('foo,bar\n1,2')).toThrow();
  });
});
