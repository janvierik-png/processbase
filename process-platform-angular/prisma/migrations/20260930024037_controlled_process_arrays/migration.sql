-- #40 — existujuce procesy: prazdne zoznamy namiesto NULL (schema sa nemeni)
UPDATE "ProcessNode" SET "inputs" = '{}' WHERE "inputs" IS NULL;
UPDATE "ProcessNode" SET "outputs" = '{}' WHERE "outputs" IS NULL;
UPDATE "ProcessNode" SET "upstreamProcessIds" = '{}' WHERE "upstreamProcessIds" IS NULL;
UPDATE "ProcessNode" SET "downstreamProcessIds" = '{}' WHERE "downstreamProcessIds" IS NULL;
UPDATE "ProcessNode" SET "evidenceRequirements" = '{}' WHERE "evidenceRequirements" IS NULL;
