-- Preserve existing GitHub claims while admitting provider-native work item IDs.
CREATE TABLE hosted_factory_issue_claims_v2 (
  organization_id TEXT NOT NULL, source TEXT NOT NULL, issue_id TEXT NOT NULL,
  factory_id TEXT NOT NULL, run_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(organization_id,source,issue_id)
);
INSERT INTO hosted_factory_issue_claims_v2
  SELECT organization_id,source,CAST(issue_number AS TEXT),factory_id,run_id,created_at
  FROM hosted_factory_issue_claims;
DROP TABLE hosted_factory_issue_claims;
ALTER TABLE hosted_factory_issue_claims_v2 RENAME TO hosted_factory_issue_claims;
