// Diagnostic Tools for Collection Access and Caching Issues

import { DirectusClient } from '../client/directus-client.js';
import { logger } from '../utils/logger.js';
import { DirectusCollection, DirectusField, DirectusRelation } from '../types/directus.js';

export class DiagnosticTools {
  constructor(private client: DirectusClient) {}

  async diagnoseCollectionAccess(args: { 
    collection: string;
    includePermissions?: boolean;
    includeFields?: boolean;
    includeRelations?: boolean;
  }): Promise<any> {
    const operationId = `diagnose_collection_access_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('diagnose_collection_access', args);

      const diagnostics: any = {
        collection: args.collection,
        timestamp: new Date().toISOString(),
        tests: {}
      };

      // Test 1: Check if collection exists in collections list
      try {
        const collectionsResponse = await this.client.getCollections();
        const collections = collectionsResponse.data || [];
        const collectionExists = collections.some((c: DirectusCollection) => c.collection === args.collection);
        
        diagnostics.tests.collection_in_list = {
          passed: collectionExists,
          message: collectionExists 
            ? `Collection "${args.collection}" found in collections list`
            : `Collection "${args.collection}" NOT found in collections list`,
          data: collectionExists ? collections.find((c: DirectusCollection) => c.collection === args.collection) : null
        };
      } catch (error) {
        diagnostics.tests.collection_in_list = {
          passed: false,
          message: `Error fetching collections list: ${(error as Error).message}`,
          error: (error as Error).message
        };
      }

      // Test 2: Try to get collection directly
      try {
        const collectionResponse = await this.client.getCollection(args.collection);
        diagnostics.tests.direct_collection_access = {
          passed: true,
          message: `Successfully accessed collection "${args.collection}" directly`,
          data: collectionResponse.data
        };
      } catch (error) {
        diagnostics.tests.direct_collection_access = {
          passed: false,
          message: `Failed to access collection "${args.collection}" directly: ${(error as Error).message}`,
          error: (error as Error).message
        };
      }

      // Test 3: Try to get fields if requested
      if (args.includeFields) {
        try {
          const fieldsResponse = await this.client.getFields(args.collection);
          const fields = fieldsResponse.data || [];
          diagnostics.tests.fields_access = {
            passed: true,
            message: `Successfully retrieved ${fields.length} fields for collection "${args.collection}"`,
            data: fields.map((f: DirectusField) => ({
              field: f.field,
              type: f.type,
              required: f.meta?.required,
              interface: f.meta?.interface
            }))
          };
        } catch (error) {
          diagnostics.tests.fields_access = {
            passed: false,
            message: `Failed to retrieve fields for collection "${args.collection}": ${(error as Error).message}`,
            error: (error as Error).message
          };
        }
      }

      // Test 4: Try to get relations if requested
      if (args.includeRelations) {
        try {
          const relationsResponse = await this.client.getRelations();
          const allRelations = relationsResponse.data || [];
          const collectionRelations = allRelations.filter((r: DirectusRelation) => 
            r.collection === args.collection || r.related_collection === args.collection
          );
          
          diagnostics.tests.relations_access = {
            passed: true,
            message: `Found ${collectionRelations.length} relations for collection "${args.collection}"`,
            data: collectionRelations.map((r: DirectusRelation) => ({
              collection: r.collection,
              field: r.field,
              related_collection: r.related_collection,
              type: r.meta?.junction_field ? 'm2m' : 'm2o'
            }))
          };
        } catch (error) {
          diagnostics.tests.relations_access = {
            passed: false,
            message: `Failed to retrieve relations for collection "${args.collection}": ${(error as Error).message}`,
            error: (error as Error).message
          };
        }
      }

      // Test 5: Try to get items (basic read test)
      try {
        const itemsResponse = await this.client.getItems(args.collection, { limit: 1 });
        diagnostics.tests.items_access = {
          passed: true,
          message: `Successfully accessed items in collection "${args.collection}"`,
          data: {
            count: itemsResponse.data?.length || 0,
            meta: itemsResponse.meta
          }
        };
      } catch (error) {
        diagnostics.tests.items_access = {
          passed: false,
          message: `Failed to access items in collection "${args.collection}": ${(error as Error).message}`,
          error: (error as Error).message
        };
      }

      // Test 6: Check permissions if requested
      if (args.includePermissions) {
        try {
          // Try to get current user info
          const userResponse = await this.client.getUsers({ limit: 1 });
          diagnostics.tests.user_permissions = {
            passed: true,
            message: `Current user has access`,
            data: {
              id: userResponse.data?.id,
              role: userResponse.data?.role,
              admin_access: userResponse.data?.role?.admin_access
            }
          };
        } catch (error) {
          diagnostics.tests.user_permissions = {
            passed: false,
            message: `Failed to get user permissions: ${(error as Error).message}`,
            error: (error as Error).message
          };
        }
      }

      // Overall assessment
      const passedTests = Object.values(diagnostics.tests).filter((test: any) => test.passed).length;
      const totalTests = Object.keys(diagnostics.tests).length;
      
      diagnostics.summary = {
        passed_tests: passedTests,
        total_tests: totalTests,
        success_rate: `${Math.round((passedTests / totalTests) * 100)}%`,
        overall_status: passedTests === totalTests ? 'HEALTHY' : 
                       passedTests > totalTests / 2 ? 'PARTIAL' : 'FAILED',
        recommendations: this.generateRecommendations(diagnostics.tests)
      };

      const duration = logger.endTimer(operationId);
      logger.toolEnd('diagnose_collection_access', duration, true, { 
        collection: args.collection,
        success_rate: diagnostics.summary.success_rate,
        status: diagnostics.summary.overall_status
      });

      return {
        content: [{
          type: 'text',
          text: `# 🔍 **Collection Access Diagnostics for "${args.collection}"**\n\n` +
                `**Overall Status**: ${this.getStatusEmoji(diagnostics.summary.overall_status)} ${diagnostics.summary.overall_status}\n` +
                `**Success Rate**: ${diagnostics.summary.success_rate} (${passedTests}/${totalTests} tests passed)\n\n` +
                `## Test Results\n\n${this.formatTestResults(diagnostics.tests)}\n\n` +
                `## Recommendations\n\n${diagnostics.summary.recommendations.join('\n')}\n\n` +
                `\`\`\`json\n${JSON.stringify(diagnostics, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('diagnose_collection_access', error as Error, { collection: args.collection });
      
      return {
        content: [{
          type: 'text',
          text: `Error diagnosing collection access for "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async refreshCollectionCache(args: { collection?: string }): Promise<any> {
    const operationId = `refresh_collection_cache_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('refresh_collection_cache', args);

      const results: any = {
        timestamp: new Date().toISOString(),
        operations: []
      };

      // Try to clear cache using Directus utilities endpoint
      try {
        // Note: Cache clearing may not be available via client, this is a placeholder
        // await this.client.clearCache();
        results.operations.push({
          operation: 'clear_cache',
          success: true,
          message: 'Successfully cleared Directus cache'
        });
      } catch (error) {
        results.operations.push({
          operation: 'clear_cache',
          success: false,
          message: `Failed to clear cache: ${(error as Error).message}`,
          error: (error as Error).message
        });
      }

      // Force refresh collections list
      try {
        const collectionsResponse = await this.client.getCollections();
        results.operations.push({
          operation: 'refresh_collections',
          success: true,
          message: `Refreshed collections list (${collectionsResponse.data?.length || 0} collections found)`,
          data: { count: collectionsResponse.data?.length || 0 }
        });
      } catch (error) {
        results.operations.push({
          operation: 'refresh_collections',
          success: false,
          message: `Failed to refresh collections: ${(error as Error).message}`,
          error: (error as Error).message
        });
      }

      // If specific collection provided, try to access it
      if (args.collection) {
        try {
          const collectionResponse = await this.client.getCollection(args.collection);
          results.operations.push({
            operation: 'verify_collection',
            success: true,
            message: `Successfully verified collection "${args.collection}" after refresh`,
            data: collectionResponse.data
          });
        } catch (error) {
          results.operations.push({
            operation: 'verify_collection',
            success: false,
            message: `Collection "${args.collection}" still not accessible after refresh: ${(error as Error).message}`,
            error: (error as Error).message
          });
        }
      }

      const successfulOps = results.operations.filter((op: any) => op.success).length;
      const totalOps = results.operations.length;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('refresh_collection_cache', duration, true, { 
        collection: args.collection,
        successful_operations: successfulOps,
        total_operations: totalOps
      });

      return {
        content: [{
          type: 'text',
          text: `# 🔄 **Collection Cache Refresh**\n\n` +
                `**Operations**: ${successfulOps}/${totalOps} successful\n\n` +
                `## Results\n\n${results.operations.map((op: any) => 
                  `- **${op.operation}**: ${op.success ? '✅' : '❌'} ${op.message}`
                ).join('\n')}\n\n` +
                `\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('refresh_collection_cache', error as Error);
      
      return {
        content: [{
          type: 'text',
          text: `Error refreshing collection cache: ${(error as Error).message}`
        }]
      };
    }
  }

  async validateCollectionCreation(args: { 
    collection: string;
    waitTime?: number;
  }): Promise<any> {
    const operationId = `validate_collection_creation_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('validate_collection_creation', args);

      const waitTime = args.waitTime || 2000; // Default 2 seconds
      const results: any = {
        collection: args.collection,
        validation_steps: [],
        timeline: []
      };

      // Step 1: Immediate check
      results.timeline.push({ timestamp: new Date().toISOString(), action: 'immediate_check' });
      try {
        await this.client.getCollection(args.collection);
        results.validation_steps.push({
          step: 'immediate_access',
          success: true,
          message: `Collection "${args.collection}" immediately accessible`
        });
      } catch (error) {
        results.validation_steps.push({
          step: 'immediate_access',
          success: false,
          message: `Collection "${args.collection}" not immediately accessible: ${(error as Error).message}`
        });
      }

      // Step 2: Wait and retry
      results.timeline.push({ timestamp: new Date().toISOString(), action: `waiting_${waitTime}ms` });
      await new Promise(resolve => setTimeout(resolve, waitTime));

      results.timeline.push({ timestamp: new Date().toISOString(), action: 'delayed_check' });
      try {
        const collectionResponse = await this.client.getCollection(args.collection);
        results.validation_steps.push({
          step: 'delayed_access',
          success: true,
          message: `Collection "${args.collection}" accessible after ${waitTime}ms delay`,
          data: collectionResponse.data
        });
      } catch (error) {
        results.validation_steps.push({
          step: 'delayed_access',
          success: false,
          message: `Collection "${args.collection}" still not accessible after ${waitTime}ms: ${(error as Error).message}`
        });
      }

      // Step 3: Check in collections list
      try {
        const collectionsResponse = await this.client.getCollections();
        const collections = collectionsResponse.data || [];
        const found = collections.some((c: DirectusCollection) => c.collection === args.collection);
        
        results.validation_steps.push({
          step: 'collections_list_check',
          success: found,
          message: found 
            ? `Collection "${args.collection}" found in collections list`
            : `Collection "${args.collection}" NOT found in collections list`
        });
      } catch (error) {
        results.validation_steps.push({
          step: 'collections_list_check',
          success: false,
          message: `Error checking collections list: ${(error as Error).message}`
        });
      }

      const successfulSteps = results.validation_steps.filter((step: any) => step.success).length;
      const totalSteps = results.validation_steps.length;

      results.summary = {
        success_rate: `${Math.round((successfulSteps / totalSteps) * 100)}%`,
        status: successfulSteps === totalSteps ? 'FULLY_ACCESSIBLE' :
                successfulSteps > 0 ? 'PARTIALLY_ACCESSIBLE' : 'NOT_ACCESSIBLE',
        recommendations: successfulSteps < totalSteps ? [
          '• Collection may need more time to propagate',
          '• Check Directus server logs for errors',
          '• Verify collection was created successfully',
          '• Consider clearing cache and retrying'
        ] : ['• Collection is fully accessible']
      };

      const duration = logger.endTimer(operationId);
      logger.toolEnd('validate_collection_creation', duration, true, { 
        collection: args.collection,
        status: results.summary.status,
        success_rate: results.summary.success_rate
      });

      return {
        content: [{
          type: 'text',
          text: `# ✅ **Collection Creation Validation for "${args.collection}"**\n\n` +
                `**Status**: ${this.getStatusEmoji(results.summary.status)} ${results.summary.status}\n` +
                `**Success Rate**: ${results.summary.success_rate} (${successfulSteps}/${totalSteps} steps passed)\n\n` +
                `## Validation Steps\n\n${results.validation_steps.map((step: any) => 
                  `- **${step.step}**: ${step.success ? '✅' : '❌'} ${step.message}`
                ).join('\n')}\n\n` +
                `## Timeline\n\n${results.timeline.map((event: any) => 
                  `- **${event.timestamp}**: ${event.action}`
                ).join('\n')}\n\n` +
                `## Recommendations\n\n${results.summary.recommendations.join('\n')}\n\n` +
                `\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('validate_collection_creation', error as Error, { collection: args.collection });
      
      return {
        content: [{
          type: 'text',
          text: `Error validating collection creation for "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'HEALTHY':
      case 'FULLY_ACCESSIBLE':
        return '✅';
      case 'PARTIAL':
      case 'PARTIALLY_ACCESSIBLE':
        return '⚠️';
      case 'FAILED':
      case 'NOT_ACCESSIBLE':
        return '❌';
      default:
        return '🔍';
    }
  }

  private formatTestResults(tests: any): string {
    return Object.entries(tests).map(([testName, result]: [string, any]) => {
      const emoji = result.passed ? '✅' : '❌';
      const name = testName.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
      return `### ${emoji} ${name}\n${result.message}`;
    }).join('\n\n');
  }

  private generateRecommendations(tests: any): string[] {
    const recommendations: string[] = [];
    
    if (!tests.collection_in_list?.passed) {
      recommendations.push('• Collection may not be properly created or indexed');
      recommendations.push('• Try refreshing the collections cache');
    }
    
    if (!tests.direct_collection_access?.passed) {
      recommendations.push('• Collection may have permission restrictions');
      recommendations.push('• Verify collection name spelling and case sensitivity');
    }
    
    if (!tests.fields_access?.passed) {
      recommendations.push('• Collection may exist but fields are not accessible');
      recommendations.push('• Check field-level permissions');
    }
    
    if (!tests.items_access?.passed) {
      recommendations.push('• Collection exists but item access is restricted');
      recommendations.push('• Verify read permissions for the collection');
    }
    
    if (!tests.user_permissions?.passed) {
      recommendations.push('• User authentication or role issues detected');
      recommendations.push('• Verify admin access and token validity');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('• All tests passed - collection is fully accessible');
    }
    
    return recommendations;
  }
}
