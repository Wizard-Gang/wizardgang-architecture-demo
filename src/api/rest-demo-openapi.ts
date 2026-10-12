export interface RestDemoSchema {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  example?: unknown;
  required?: string[];
  properties?: Record<string, RestDemoSchema>;
  items?: RestDemoSchema;
  additionalProperties?: boolean;
}

export interface RestDemoParameter {
  name: string;
  in: 'path' | 'query';
  required?: boolean;
  description: string;
  schema: RestDemoSchema;
  example?: unknown;
}

export interface RestDemoMediaType {
  schema: RestDemoSchema;
  example?: unknown;
}

export interface RestDemoResponseDefinition {
  description: string;
  content?: Record<string, RestDemoMediaType>;
}

export interface RestDemoOperation {
  tags: string[];
  operationId: string;
  summary: string;
  description: string;
  parameters?: RestDemoParameter[];
  requestBody?: {
    required: boolean;
    description: string;
    content: Record<string, RestDemoMediaType>;
  };
  responses: Record<string, RestDemoResponseDefinition>;
}

export interface RestDemoPathItem {
  parameters?: RestDemoParameter[];
  get?: RestDemoOperation;
  post?: RestDemoOperation;
  put?: RestDemoOperation;
  patch?: RestDemoOperation;
  delete?: RestDemoOperation;
}

export interface RestDemoOpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, RestDemoPathItem>;
  security: Array<Record<string, string[]>>;
  components: {
    securitySchemes: Record<string, { type: 'apiKey'; in: 'cookie'; name: string; description: string }>;
    schemas: Record<string, RestDemoSchema>;
  };
}

const recordExample = {
  id: 1,
  key: 'hello',
  value: { message: 'Hello from a Worker' },
  createdAt: '2026-09-08T12:00:00.000Z',
  updatedAt: '2026-09-08T12:00:00.000Z',
};

const errorExample = {
  error: 'record_not_found',
  detail: 'No record exists for this key.',
};

const jsonResponse = (description: string, schema: RestDemoSchema, example: unknown): RestDemoResponseDefinition => ({
  description,
  content: { 'application/json': { schema, example } },
});

export const restDemoOpenApiDocument: RestDemoOpenApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'WizardGang REST demo',
    version: '1.0.0',
    description: 'Anonymous CRUD records isolated by a signed visitor-session cookie.',
  },
  servers: [{ url: 'https://demo.wizardgang.ai', description: 'Live demo server' }],
  tags: [{ name: 'Records', description: 'Cookie-isolated visitor records' }],
  security: [{ visitorSession: [] }],
  paths: {
    '/api/labs/rest-demo-records': {
      get: {
        tags: ['Records'],
        operationId: 'listRecords',
        summary: 'List records',
        description: 'Return up to 100 records in the current visitor session.',
        responses: {
          '200': jsonResponse('Records returned.', {
            type: 'object',
            required: ['results', 'count'],
            properties: {
              results: { type: 'array', description: 'Records ordered by key.', items: { $ref: '#/components/schemas/Record' } },
              count: { type: 'integer', description: 'Number of returned records.', example: 1 },
            },
          }, { results: [recordExample], count: 1 }),
        },
      },
      post: {
        tags: ['Records'],
        operationId: 'createRecord',
        summary: 'Create a record',
        description: 'Create a record under a unique key in the current visitor session.',
        requestBody: {
          required: true,
          description: 'The key and value for the new record.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RecordInput' },
              example: { key: 'hello', value: { message: 'Hello from a Worker' } },
            },
          },
        },
        responses: {
          '201': jsonResponse('Record created.', { $ref: '#/components/schemas/Record' }, recordExample),
          '400': jsonResponse('Request body or key is invalid.', { $ref: '#/components/schemas/Error' }, { error: 'invalid_key', detail: 'key must be 1–64 letters, numbers, dots, underscores, or hyphens.' }),
          '409': jsonResponse('The key already exists.', { $ref: '#/components/schemas/Error' }, { error: 'record_already_exists', detail: 'POST creates a new resource. Use PUT to replace an existing key.' }),
        },
      },
    },
    '/api/labs/rest-demo-records/{id}': {
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        description: 'The record key.',
        schema: { type: 'string' },
        example: 'hello',
      }],
      get: {
        tags: ['Records'],
        operationId: 'getRecord',
        summary: 'Read a record',
        description: 'Return one record by its key.',
        responses: {
          '200': jsonResponse('Record returned.', { $ref: '#/components/schemas/Record' }, recordExample),
          '404': jsonResponse('Record does not exist.', { $ref: '#/components/schemas/Error' }, errorExample),
        },
      },
      put: {
        tags: ['Records'],
        operationId: 'replaceRecord',
        summary: 'Replace a record',
        description: 'Replace the complete representation at a key, creating the record when it does not exist.',
        requestBody: {
          required: true,
          description: 'The complete replacement representation.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RecordReplacement' },
              example: { value: { message: 'Replaced by a Worker' } },
            },
          },
        },
        responses: {
          '200': jsonResponse('Existing record replaced.', { $ref: '#/components/schemas/Record' }, { ...recordExample, value: { message: 'Replaced by a Worker' } }),
          '201': jsonResponse('Record created.', { $ref: '#/components/schemas/Record' }, { ...recordExample, value: { message: 'Replaced by a Worker' } }),
          '400': jsonResponse('Request body or key is invalid.', { $ref: '#/components/schemas/Error' }, { error: 'invalid_json' }),
        },
      },
      patch: {
        tags: ['Records'],
        operationId: 'updateRecord',
        summary: 'Update a record',
        description: 'Apply the supplied fields without requiring a complete replacement representation.',
        requestBody: {
          required: true,
          description: 'Only the fields that should change.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RecordPatch' },
              example: { value: { message: 'Patched by a Worker', priority: 'high' } },
            },
          },
        },
        responses: {
          '200': jsonResponse('Existing record updated.', { $ref: '#/components/schemas/Record' }, { ...recordExample, value: { message: 'Patched by a Worker', priority: 'high' } }),
          '201': jsonResponse('Record created because the supplied key did not exist.', { $ref: '#/components/schemas/Record' }, { ...recordExample, value: { message: 'Patched by a Worker', priority: 'high' } }),
          '404': jsonResponse('Record does not exist and no value was supplied.', { $ref: '#/components/schemas/Error' }, errorExample),
        },
      },
      delete: {
        tags: ['Records'],
        operationId: 'deleteRecord',
        summary: 'Delete a record',
        description: 'Delete one record by its key. Repeating the request is safe.',
        responses: {
          '204': { description: 'Record deleted. The response has no body.' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      visitorSession: {
        type: 'apiKey',
        in: 'cookie',
        name: 'wg_demo_session',
        description: 'A signed, HttpOnly visitor-session cookie is issued on the first request and sent on later requests. Keep a cookie jar when using curl so create, read, update, and delete use the same isolated session.',
      },
    },
    schemas: {
      Record: {
        type: 'object',
        description: 'A stored visitor-scoped record.',
        required: ['id', 'key', 'value', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'integer', description: 'Database identifier.', example: 1 },
          key: { type: 'string', description: 'Stable resource key.', example: 'hello' },
          value: { type: 'object', description: 'Arbitrary JSON-compatible record value.', additionalProperties: true, example: { message: 'Hello from a Worker' } },
          createdAt: { type: 'string', format: 'date-time', description: 'UTC creation timestamp.', example: '2026-09-08T12:00:00.000Z' },
          updatedAt: { type: 'string', format: 'date-time', description: 'UTC timestamp of the latest change.', example: '2026-09-08T12:02:00.000Z' },
        },
      },
      RecordInput: {
        type: 'object',
        description: 'Representation used to create a record.',
        required: ['key', 'value'],
        properties: {
          key: { type: 'string', description: 'Unique key containing 1–64 letters, numbers, dots, underscores, or hyphens.', example: 'hello' },
          value: { type: 'object', description: 'Arbitrary JSON-compatible record value.', additionalProperties: true, example: { message: 'Hello from a Worker' } },
        },
      },
      RecordReplacement: {
        type: 'object',
        description: 'Complete mutable representation used by PUT.',
        required: ['value'],
        properties: {
          value: { type: 'object', description: 'The complete replacement value.', additionalProperties: true, example: { message: 'Replaced by a Worker' } },
        },
      },
      RecordPatch: {
        type: 'object',
        description: 'Partial mutable representation used by PATCH.',
        properties: {
          value: { type: 'object', description: 'A replacement value supplied only when it should change.', additionalProperties: true, example: { message: 'Patched by a Worker', priority: 'high' } },
        },
      },
      Error: {
        type: 'object',
        description: 'A machine-readable API error.',
        required: ['error'],
        properties: {
          error: { type: 'string', description: 'Stable error code.', example: 'record_not_found' },
          detail: { type: 'string', description: 'Optional human-readable detail.', example: 'No record exists for this key.' },
        },
      },
    },
  },
};
