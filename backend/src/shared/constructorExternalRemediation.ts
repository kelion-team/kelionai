/** Root VPS reporter attestation, separate from the Constructor executor. */
export interface ExternalRemediationInput {
  jobId: number
  cycle: number
  coordinator: string
  executionId: string
  kind: 'edit' | 'test' | 'build' | 'diagnostic' | 'deploy'
  state: 'working' | 'blocked' | 'completed'
  summary: string
  nextAction: string
  evidence: { kind: 'artifact_changed' | 'test_case_completed'; digest: string; observedAt: string; sourceRef: string }
}
export interface ExternalRemediationView {
  jobId: number
  cycle: number
  coordinator: string
  executionId: string
  kind: ExternalRemediationInput['kind']
  state: ExternalRemediationInput['state']
  summary: string
  nextAction: string
  lastEvidenceAt: string | null
  evidenceDigest: string | null
  sourceRef: string | null
  activeExternalRemediation: boolean
  activeUntil: string | null
}
