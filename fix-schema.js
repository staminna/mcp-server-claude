#!/usr/bin/env node
import 'dotenv/config';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://apidev.romanceinroom.com';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

async function directusAPI(endpoint, options = {}) {
  const url = `${DIRECTUS_URL}${endpoint}`;
  console.log(`Making request to: ${endpoint}`);
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  const responseText = await response.text();
  console.log(`Response (${response.status}):`, responseText.substring(0, 200));

  if (!response.ok) {
    throw new Error(`API error: ${response.status} - ${responseText}`);
  }

  return JSON.parse(responseText);
}

async function main() {
  console.log('🔧 Fixing Directus Schema Issues...\n');

  try {
    // Step 1: Check if products_categories junction table exists and has proper fields
    console.log('\n1. Checking products_categories junction table...');
    try {
      const junctionData = await directusAPI('/items/products_categories?limit=1');
      console.log('   ✅ Junction table accessible');
    } catch (error) {
      console.log(`   ❌ Junction table issue: ${error.message}`);
    }

    // Step 2: Try to fix by creating proper junction table structure
    console.log('\n2. Attempting to create proper many-to-many structure...');
    
    // First, try to create the junction table if it doesn't exist
    try {
      await directusAPI('/collections', {
        method: 'POST',
        body: JSON.stringify({
          collection: 'products_categories',
          meta: {
            hidden: true,
            icon: 'import_export',
            note: 'Junction table for products-categories many-to-many relationship'
          }
        })
      });
      console.log('   ✅ Junction table created');
    } catch (error) {
      console.log('   ℹ️  Junction table already exists or creation failed');
    }

    // Create products_id field in junction table
    try {
      await directusAPI('/fields/products_categories', {
        method: 'POST',
        body: JSON.stringify({
          field: 'products_id',
          type: 'integer',
          meta: {
            interface: 'select-dropdown-m2o',
            special: ['m2o'],
            required: true,
            hidden: false
          },
          schema: {
            is_nullable: false
          }
        })
      });
      console.log('   ✅ products_id field created in junction table');
    } catch (error) {
      console.log(`   ℹ️  products_id field: ${error.message.substring(0, 100)}`);
    }

    // Create categories_id field in junction table  
    try {
      await directusAPI('/fields/products_categories', {
        method: 'POST',
        body: JSON.stringify({
          field: 'categories_id',
          type: 'integer',
          meta: {
            interface: 'select-dropdown-m2o',
            special: ['m2o'],
            required: true,
            hidden: false
          },
          schema: {
            is_nullable: false
          }
        })
      });
      console.log('   ✅ categories_id field created in junction table');
    } catch (error) {
      console.log(`   ℹ️  categories_id field: ${error.message.substring(0, 100)}`);
    }

    // Step 3: Create the fields in the main collections FIRST
    console.log('\n3. Creating fields in main collections...');
    
    // Create categories field in products collection
    try {
      await directusAPI('/fields/products', {
        method: 'POST',
        body: JSON.stringify({
          field: 'categories',
          type: 'alias',
          meta: {
            interface: 'list-m2m',
            special: ['m2m'],
            required: false,
            hidden: false
          }
        })
      });
      console.log('   ✅ categories field created in products collection');
    } catch (error) {
      console.log(`   ℹ️  categories field in products: ${error.message.substring(0, 100)}`);
    }

    // Create products field in categories collection
    try {
      await directusAPI('/fields/categories', {
        method: 'POST',
        body: JSON.stringify({
          field: 'products',
          type: 'alias',
          meta: {
            interface: 'list-m2m',
            special: ['m2m'],
            required: false,
            hidden: false
          }
        })
      });
      console.log('   ✅ products field created in categories collection');
    } catch (error) {
      console.log(`   ℹ️  products field in categories: ${error.message.substring(0, 100)}`);
    }

    // Step 4: Create the actual many-to-many relationships
    console.log('\n4. Creating many-to-many relationships...');
    
    // Products -> Categories relation
    try {
      await directusAPI('/relations', {
        method: 'POST',
        body: JSON.stringify({
          collection: 'products',
          field: 'categories',
          related_collection: 'categories',
          meta: {
            one_field: 'products',
            junction_field: 'categories_id',
            sort_field: null,
            one_deselect_action: 'delete'
          },
          schema: {
            table: 'products_categories',
            column: 'products_id',
            foreign_key_table: 'products',
            foreign_key_column: 'id',
            constraint_name: null,
            on_update: 'NO ACTION',
            on_delete: 'CASCADE'
          }
        })
      });
      console.log('   ✅ products.categories M2M relation created');
    } catch (error) {
      console.log(`   ℹ️  products.categories: ${error.message.substring(0, 100)}`);
    }

    // Categories -> Products relation (reverse)
    try {
      await directusAPI('/relations', {
        method: 'POST',
        body: JSON.stringify({
          collection: 'categories',
          field: 'products',
          related_collection: 'products',
          meta: {
            one_field: 'categories',
            junction_field: 'products_id',
            sort_field: null,
            one_deselect_action: 'delete'
          },
          schema: {
            table: 'products_categories',
            column: 'categories_id',
            foreign_key_table: 'categories',
            foreign_key_column: 'id',
            constraint_name: null,
            on_update: 'NO ACTION',
            on_delete: 'CASCADE'
          }
        })
      });
      console.log('   ✅ categories.products M2M relation created');
    } catch (error) {
      console.log(`   ℹ️  categories.products: ${error.message.substring(0, 100)}`);
    }

    // Step 5: Test the fix
    console.log('\n5. Testing products query after fix...');
    try {
      const result = await directusAPI('/items/products?limit=1');
      console.log('   ✅ Products query working correctly!');
      console.log('   🎉 Schema fix successful!');
    } catch (error) {
      console.log(`   ❌ Products query still failing: ${error.message}`);
      console.log('\n   Manual fix needed - check Directus admin panel');
    }

    // Step 6: Add other important relationships
    console.log('\n6. Creating other key relationships...');
    
    const otherRelations = [
      { collection: 'products', field: 'brand_id', related: 'brands' },
      { collection: 'orders', field: 'customer_id', related: 'customers' },
      { collection: 'order_items', field: 'order_id', related: 'orders' },
      { collection: 'order_items', field: 'product_id', related: 'products' }
    ];

    for (const rel of otherRelations) {
      try {
        await directusAPI('/relations', {
          method: 'POST',
          body: JSON.stringify({
            collection: rel.collection,
            field: rel.field,
            related_collection: rel.related,
            meta: {
              one_field: null,
              sort_field: null,
              one_deselect_action: 'nullify'
            }
          })
        });
        console.log(`   ✅ ${rel.collection}.${rel.field} -> ${rel.related}`);
      } catch (error) {
        console.log(`   ℹ️  ${rel.collection}.${rel.field}: already exists or failed`);
      }
    }

  } catch (error) {
    console.error(`\n❌ Fix failed: ${error.message}`);
  }

  console.log('\n📋 Summary:');
  console.log('- Check your Directus admin panel');
  console.log('- Test creating products and linking them to categories');
  console.log('- If issues persist, you may need to manually fix in the UI');
}

main();
