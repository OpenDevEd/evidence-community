import dotenv from 'dotenv';
dotenv.config();
import { promises as fs } from 'fs';
import path from 'path';
import { SITEMAP_SIZE } from '@/constants/misc';
import { and, ne, notInArray, count } from 'drizzle-orm';
import { item } from '@/db/schema/tables/item';
import { EXCLUDED_ITEM_TYPES } from '@/constants/items';

const SITEMAP_INDEX_PATH = path.join(process.cwd(), 'public', 'sitemap.xml');

async function main() {
  const { db } = await import('@/db');
  
  let totalPages = 0;
  const totalItems = await db.select({ count: count() }).from(item).where(and(ne(item.deleted, 1), notInArray(item.itemType, EXCLUDED_ITEM_TYPES as any)));
  totalPages = Math.ceil(totalItems[0].count / SITEMAP_SIZE);

  if (totalPages <= 0) {
    console.error('Could not determine total number of sitemaps');
    process.exit(1);
  }

  const sitemaps = [];
  for (let i = 0; i < totalPages; i++) {
    sitemaps.push(`${process.env.BASE_URL}/sitemap/${i}.xml`);
  }

  const xmlString = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.map((sitemap) => `<sitemap><loc>${sitemap}</loc></sitemap>`).join('\n')}
</sitemapindex>`;

  await fs.writeFile(SITEMAP_INDEX_PATH, xmlString);
  console.log(`Generated sitemap index with ${totalPages} sitemaps`);
}

main();