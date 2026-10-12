import type { ReactNode } from 'react';
import {
  restDemoOpenApiDocument as spec,
  type RestDemoMediaType,
  type RestDemoOperation,
  type RestDemoParameter,
  type RestDemoResponseDefinition,
  type RestDemoSchema,
} from '../api/rest-demo-openapi';
import type { LocalizationContext } from '../i18n/runtime';
import { localizationForEnv } from '../i18n/runtime';
import { routeUrl } from '../routing/application-routes';
import type { Env } from '../types';
import { browserAssetName } from '../ui/asset-map';
import type { DemoSection, DemoSectionOptions } from '../ui/demo-section';
import { DemoHeading, useDemoPresentationScope } from '../ui/demo-presentation-scope';
import { createReactDemoSection } from '../ui/react-demo-section';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface RenderedOperation {
  method: Uppercase<(typeof HTTP_METHODS)[number]>;
  path: string;
  operation: RestDemoOperation;
  parameters: RestDemoParameter[];
}

function operationsFromDocument(): RenderedOperation[] {
  return Object.entries(spec.paths).flatMap(([path, pathItem]) => HTTP_METHODS.flatMap((method) => {
    const operation = pathItem[method];
    return operation ? [{
      method: method.toUpperCase() as RenderedOperation['method'],
      path,
      operation,
      parameters: [...(pathItem.parameters || []), ...(operation.parameters || [])],
    }] : [];
  }));
}

function referenceName(schema?: RestDemoSchema): string {
  if (!schema) return '—';
  if (schema.$ref) return schema.$ref.split('/').pop() || schema.$ref;
  if (schema.type === 'array') return `array<${referenceName(schema.items)}>`;
  return schema.format ? `${schema.type || 'value'} (${schema.format})` : schema.type || 'object';
}

function firstMediaType(content?: Record<string, RestDemoMediaType>): [string, RestDemoMediaType] | undefined {
  return content ? Object.entries(content)[0] : undefined;
}

function exampleText(example: unknown): string {
  return JSON.stringify(example, null, 2);
}

function Path({ value }: Readonly<{ value: string }>): ReactNode {
  return <code className="rest-path" dir="ltr">{value.split('/').map((segment, index) =>
    index === 0 ? segment : <span key={index}>/{segment}<wbr /></span>)}</code>;
}

function restBrowserMessages(localization: LocalizationContext): Readonly<Record<string, string>> {
  const exact = (english: string) => localization.exact(english);
  return Object.freeze({
    copied: exact('Copied'),
    copy: exact('Copy'),
    invalidJson: exact('Body could not be parsed as JSON.'),
    requestNotSent: exact('Request not sent'),
    sending: exact('Sending…'),
    waitingForResponse: exact('Waiting for response…'),
    noContent: exact('(no content)'),
    noHeaders: exact('(no headers)'),
    requestFailed: exact('Request failed'),
  });
}

function Parameters({ parameters, localization }: Readonly<{ parameters: RestDemoParameter[]; localization: LocalizationContext }>): ReactNode {
  const exact = (english: string) => localization.exact(english);
  if (!parameters.length) return <p className="subtle">{exact('No parameters.')}</p>;
  return <dl className="rest-definition-list">{parameters.map((parameter) => <div key={`${parameter.in}:${parameter.name}`}>
    <dt><code dir="ltr">{parameter.name}</code> <span>{parameter.in} · {exact(parameter.required ? 'required' : 'optional')}</span></dt>
    <dd><code dir="ltr">{referenceName(parameter.schema)}</code> · {exact(parameter.description)}
      {parameter.example !== undefined ? <span className="rest-example-inline"> {exact('Example')}: <code dir="ltr">{String(parameter.example)}</code></span> : null}
    </dd>
  </div>)}</dl>;
}

function RequestBody({ operation, localization }: Readonly<{ operation: RestDemoOperation; localization: LocalizationContext }>): ReactNode {
  const exact = (english: string) => localization.exact(english);
  const body = operation.requestBody;
  if (!body) return null;
  return <section className="rest-document-block">
    <DemoHeading level={4}>{exact('Request body')}</DemoHeading>
    <p>{exact(body.description)} {body.required ? <strong>{exact('required')}</strong> : null}</p>
    {Object.entries(body.content).map(([contentType, media]) => <div key={contentType}>
      <p><code dir="ltr">{contentType}</code> · <code dir="ltr">{referenceName(media.schema)}</code></p>
      {media.example !== undefined ? <><strong>{exact('Example')}</strong><pre dir="ltr">{exampleText(media.example)}</pre></> : null}
    </div>)}
  </section>;
}

function Responses({ responses, localization }: Readonly<{ responses: Record<string, RestDemoResponseDefinition>; localization: LocalizationContext }>): ReactNode {
  const exact = (english: string) => localization.exact(english);
  return <div className="rest-declared-responses">{Object.entries(responses).map(([status, response]) => <section className="rest-declared-response" key={status}>
    <div className="rest-response-title"><strong><code dir="ltr">{status}</code></strong><span>{exact(response.description)}</span></div>
    {Object.entries(response.content || {}).map(([contentType, media]) => <div key={contentType}>
      <p><code dir="ltr">{contentType}</code> · <code dir="ltr">{referenceName(media.schema)}</code></p>
      {media.example !== undefined ? <><strong>{exact('Example')}</strong><pre dir="ltr">{exampleText(media.example)}</pre></> : null}
    </div>)}
  </section>)}</div>;
}

function RequestFields({ rendered, localization }: Readonly<{ rendered: RenderedOperation; localization: LocalizationContext }>): ReactNode {
  const exact = (english: string) => localization.exact(english);
  const scope = useDemoPresentationScope();
  const media = firstMediaType(rendered.operation.requestBody?.content);
  return <div className="openapi-inputs">
    {rendered.parameters.map((parameter) => {
      const id = scope.id(`rest-demo-${rendered.operation.operationId}-${parameter.name}`);
      return <label htmlFor={id} key={`${parameter.in}:${parameter.name}`}>
        {parameter.name} <span className="parameter-meta">{parameter.in} · {exact(parameter.required ? 'required' : 'optional')} · {referenceName(parameter.schema)}</span>
        <input id={id} data-rest-parameter={parameter.name} data-rest-parameter-in={parameter.in} defaultValue={String(parameter.example ?? parameter.schema.example ?? '')} required={parameter.required} autoComplete="off" dir="ltr" />
      </label>;
    })}
    {media ? <label className="openapi-body" htmlFor={scope.id(`rest-demo-${rendered.operation.operationId}-body`)}>
      {exact('Request body')} <span className="parameter-meta">{media[0]} · {referenceName(media[1].schema)}</span>
      <textarea id={scope.id(`rest-demo-${rendered.operation.operationId}-body`)} data-rest-body="" spellCheck="false" required={rendered.operation.requestBody?.required} defaultValue={media[1].example === undefined ? '' : exampleText(media[1].example)} dir="ltr" />
    </label> : null}
  </div>;
}

function Operation({ rendered, localization }: Readonly<{ rendered: RenderedOperation; localization: LocalizationContext }>): ReactNode {
  const exact = (english: string) => localization.exact(english);
  const scope = useDemoPresentationScope();
  const { method, path, operation, parameters } = rendered;
  const id = (suffix: string) => scope.id(`rest-demo-${operation.operationId}-${suffix}`);
  return <details className="rest-operation" data-method={method} data-rest-operation-panel={operation.operationId} id={id('panel')}>
    <summary data-rest-operation-select={operation.operationId}>
      <span className={`http-method http-${method.toLowerCase()}`}>{method}</span>
      <Path value={path} />
      <strong>{exact(operation.summary)}</strong>
    </summary>
    <div className="rest-operation-content">
      <p>{exact(operation.description)}</p>
      <section className="rest-document-block" aria-labelledby={id('parameters-heading')}>
        <DemoHeading level={3} id={id('parameters-heading')}>{exact('Parameters')}</DemoHeading>
        <Parameters parameters={parameters} localization={localization} />
      </section>
      <RequestBody operation={operation} localization={localization} />
      <section className="rest-document-block" aria-labelledby={id('responses-heading')}>
        <DemoHeading level={3} id={id('responses-heading')}>{exact('Responses')}</DemoHeading>
        <Responses responses={operation.responses} localization={localization} />
      </section>
      <section className="rest-document-block rest-try" aria-labelledby={id('try-heading')}>
        <DemoHeading level={3} id={id('try-heading')}>{exact('Try it out')}</DemoHeading>
        <form data-rest-form="" data-method={method} data-path={path}>
          <RequestFields rendered={rendered} localization={localization} />
          <button className="button-primary" type="submit" data-rest-execute="">{exact('Execute')}</button>
        </form>
        <div data-rest-result="" aria-live="polite">
          <p className="subtle" data-rest-response-empty="">{exact('Execute this operation to inspect the actual response.')}</p>
          <dl className="rest-execution-evidence" data-rest-response-details="" hidden>
            <dt>{exact('Request URL')}</dt><dd><code data-rest-request-url="" dir="ltr" /></dd>
            <dt>{exact('Curl command')}</dt><dd><pre data-rest-curl="" dir="ltr" /></dd>
            <dt>{exact('Request')}</dt><dd><pre data-rest-request="" dir="ltr" /></dd>
            <dt>{exact('Status')}</dt><dd><strong data-rest-status="" dir="ltr" /></dd>
            <dt>{exact('Duration')}</dt><dd><span data-rest-duration="" dir="ltr" /></dd>
            <dt>{exact('Headers')}</dt><dd><pre data-rest-response-headers="" dir="ltr" /></dd>
            <dt>{exact('Body')}</dt><dd><pre data-rest-response-body="" dir="ltr" /></dd>
          </dl>
        </div>
      </section>
    </div>
  </details>;
}

function Schema({ name, schema, localization }: Readonly<{ name: string; schema: RestDemoSchema; localization: LocalizationContext }>): ReactNode {
  const exact = (english: string) => localization.exact(english);
  const required = new Set(schema.required || []);
  return <details className="rest-schema" id={`rest-schema-${name}`}>
    <summary><code dir="ltr">{name}</code> <span>{exact(schema.description || '')}</span></summary>
    <dl className="rest-schema-properties">{Object.entries(schema.properties || {}).map(([property, definition]) => <div key={property}>
      <dt><code dir="ltr">{property}</code></dt>
      <dd><code dir="ltr">{referenceName(definition)}</code></dd>
      <dd>{exact(required.has(property) ? 'required' : 'optional')}</dd>
      <dd>{exact(definition.description || '—')}</dd>
      {definition.example !== undefined ? <dd className="rest-property-example">{exact('Example')}: <code dir="ltr">{exampleText(definition.example)}</code></dd> : null}
    </div>)}</dl>
  </details>;
}

export function RestPresentation({ localization }: Readonly<{ localization: LocalizationContext }>): ReactNode {
  const exact = (english: string) => localization.exact(english);
  const operations = operationsFromDocument();
  return <div className="rest-openapi" data-rest-operation-browser="">
    <header className="rest-info">
      <p className="eyebrow">OpenAPI {spec.openapi}</p>
      <DemoHeading level={1}>{exact(spec.info.title)} <span className="rest-version">{spec.info.version}</span></DemoHeading>
      <p>{exact(spec.info.description)}</p>
      <nav className="rest-artifacts" aria-label={exact('OpenAPI documents')}>
        <a href={routeUrl('interfaces.openapi.json')} data-rest-full-openapi="">{exact('Raw REST OpenAPI JSON')}</a>
      </nav>
    </header>
    <section className="rest-server-security">
      <div>
        <DemoHeading level={2}>{exact('Servers')}</DemoHeading>
        {spec.servers.map((server) => <p className="rest-server" key={server.url}><span>{exact(server.description)}</span><code dir="ltr">{server.url}</code></p>)}
      </div>
      <div>
        <DemoHeading level={2}>{exact('Security')}</DemoHeading>
        {Object.entries(spec.components.securitySchemes).map(([name, scheme]) => <div className="rest-security" key={name}>
          <strong><code dir="ltr">{name}</code></strong>
          <p><code dir="ltr">{scheme.type}</code> · {scheme.in} · <code dir="ltr">{scheme.name}</code></p>
          <p>{exact(scheme.description)}</p>
        </div>)}
      </div>
    </section>
    {spec.tags.map((tag) => <section className="rest-tag" key={tag.name}>
      <header><DemoHeading level={2}>{exact(tag.name)}</DemoHeading><p>{exact(tag.description)}</p></header>
      <div className="rest-operations">{operations.filter(({ operation }) => operation.tags.includes(tag.name)).map((rendered) =>
        <Operation key={rendered.operation.operationId} rendered={rendered} localization={localization} />)}</div>
    </section>)}
    <section className="rest-schemas">
      <DemoHeading level={2}>{exact('Schemas')}</DemoHeading>
      {Object.entries(spec.components.schemas).map(([name, schema]) => <Schema key={name} name={name} schema={schema} localization={localization} />)}
    </section>
  </div>;
}

export function restSection(env: Env, options: DemoSectionOptions = {}): DemoSection {
  const localization = localizationForEnv(env);
  return createReactDemoSection(env, {
    key: 'rest',
    title: 'REST API',
    defaultPresentationPath: `${routeUrl('demos.index')}#rest`,
    browserModule: routeUrl('operations.assets', { asset: browserAssetName('scripts.rest') }),
    browserMessages: restBrowserMessages(localization),
    children: <RestPresentation localization={localization} />,
  }, options);
}
