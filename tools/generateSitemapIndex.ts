import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { SITEMAP_SIZE } from '@/constants/misc';
import config from '@/constants/config.json';
dotenv.config();

const SITEMAP_INDEX_PATH = path.join(process.cwd(), 'public', 'sitemap.xml');

async function main() {
  const { default: meilisearchClient } = await import('@/lib/meilisearch');
  let totalPages = 0;
  const stats = await meilisearchClient.index(process.env.MEILI_INDEX || config.index).getStats();
  totalPages = Math.ceil(stats.numberOfDocuments / SITEMAP_SIZE);

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