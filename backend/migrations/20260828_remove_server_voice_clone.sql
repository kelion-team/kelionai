BEGIN;

-- Voice-cloning samples were collected for a VPS-hosted Coqui service. That
-- online non-OpenAI path is retired; the samples are optional biometric data
-- with no remaining purpose, so remove them instead of retaining dead data.
DELETE FROM kv_state
 WHERE key LIKE 'voce_sample_%';

COMMIT;
