#!/usr/bin/env node
import 'dotenv/config';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://apidev.romanceinroom.com';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

async function directusAPI(endpoint) {
  const response = await fetch(`${DIRECTUS_URL}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${DIRECTUS_TOKEN}` }
  });
  return response.json();
}

async function checkSchema() {
  console.log('📋 Directus Schema Diagnostic\n');

  // Check collections
  try {
    const collections = await directusAPI('/collections');
    console.log('✅ Collections accessible');
    const userCollections = collections.data.filter(c => !c.collection.startsWith('directus_'));
    console.log('User Collections:');
    userCollections.forEach(c => console.log(`  • ${c.collection}: ${c.meta?.note || 'No description'}`));
  } catch (error) {
    console.log('❌ Collections error:', error.message);
  }

  // Check relations
  try {
    const relations = await directusAPI('/relations');
    console.log('\n✅ Relations accessible');
    if (relations.data.length > 0) {
      console.log('Current Relations:');
      relations.data.forEach(r => {
        if (!r.collection.startsWith('directus_')) {
          console.log(`  • ${r.collection}.${r.field} -> ${r.related_collection}`);
        }
      });
    } else {
      console.log('  No relations found');
    }
  } catch (error) {
    console.log('❌ Relations error:', error.message);
  }

  // Test products query
  try {
    const products = await directusAPI('/items/products?limit=1');
    console.log('\n✅ Products query working');
    console.log(`  Found ${products.data?.length || 0} products`);
  } catch (error) {
    console.log('\n❌ Products query failed:', error.message);
  }

  // Check junction table
  try {
    const junction = await directusAPI('/items/products_categories?limit=1');
    console.log('✅ Junction table accessible');
    console.log(`  Found ${junction.data?.length || 0} junction records`);
  } catch (error) {
    console.log('❌ Junction table error:', error.message);
  }

  // Check fields for key collections
  const collections = ['products', 'categories', 'products_categories'];
  for (const collection of collections) {
    try {
      const fields = await directusAPI(`/fields/${collection}`);
      console.log(`\n✅ ${collection} fields:`);
      fields.data.forEach(f => console.log(`  • ${f.field} (${f.type})`));
    } catch (error) {
      console.log(`\n❌ ${collection} fields error:`, error.message);
    }
  }
}

checkSchema().catch(console.error);
