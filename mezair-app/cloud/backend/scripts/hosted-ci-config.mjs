#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  assertFreshAgainstSecretFingerprints,
  mergeTargetVars,
  validateBackendSecrets,
  validateManifest,
} from './hosted-deploy.mjs';
import { isManagedEndpointDomain, stagingVars } from './staging-config.mjs';

const CI_SECRET_NAMES = [
  'HOSTED_SERVICE_KEYS',
  'HOSTED_OPERATOR_KEYS',
  'WORKOS_API_KEY',
  'WORKOS_WEBHOOK_SECRET',
  'CLOUDFLARE_TUNNEL_ACCOUNT_ID',
  'CLOUDFLARE_TUNNEL_ZONE_ID',
  'CLOUDFLARE_TUNNEL_API_TOKEN',
];

export function hostedCiSecrets(values) {
  return Object.fromEntries(
    CI_SECRET_NAMES.filter((name) => values[name]).map((name) => [name, values[name]]),
  );
}

/** Preserve the reviewed rollout; a missing setting must never disable live ingress. */
export function productionVars(configured) {
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    throw new Error('Production Worker variables must be an object.');
  }
  if (configured.HOSTED_CHECKOUT_ENABLED !== 'false') {
    throw new Error('Production CI requires explicitly disabled checkout.');
  }
  if (!['true', 'false'].includes(configured.MEZAIR_MESH_MANAGED_ENDPOINTS)) {
    throw new Error('Production managed endpoint flag must be the string true or false.');
  }
  if (
    configured.MEZAIR_MESH_MANAGED_ENDPOINTS === 'true' &&
    !isManagedEndpointDomain(configured.MACHINE_ENDPOINT_DOMAIN)
  ) {
    throw new Error(
      'Managed endpoints require a valid nonsecret MACHINE_ENDPOINT_DOMAIN target var.',
    );
  }
  return { ...configured, MEZAIR_CLOUD_AGENTS_ENABLED: 'false' };
}

export function hostedCiVars(environment, values, target) {
  if (!['staging', 'production'].includes(environment)) {
    throw new Error('Choose the staging or production CI environment.');
  }
  const name = `MEZAIR_${environment.toUpperCase()}_WORKER_VARS_JSON`;
  if (!values[name]?.trim()) throw new Error(`Missing protected variable ${name}.`);
  let configured;
  try {
    configured = JSON.parse(values[name]);
  } catch {
    throw new Error(`${name} must contain valid JSON.`);
  }
  const vars =
    environment === 'production'
      ? productionVars(configured)
      : stagingVars(configured, { managedEndpointPilot: values.MANAGED_ENDPOINT_PILOT === 'true' });
  return mergeTargetVars(vars, target);
}

/** Check protected configuration before dependency installation or any provider mutation. */
export function checkHostedCiInputs(environment, values, target, fingerprintOptions = {}) {
  const vars = hostedCiVars(environment, values, target);
  if (!values.CLOUDFLARE_API_TOKEN?.trim()) {
    throw new Error('Missing protected secret CLOUDFLARE_DEPLOY_API_TOKEN.');
  }
  const secrets = hostedCiSecrets(values);
  validateBackendSecrets(secrets, target, environment, {
    managedEndpointsEnabled: vars.MEZAIR_MESH_MANAGED_ENDPOINTS === 'true',
  });
  if (environment === 'production') {
    let reference;
    try {
      reference = JSON.parse(values.STAGING_SECRET_FINGERPRINTS_JSON || '');
    } catch {
      throw new Error('Missing or invalid protected variable STAGING_SECRET_FINGERPRINTS_JSON.');
    }
    try {
      assertFreshAgainstSecretFingerprints(reference, secrets, fingerprintOptions);
    } catch (error) {
      throw new Error(
        `Invalid protected variable STAGING_SECRET_FINGERPRINTS_JSON: ${error.message}`,
      );
    }
  }
  return vars;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const environment = process.argv[2];
    const manifestName =
      environment === 'staging' ? 'hosted-targets.ci.json' : 'hosted-targets.example.json';
    const manifest = JSON.parse(
      readFileSync(new URL(`../${manifestName}`, import.meta.url), 'utf8'),
    );
    const target = validateManifest(manifest, environment);
    checkHostedCiInputs(environment, process.env, target, {
      requireProvisionerFingerprint: manifest.environments.staging.managedProvisioner,
    });
    console.log(`Verified required ${environment} CI inputs.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
