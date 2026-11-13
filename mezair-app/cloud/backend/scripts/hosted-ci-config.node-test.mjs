import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createBackendSecretFingerprints } from './hosted-deploy.mjs';
import {
  checkHostedCiInputs,
  hostedCiSecrets,
  hostedCiVars,
  productionVars,
} from './hosted-ci-config.mjs';

const targets = JSON.parse(
  readFileSync(new URL('../hosted-targets.example.json', import.meta.url), 'utf8'),
).environments;
const closed = {
  HOSTED_CHECKOUT_ENABLED: 'false',
  MEZAIR_CLOUD_AGENTS_ENABLED: 'false',
  MEZAIR_MESH_MANAGED_ENDPOINTS: 'false',
};
const core = {
  CLOUDFLARE_API_TOKEN: 'deploy-token',
  HOSTED_SERVICE_KEYS: JSON.stringify({ website: 's'.repeat(48) }),
  WORKOS_API_KEY: 'sk_ci_environment_key',
  WORKOS_WEBHOOK_SECRET: 'ci-environment-webhook-secret',
};
const tunnel = {
  CLOUDFLARE_TUNNEL_ACCOUNT_ID: 'ci-account',
  CLOUDFLARE_TUNNEL_ZONE_ID: 'ci-zone',
  CLOUDFLARE_TUNNEL_API_TOKEN: 'ci-tunnel-secret',
};
const stagingCore = {
  HOSTED_SERVICE_KEYS: JSON.stringify({ website: 't'.repeat(48) }),
  WORKOS_API_KEY: 'sk_staging_separate',
  WORKOS_WEBHOOK_SECRET: 'staging-separate-webhook-secret',
};
const valuesFor = (environment, vars = closed) => ({
  ...core,
  [`MEZAIR_${environment.toUpperCase()}_WORKER_VARS_JSON`]: JSON.stringify(vars),
  ...(environment === 'production'
    ? {
        STAGING_SECRET_FINGERPRINTS_JSON: JSON.stringify(
          createBackendSecretFingerprints({
            ...stagingCore,
            ...(vars.MEZAIR_MESH_MANAGED_ENDPOINTS === 'true'
              ? { CLOUDFLARE_TUNNEL_API_TOKEN: 'staging-separate-tunnel-token' }
              : {}),
          }),
        ),
      }
    : {}),
});

test('production deploys preserve reviewed managed ingress and unrelated settings', () => {
  const configured = {
    ...closed,
    MEZAIR_MESH_MANAGED_ENDPOINTS: 'true',
    MACHINE_ENDPOINT_DOMAIN: 'mesh.example.com',
    MEZAIR_CLOUD_AGENTS_ENABLED: 'true',
    HOSTED_PORTAL_RETURN_URL: 'https://example.com/account',
  };
  assert.deepEqual(productionVars(configured), {
    ...configured,
    MEZAIR_CLOUD_AGENTS_ENABLED: 'false',
  });
  assert.equal(configured.MEZAIR_CLOUD_AGENTS_ENABLED, 'true');
});

test('production cannot silently reset ingress when its rollout configuration is missing', () => {
  for (const flag of [undefined, true, '']) {
    assert.throws(
      () => productionVars({ ...closed, MEZAIR_MESH_MANAGED_ENDPOINTS: flag }),
      /flag must be the string true or false/,
    );
  }
  assert.throws(() => productionVars([]), /must be an object/);
  assert.throws(
    () => productionVars({ ...closed, HOSTED_CHECKOUT_ENABLED: 'true' }),
    /disabled checkout/,
  );
  for (const domain of [undefined, 'https://mesh.example.com', 'mesh..example.com']) {
    assert.throws(
      () =>
        productionVars({
          ...closed,
          MEZAIR_MESH_MANAGED_ENDPOINTS: 'true',
          MACHINE_ENDPOINT_DOMAIN: domain,
        }),
      /valid nonsecret MACHINE_ENDPOINT_DOMAIN/,
    );
  }
});

test('both CI environments fail early on absent rollout config or deployment access', () => {
  for (const environment of ['staging', 'production']) {
    const target = targets[environment];
    assert.throws(
      () => checkHostedCiInputs(environment, {}, target),
      /Missing protected variable MEZAIR_/,
    );
    const values = valuesFor(environment);
    delete values.CLOUDFLARE_API_TOKEN;
    assert.throws(
      () => checkHostedCiInputs(environment, values, target),
      /Missing protected secret CLOUDFLARE_DEPLOY_API_TOKEN/,
    );
    values.CLOUDFLARE_API_TOKEN = core.CLOUDFLARE_API_TOKEN;
    assert.equal(
      checkHostedCiInputs(environment, values, target).MEZAIR_MESH_MANAGED_ENDPOINTS,
      'false',
    );
    delete values.WORKOS_WEBHOOK_SECRET;
    assert.throws(
      () => checkHostedCiInputs(environment, values, target),
      /requires its WorkOS WORKOS_WEBHOOK_SECRET/,
    );
  }
});

test('managed staging pilots and saved production rollouts require all three tunnel secrets', () => {
  for (const environment of ['staging', 'production']) {
    const values = valuesFor(environment, {
      ...closed,
      MEZAIR_MESH_MANAGED_ENDPOINTS: environment === 'production' ? 'true' : 'false',
      MACHINE_ENDPOINT_DOMAIN: 'mesh.example.com',
    });
    if (environment === 'staging') values.MANAGED_ENDPOINT_PILOT = 'true';
    Object.assign(values, tunnel);
    for (const name of Object.keys(tunnel)) {
      const incomplete = { ...values };
      delete incomplete[name];
      assert.throws(
        () => checkHostedCiInputs(environment, incomplete, targets[environment]),
        new RegExp(`requires ${name}`),
      );
    }
    assert.equal(
      checkHostedCiInputs(environment, values, targets[environment]).MEZAIR_MESH_MANAGED_ENDPOINTS,
      'true',
    );
  }
});

test('rollout vars reject secret injection and retain pinned environment identity', () => {
  const values = valuesFor('production', { ...closed, OIDC_CLIENT_ID: 'client_wrong' });
  assert.equal(
    hostedCiVars('production', values, targets.production).OIDC_CLIENT_ID,
    targets.production.workos.desktopClientId,
  );
  values.MEZAIR_PRODUCTION_WORKER_VARS_JSON = JSON.stringify({
    ...closed,
    WORKOS_API_KEY: 'sk_in_vars',
  });
  assert.throws(
    () => hostedCiVars('production', values, targets.production),
    /invalid or secret Worker var/,
  );
  values.MEZAIR_PRODUCTION_WORKER_VARS_JSON = '{"broken-secret-value';
  assert.throws(() => hostedCiVars('production', values, targets.production), {
    message: 'MEZAIR_PRODUCTION_WORKER_VARS_JSON must contain valid JSON.',
  });
});

test('CI materializes only backend secrets, including a reviewed tunnel token', () => {
  const values = {
    ...core,
    ...tunnel,
    HOSTED_OPERATOR_KEYS: '{"operator":"value"}',
    WEBSITE_COOKIE_PASSWORD: 'website-secret',
  };
  const selected = hostedCiSecrets(values);
  assert.equal(selected.CLOUDFLARE_TUNNEL_API_TOKEN, tunnel.CLOUDFLARE_TUNNEL_API_TOKEN);
  assert.equal(selected.HOSTED_OPERATOR_KEYS, values.HOSTED_OPERATOR_KEYS);
  assert.equal(selected.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(selected.WEBSITE_COOKIE_PASSWORD, undefined);
  assert.deepEqual(hostedCiSecrets({ HOSTED_OPERATOR_KEYS: '' }), {});
});

test('production preflight requires its fingerprint reference', () => {
  for (const reference of [undefined, '', 'invalid', '{}']) {
    const values = { ...valuesFor('production'), STAGING_SECRET_FINGERPRINTS_JSON: reference };
    assert.throws(
      () => checkHostedCiInputs('production', values, targets.production),
      /STAGING_SECRET_FINGERPRINTS_JSON/,
    );
  }
});

test('production preflight rejects a core-only staging reference whenever a tunnel token is supplied', () => {
  const reference = JSON.stringify(createBackendSecretFingerprints(stagingCore));
  for (const managed of ['true', 'false']) {
    const values = {
      ...valuesFor('production', {
        ...closed,
        MEZAIR_MESH_MANAGED_ENDPOINTS: managed,
        MACHINE_ENDPOINT_DOMAIN: 'mesh.example.com',
      }),
      ...tunnel,
      STAGING_SECRET_FINGERPRINTS_JSON: reference,
    };
    assert.throws(
      () => checkHostedCiInputs('production', values, targets.production),
      /require a staging CLOUDFLARE_TUNNEL_API_TOKEN fingerprint/,
    );
  }
});

function prepareProductionWorkflow(values) {
  const directory = mkdtempSync(join(tmpdir(), 'hosted-ci-production-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    for (const script of ['hosted-ci-config.mjs', 'staging-config.mjs', 'hosted-deploy.mjs']) {
      copyFileSync(new URL(script, import.meta.url), join(directory, 'scripts', script));
    }
    copyFileSync(
      new URL('../hosted-targets.example.json', import.meta.url),
      join(directory, 'hosted-targets.example.json'),
    );
    const workflow = readFileSync(
      new URL('../../../../.github/workflows/sync-backend-production.yml', import.meta.url),
      'utf8',
    );
    const script = workflow
      .match(
        /- name: Prepare isolated production configuration[\s\S]*?node --input-type=module <<'JS'\n([\s\S]*?)\n {10}JS/,
      )[1]
      .split('\n')
      .map((line) => line.slice(10))
      .join('\n');
    const result = spawnSync(process.execPath, ['--input-type=module'], {
      cwd: directory,
      env: { ...process.env, ...values },
      input: script,
      encoding: 'utf8',
    });
    const secretPath = join(directory, targets.production.secrets.backendFile);
    const varsPath = join(
      directory,
      '.wrangler',
      'mesh',
      targets.production.workerName,
      'vars.json',
    );
    return {
      ...result,
      ...(result.status === 0
        ? {
            secrets: JSON.parse(readFileSync(secretPath, 'utf8')),
            secretMode: statSync(secretPath).mode & 0o777,
            vars: JSON.parse(readFileSync(varsPath, 'utf8')),
          }
        : {}),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('the production workflow materializes enabled ingress and protected credentials without publishing them', () => {
  const values = {
    ...valuesFor('production', {
      ...closed,
      MEZAIR_MESH_MANAGED_ENDPOINTS: 'true',
      MACHINE_ENDPOINT_DOMAIN: 'mesh.example.com',
    }),
    ...tunnel,
    HOSTED_OPERATOR_KEYS: '',
    STAGING_SECRET_FINGERPRINTS_JSON: JSON.stringify(
      createBackendSecretFingerprints({
        HOSTED_SERVICE_KEYS: JSON.stringify({ website: 't'.repeat(48) }),
        WORKOS_API_KEY: 'sk_staging_separate',
        WORKOS_WEBHOOK_SECRET: 'staging-separate-webhook-secret',
        CLOUDFLARE_TUNNEL_API_TOKEN: 'staging-separate-tunnel-token',
      }),
    ),
  };
  const result = prepareProductionWorkflow(values);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.vars.MEZAIR_MESH_MANAGED_ENDPOINTS, 'true');
  assert.equal(result.vars.MACHINE_ENDPOINT_DOMAIN, 'mesh.example.com');
  assert.equal(result.vars.HOSTED_CHECKOUT_ENABLED, 'false');
  assert.equal(result.vars.MEZAIR_CLOUD_AGENTS_ENABLED, 'false');
  assert.equal(result.secrets.CLOUDFLARE_TUNNEL_API_TOKEN, tunnel.CLOUDFLARE_TUNNEL_API_TOKEN);
  assert.equal(result.secrets.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(result.secretMode, 0o600);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('the production workflow rejects a reused staging tunnel token before any provider operation', () => {
  const values = {
    ...valuesFor('production', {
      ...closed,
      MEZAIR_MESH_MANAGED_ENDPOINTS: 'true',
      MACHINE_ENDPOINT_DOMAIN: 'mesh.example.com',
    }),
    ...tunnel,
    HOSTED_OPERATOR_KEYS: '',
    STAGING_SECRET_FINGERPRINTS_JSON: JSON.stringify(
      createBackendSecretFingerprints({
        HOSTED_SERVICE_KEYS: JSON.stringify({ website: 't'.repeat(48) }),
        WORKOS_API_KEY: 'sk_staging_separate',
        WORKOS_WEBHOOK_SECRET: 'staging-separate-webhook-secret',
        CLOUDFLARE_TUNNEL_API_TOKEN: tunnel.CLOUDFLARE_TUNNEL_API_TOKEN,
      }),
    ),
  };
  const result = prepareProductionWorkflow(values);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production secret CLOUDFLARE_TUNNEL_API_TOKEN reuses staging/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    new RegExp(tunnel.CLOUDFLARE_TUNNEL_API_TOKEN),
  );
});

test('production preparation rejects a stale core-only reference while closed bootstrap remains valid', () => {
  const values = {
    ...valuesFor('production', {
      ...closed,
      MEZAIR_MESH_MANAGED_ENDPOINTS: 'true',
      MACHINE_ENDPOINT_DOMAIN: 'mesh.example.com',
    }),
    ...tunnel,
    HOSTED_OPERATOR_KEYS: '',
    STAGING_SECRET_FINGERPRINTS_JSON: JSON.stringify(createBackendSecretFingerprints(stagingCore)),
  };
  const rejected = prepareProductionWorkflow(values);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /require a staging CLOUDFLARE_TUNNEL_API_TOKEN fingerprint/);
  assert.doesNotMatch(
    rejected.stdout + rejected.stderr,
    new RegExp(tunnel.CLOUDFLARE_TUNNEL_API_TOKEN),
  );

  const bootstrapValues = { ...valuesFor('production'), HOSTED_OPERATOR_KEYS: '' };
  for (const name of Object.keys(tunnel)) bootstrapValues[name] = '';
  const bootstrap = prepareProductionWorkflow(bootstrapValues);
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  assert.equal(bootstrap.vars.MEZAIR_MESH_MANAGED_ENDPOINTS, 'false');
  assert.equal(bootstrap.secrets.CLOUDFLARE_TUNNEL_API_TOKEN, undefined);
});

test('both staging deployment paths omit an empty optional operator key and retain a configured key', () => {
  const workflow = readFileSync(
    new URL('../../../../.github/workflows/sync-backend-staging.yml', import.meta.url),
    'utf8',
  );
  const directory = mkdtempSync(join(tmpdir(), 'hosted-ci-staging-'));
  try {
    const fakePnpm = join(directory, 'pnpm');
    writeFileSync(
      fakePnpm,
      `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({operator:process.env.HOSTED_OPERATOR_KEYS})+'\\n');\n`,
    );
    chmodSync(fakePnpm, 0o700);
    for (const managed of [false, true]) {
      const name = `Validate, migrate, deploy and install ${managed ? 'managed ' : ''}staging secrets`;
      const step = workflow
        .slice(workflow.indexOf(`      - name: ${name}\n`))
        .split('\n      - name: ')[0];
      const script = step
        .split('        run: |\n')[1]
        .split('\n')
        .map((line) => line.slice(10))
        .join('\n');
      for (const operator of ['', '{"operator":"configured-fixture-key"}']) {
        const result = spawnSync('bash', ['-e'], {
          input: script,
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            ...core,
            ...tunnel,
            HOSTED_OPERATOR_KEYS: operator,
          },
          encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
        const invocations = result.stdout
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        assert.equal(invocations.length, 4);
        for (const invocation of invocations)
          assert.equal(invocation.operator, operator || undefined);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
