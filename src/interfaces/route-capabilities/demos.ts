import { defineInterfaceIdentityCapability, interfaceIdentityRoute } from '../route-capability';

export const demosRouteCapability = defineInterfaceIdentityCapability('demos.surface', [
  interfaceIdentityRoute({
    id: 'demos.index',
    pattern: '/demos',
    methods: ['GET'],
    kind: 'page',
    handler: async (request, { env }) => {
      const { renderDemosWorkbench } = await import('../../demos/demos-workbench');
      return renderDemosWorkbench(request, env);
    },
    title: 'Architecture Demos',
    description: 'One task-oriented destination for the interactive architecture demonstrations.',
    sourceModule: 'src/demos/demos-workbench.tsx',
    sourceExport: 'renderDemosWorkbench',
    tests: [
      'tests/demo-333-react-demos.test.tsx',
      'tests/demos-consolidation.test.ts',
      'tests/router.test.ts',
      'tests/interface.test.ts',
    ],
    page: {
      parent: 'interfaces.frontend.index',
      label: 'Demos',
      summary: 'Execute and inspect the architecture demonstrations from one stable destination.',
      order: 1,
      navigation: 'primary',
      architectureMap: true,
    },
  }),
  interfaceIdentityRoute({
    id: 'demos.presentation',
    pattern: '/api/demos/:demo',
    methods: ['GET'],
    kind: 'api',
    handler: async (request, { env }, params) => {
      const { demoPresentationResponse } = await import('../../demos/demo-presentations');
      return demoPresentationResponse(request, env, params.demo ?? '');
    },
    title: 'Lazy demo presentation fragment',
    description: 'Returns one scoped demonstration presentation for activation inside the consolidated demos page.',
    sourceModule: 'src/demos/demo-presentations.ts',
    sourceExport: 'demoPresentationResponse',
    tests: [
      'tests/demo-334-react-data-demos.test.tsx',
      'tests/demos-consolidation.test.ts',
      'tests/router.test.ts',
    ],
  }),
]);
